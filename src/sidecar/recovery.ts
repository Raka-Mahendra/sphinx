import { downloadsSublevel } from "@main/level/sublevels/downloads";
import { gamesPlaytime, watchProcesses } from "@main/services/process-watcher";
import { logger } from "@main/services/logger";

/**
 * Recovery scan, run once per sidecar start.
 *
 * The baseline already had most of this behaviour, but it was implicit: the
 * first process-watcher tick discovered a game that was still running and
 * silently opened a fresh session. Sphinx makes the scan explicit and marks the
 * sessions it discovers, so three questions have an answer in the log:
 *
 * - which games were still running when the sidecar started;
 * - which playtime session continues them, and that it is a *resumed* one;
 * - how much of the download queue was rebuilt.
 *
 * What this deliberately does **not** do:
 *
 * - it does not invent playtime for the window between the crash and this
 *   start. The baseline did not either, and backfilling would be a lie;
 * - it does not re-add torrents by hand. `loadState()` already hands the
 *   pending download to the torrent engine, which resumes from the resume data
 *   the previous `torrentShutdown` wrote. The scan only reports the result.
 */
export interface RecoveryReport {
  /** Games found still running, with the session that continues them. */
  runningGames: { gameKey: string; sessionId: string }[];
  downloads: {
    total: number;
    active: number;
    paused: number;
    seeding: number;
  };
  /** Steps that failed. A non-empty list means recovery was partial. */
  errors: string[];
}

const countDownloads = async (): Promise<RecoveryReport["downloads"]> => {
  const downloads = await downloadsSublevel.values().all();

  return {
    total: downloads.length,
    // `active` and `extracting` are the two statuses that mean work is in
    // flight; see `DownloadStatus` in src/types/download.types.ts.
    active: downloads.filter(
      (download) =>
        download.status === "active" || download.status === "extracting"
    ).length,
    paused: downloads.filter((download) => download.status === "paused").length,
    seeding: downloads.filter((download) => download.status === "seeding")
      .length,
  };
};

export const runRecoveryScan = async (): Promise<RecoveryReport> => {
  const errors: string[] = [];

  try {
    // `resumed: true` is the only difference from a normal watcher tick: it
    // tags every session this scan opens so the log can tell "the user launched
    // this" apart from "this was already running".
    await watchProcesses({ resumed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`process scan failed: ${message}`);
    logger.error("[recovery] process scan failed", error);
  }

  const runningGames = [...gamesPlaytime.entries()]
    .filter(([, session]) => session.resumed)
    .map(([gameKey, session]) => ({
      gameKey,
      sessionId: session.sessionId,
    }));

  let downloads: RecoveryReport["downloads"] = {
    total: 0,
    active: 0,
    paused: 0,
    seeding: 0,
  };

  try {
    downloads = await countDownloads();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`download queue scan failed: ${message}`);
    logger.error("[recovery] download queue scan failed", error);
  }

  if (runningGames.length > 0) {
    logger.warn(
      "[recovery] games were already running; playtime between the previous exit and this start is not reconstructed",
      { games: runningGames.length }
    );
  }

  return { runningGames, downloads, errors };
};
