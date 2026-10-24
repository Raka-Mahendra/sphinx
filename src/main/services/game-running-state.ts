import { randomUUID } from "node:crypto";

import { levelKeys } from "../level/sublevels/keys.js";
import type { Game } from "@types";

/**
 * A playtime session. `sessionId` is new for Sphinx: it makes a resumed session
 * distinguishable from the one that was interrupted, and `resumed` records that
 * the session was discovered by the recovery scan rather than by a launch.
 *
 * Neither field is persisted. The PRD explicitly asks for "no new persistence",
 * so the gap between a crash and the next start stays visible in the log instead
 * of being silently backfilled.
 */
export interface GamePlaytimeState {
  lastTick: number;
  firstTick: number;
  lastSyncTick: number;
  countHydraPlaytime: boolean;
  syncSteamOnExit?: boolean;
  syncEpicOnExit?: boolean;
  managedEpicSession?: boolean;
  sessionId: string;
  resumed: boolean;
}

export type GamePlaytimeSessionInput = Omit<
  GamePlaytimeState,
  "sessionId" | "resumed"
> & {
  sessionId?: string;
  resumed?: boolean;
};

/** The three fields the delta maths reads; narrower than a full session. */
export type PlaytimeDeltaInput = Pick<
  GamePlaytimeState,
  "countHydraPlaytime" | "lastTick" | "lastSyncTick"
>;

export const getGamePlaytimeDeltas = (
  session: PlaytimeDeltaInput,
  now: number,
  pendingDelta = 0
) => ({
  localDelta: session.countHydraPlaytime ? now - session.lastTick : 0,
  syncDelta:
    (session.countHydraPlaytime ? now - session.lastSyncTick : 0) +
    pendingDelta,
});

const mutableGamesPlaytime = new Map<string, GamePlaytimeState>();
const emulatorGamesRunning = new Set<string>();

export const gamesPlaytime: ReadonlyMap<string, GamePlaytimeState> =
  mutableGamesPlaytime;

export const setGamePlaytime = (
  gameKey: string,
  playtime: GamePlaytimeSessionInput
) => {
  mutableGamesPlaytime.set(gameKey, {
    ...playtime,
    sessionId: playtime.sessionId ?? randomUUID(),
    resumed: playtime.resumed ?? false,
  });
};

export const enableHydraPlaytimeForRunningSession = (
  gameKey: string,
  now = performance.now()
) => {
  const session = mutableGamesPlaytime.get(gameKey);

  if (!session) return false;
  if (session.countHydraPlaytime) return true;

  mutableGamesPlaytime.set(gameKey, {
    ...session,
    countHydraPlaytime: true,
    lastTick: now,
    lastSyncTick: now,
  });

  return true;
};

export const deleteGamePlaytime = (gameKey: string) =>
  mutableGamesPlaytime.delete(gameKey);

export const resetHydraPlaytimeTicks = (
  gameKey: string,
  now = performance.now()
) => {
  const session = mutableGamesPlaytime.get(gameKey);
  if (session)
    mutableGamesPlaytime.set(gameKey, {
      ...session,
      lastTick: now,
      lastSyncTick: now,
    });
};

export const clearGamesPlaytimeState = () => {
  mutableGamesPlaytime.clear();
  emulatorGamesRunning.clear();
};

export const setEmulatorGameRunning = (gameKey: string) => {
  emulatorGamesRunning.add(gameKey);
};

export const deleteEmulatorGameRunning = (gameKey: string) => {
  emulatorGamesRunning.delete(gameKey);
};

export const getTrackedGamesRunning = (now = performance.now()) =>
  Array.from(gamesPlaytime.entries()).map(([id, session]) => ({
    id,
    sessionDurationInMillis: now - session.firstTick,
    sessionId: session.sessionId,
    resumed: session.resumed,
  }));

export const isGameRunning = (objectId: string, shop: Game["shop"]) =>
  gamesPlaytime.has(levelKeys.game(shop, objectId)) ||
  emulatorGamesRunning.has(levelKeys.game(shop, objectId));
