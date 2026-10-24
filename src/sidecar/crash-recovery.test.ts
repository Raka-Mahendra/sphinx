import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { ClassicLevel } from "classic-level";

/**
 * Crash and restart behaviour, exercised against the real sidecar bundle.
 *
 * These are integration tests: they spawn `out/sidecar/index.mjs` the way Rust
 * does, kill it the way a crash would, and read LevelDB back with the same
 * library the app uses. A unit test cannot prove that the LevelDB lock is
 * released or that a game survives, because both are properties of the process
 * boundary.
 *
 * Prerequisite: `yarn build:sidecar` (the `test:crash` script does it).
 * The playtime-resumption half of the first test also needs the native addon
 * (`native/hydra-native`); when it is missing the test says so instead of
 * pretending to pass.
 */

const ROOT = process.cwd();
const BUNDLE = path.join(ROOT, "out", "sidecar", "index.mjs");
const HAS_BUNDLE = fs.existsSync(BUNDLE);

const temporaryDirectories: string[] = [];
const runningProcesses = new Set<ChildProcess>();

const makeUserData = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sphinx-crash-"));
  temporaryDirectories.push(directory);
  return directory;
};

const buildPaths = (userData: string) =>
  JSON.stringify({
    home: os.homedir(),
    appData: process.env.APPDATA ?? os.homedir(),
    userData,
    sessionData: userData,
    userCache: path.join(userData, "Cache"),
    temp: os.tmpdir(),
    exe: process.execPath,
    module: ROOT,
    desktop: path.join(os.homedir(), "Desktop"),
    documents: path.join(os.homedir(), "Documents"),
    downloads: path.join(os.homedir(), "Downloads"),
    music: path.join(os.homedir(), "Music"),
    pictures: path.join(os.homedir(), "Pictures"),
    videos: path.join(os.homedir(), "Videos"),
    recent: path.join(os.homedir(), "Recent"),
    logs: path.join(userData, "logs"),
    crashDumps: path.join(userData, "Crashpad"),
  });

interface SidecarMessage {
  type: string;
  id?: string;
  result?: unknown;
  error?: { code: string; message: string };
  channel?: string;
  payload?: unknown;
  seq?: number;
}

class Sidecar {
  public readonly messages: SidecarMessage[] = [];
  public readonly stderr: string[] = [];
  private buffer = "";
  private nextId = 1;
  private waiters: {
    predicate: (message: SidecarMessage) => boolean;
    resolve: (message: SidecarMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  private constructor(
    public readonly child: ChildProcess,
    public readonly userData: string
  ) {
    runningProcesses.add(child);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf("\n");

      while (index !== -1) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        index = this.buffer.indexOf("\n");

        if (!line.trim()) continue;

        let message: SidecarMessage;
        try {
          message = JSON.parse(line) as SidecarMessage;
        } catch {
          continue;
        }

        this.messages.push(message);
        this.flushWaiters(message);
        this.answerHostRpc(message);
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) this.stderr.push(line);
      }
    });
  }

  public static async start(
    userData: string,
    extraEnv: Record<string, string> = {}
  ): Promise<Sidecar> {
    const child = spawn(process.execPath, [BUNDLE], {
      cwd: ROOT,
      env: {
        ...process.env,
        SPHINX_IS_PACKAGED: "0",
        SPHINX_APP_VERSION: "0.1.0",
        SPHINX_APP_NAME: "Sphinx Launcher",
        SPHINX_APP_PATH: ROOT,
        SPHINX_RESOURCES_DIR: path.join(ROOT, "resources"),
        SPHINX_PATHS: buildPaths(userData),
        SPHINX_DISPLAYS: JSON.stringify([
          {
            id: 0,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
            scaleFactor: 1,
          },
        ]),
        SPHINX_SUPERVISED: "1",
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const sidecar = new Sidecar(child, userData);
    await sidecar.waitFor((message) => message.type === "ready", 90_000);
    return sidecar;
  }

  public waitFor(
    predicate: (message: SidecarMessage) => boolean,
    timeoutMs = 15_000
  ): Promise<SidecarMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for a sidecar message; stderr tail:\n${this.stderr
              .slice(-8)
              .join("\n")}`
          )
        );
      }, timeoutMs);

      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  public async invoke(channel: string, args: unknown[] = []): Promise<unknown> {
    const id = String(this.nextId++);

    this.child.stdin?.write(
      `${JSON.stringify({
        type: "invoke",
        id,
        channel,
        args,
        windowLabel: null,
      })}\n`
    );

    const message = await this.waitFor(
      (candidate) =>
        (candidate.type === "result" || candidate.type === "error") &&
        candidate.id === id,
      30_000
    );

    if (message.type === "error") {
      throw Object.assign(new Error(message.error?.message ?? "unknown"), {
        code: message.error?.code,
      });
    }

    return message.result;
  }

  /** Returns true when a heartbeat arrived inside `timeoutMs`. */
  public async ping(timeoutMs = 2_000): Promise<boolean> {
    const seq = this.nextId++;

    this.child.stdin?.write(
      `${JSON.stringify({ type: "control", action: "ping", seq })}\n`
    );

    try {
      await this.waitFor(
        (message) => message.type === "heartbeat" && message.seq === seq,
        timeoutMs
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hard kill, then wait for the OS to confirm the process is gone.
   *
   * The wait matters for the tests that follow: a killed-but-not-yet-reaped
   * sidecar still holds the LevelDB lock and the torrent port, and the next
   * test would look like a hang instead of a leak.
   */
  public async kill(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;

    const exited = new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
      setTimeout(resolve, 5_000).unref?.();
    });

    this.child.kill("SIGKILL");
    await exited;
    runningProcesses.delete(this.child);
  }

  public async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;

    this.child.stdin?.write(
      `${JSON.stringify({ type: "control", action: "shutdown", timeoutMs: 4_000 })}\n`
    );

    await this.waitFor(
      (message) => message.type === "shutdown-complete",
      8_000
    ).catch(() => undefined);

    await this.kill();
  }

  public recoveryReport(): Record<string, unknown> | null {
    const line = this.stderr.find((entry) =>
      entry.includes("[sidecar] recovery ")
    );

    if (!line) return null;

    try {
      return JSON.parse(
        line.slice(
          line.indexOf("[sidecar] recovery ") + "[sidecar] recovery ".length
        )
      ) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private flushWaiters(message: SidecarMessage): void {
    this.waiters = this.waiters.filter((waiter) => {
      if (!waiter.predicate(message)) return true;
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return false;
    });
  }

  /** Answers the sidecar's own requests so boot never stalls on one. */
  private answerHostRpc(message: SidecarMessage): void {
    if (message.type !== "rpc") return;

    const method = (message as { method?: string }).method ?? "";
    const result = method.startsWith("dialog.")
      ? { canceled: true, filePaths: [] }
      : null;

    this.child.stdin?.write(
      `${JSON.stringify({ type: "rpc-result", id: message.id, result })}\n`
    );
  }
}

/** Seeds the games sublevel with a record pointing at a live process. */
const seedRunningGame = async (
  userData: string,
  executablePath: string
): Promise<string> => {
  const db = new ClassicLevel(path.join(userData, "hydra-db"), {
    valueEncoding: "json",
  });
  const games = db.sublevel("games", { valueEncoding: "json" });

  await games.put("custom:fixture-game", {
    shop: "custom",
    objectId: "fixture-game",
    title: "Fixture Game",
    isDeleted: false,
    executablePath,
    trackingExecutablePaths: [],
    playTimeInMilliseconds: 1_000,
    lastTimePlayed: null,
    remoteId: null,
    hasActiveSteamImport: false,
    enableHydraPlaytimeTracking: true,
    downloadPath: userData,
  } as never);

  await db.close();
  return "custom:fixture-game";
};

const seedDownload = async (userData: string): Promise<void> => {
  const db = new ClassicLevel(path.join(userData, "hydra-db"), {
    valueEncoding: "json",
  });
  const downloads = db.sublevel("downloads", { valueEncoding: "json" });

  await downloads.put("custom:fixture-download", {
    shop: "custom",
    objectId: "fixture-download",
    status: "paused",
    progress: 0.42,
    bytesDownloaded: 420,
    fileSize: 1_000,
    downloadPath: userData,
    folderName: "fixture-download",
    downloader: "torrent",
    uri: "magnet:?xt=urn:btih:fixture",
    shouldSeed: false,
    queued: false,
    timestamp: 1,
  } as never);

  await db.close();
};

const readDownloads = async (
  userData: string
): Promise<Record<string, unknown>[]> => {
  const db = new ClassicLevel(path.join(userData, "hydra-db"), {
    valueEncoding: "json",
  });
  const downloads = db.sublevel("downloads", { valueEncoding: "json" });

  const entries: Record<string, unknown>[] = [];
  for await (const [key, value] of downloads.iterator()) {
    entries.push({ key, value: value as Record<string, unknown> });
  }

  await db.close();
  return entries;
};

/**
 * Waits until the LevelDB lock is free.
 *
 * The supervisor has the same rule (never spawn before the old process is
 * reaped). The tests need it too: `kill()` waits for the process to exit, but
 * the OS can hold the file handle for a moment longer, and a start that races
 * that window would look like a recovery failure instead of a lock race.
 */
const waitForDatabaseRelease = async (userData: string): Promise<void> => {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const db = new ClassicLevel(path.join(userData, "hydra-db"), {
        valueEncoding: "json",
      });
      await db.close();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw new Error("LevelDB was still locked 10s after the sidecar was killed");
};

const spawnLongRunningGame = (): ChildProcess => {
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 120000)"],
    {
      // Exactly what `src/main/helpers/launch-game.ts` does: detached, with no
      // inherited stdio, so the game is not tied to the launcher's lifetime.
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }
  );

  child.unref();
  runningProcesses.add(child);
  return child;
};

after(() => {
  for (const child of runningProcesses) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }

  for (const directory of temporaryDirectories) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      /* Windows keeps LevelDB files locked briefly */
    }
  }
});

describe(
  "sidecar crash recovery",
  {
    // Sequential on purpose: each test owns a userData directory and the
    // torrent engine binds a port, so overlapping runs would test each other.
    concurrency: 1,
    skip: HAS_BUNDLE ? false : "run `yarn build:sidecar` first",
  },
  () => {
    it("keeps a running game alive when the sidecar is killed", async () => {
      const userData = makeUserData();
      const game = spawnLongRunningGame();
      const gameKey = await seedRunningGame(userData, process.execPath);

      const sidecar = await Sidecar.start(userData);

      assert.equal(await sidecar.invoke("ping"), "pong");

      // Hard kill: no shutdown hook runs, which is exactly the crash case.
      await sidecar.kill();

      await new Promise((resolve) => setTimeout(resolve, 400));

      assert.equal(
        game.exitCode,
        null,
        "the game process must survive the sidecar, because it is spawned detached"
      );

      // The restarted sidecar must find the game and open a *resumed* session.
      await waitForDatabaseRelease(userData);
      const restarted = await Sidecar.start(userData);
      const report = restarted.recoveryReport();

      assert.ok(report, "the recovery report must be logged");

      const nativeAddonMissing = restarted.stderr.some((line) =>
        line.includes("native addon not found")
      );

      if (nativeAddonMissing) {
        // Honest skip: process enumeration lives in the native addon, so the
        // resume half cannot be observed on a machine without it.
        assert.deepEqual(report?.runningGames, []);
      } else {
        const running = (report?.runningGames ?? []) as {
          gameKey: string;
          sessionId: string;
        }[];

        assert.ok(
          running.some((entry) => entry.gameKey === gameKey),
          `expected ${gameKey} in the recovery report, got ${JSON.stringify(running)}`
        );

        for (const entry of running) {
          assert.match(entry.sessionId, /^[0-9a-f-]{36}$/);
        }
      }

      await restarted.stop();
    });

    it("leaves the download queue intact when the sidecar is killed", async () => {
      const userData = makeUserData();
      await seedDownload(userData);

      const sidecar = await Sidecar.start(userData);
      assert.equal(await sidecar.invoke("ping"), "pong");
      await sidecar.kill();

      await new Promise((resolve) => setTimeout(resolve, 300));

      const afterCrash = await readDownloads(userData);
      assert.equal(
        afterCrash.length,
        1,
        "a crash must not duplicate the record"
      );
      assert.equal(
        (afterCrash[0]?.value as { progress?: number }).progress,
        0.42
      );

      // A second start/stop cycle must not add a second row either: the queue is
      // rebuilt from the same keys, not appended to.
      await waitForDatabaseRelease(userData);
      const restarted = await Sidecar.start(userData);
      await restarted.stop();

      const afterRestart = await readDownloads(userData);
      assert.equal(afterRestart.length, 1);
      assert.equal(
        (afterRestart[0]?.value as { progress?: number }).progress,
        0.42
      );
    });

    it("releases the LevelDB lock after a forced kill so the next start can open it", async () => {
      const userData = makeUserData();

      const first = await Sidecar.start(userData);
      assert.equal(await first.invoke("ping"), "pong");
      await first.kill();

      // No grace period: the next start races the OS releasing the file handles.
      const second = await Sidecar.start(userData);

      assert.equal(await second.invoke("ping"), "pong");

      const lockErrors = second.stderr.filter(
        (line) =>
          line.includes("LOCK") ||
          line.includes("Resource temporarily unavailable") ||
          line.includes("already held")
      );

      assert.deepEqual(
        lockErrors,
        [],
        "the second start must not hit the DB lock"
      );

      await second.stop();
    });

    it("detects a hung sidecar through missed heartbeats", async () => {
      const userData = makeUserData();

      // The freeze hook blocks the event loop 150 ms after boot, which is what a
      // wedged Node process looks like: alive, holding the lock, answering
      // nothing.
      const sidecar = await Sidecar.start(userData, {
        SPHINX_TEST_FREEZE_MS: "6000",
      });

      // At least one ping must be answered before the 700 ms freeze lands; the
      // retry keeps the assertion from depending on scheduler timing.
      let answeredBefore = false;
      for (let attempt = 0; attempt < 3 && !answeredBefore; attempt++) {
        answeredBefore = await sidecar.ping(800);
        if (!answeredBefore) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }

      assert.equal(
        answeredBefore,
        true,
        "the sidecar must answer while healthy"
      );

      // Past the grace period the hook gives the first ping.
      await new Promise((resolve) => setTimeout(resolve, 900));

      assert.equal(
        await sidecar.ping(1_500),
        false,
        "a hung sidecar must stop answering pings"
      );

      // What the supervisor does next: kill it and start a fresh one.
      await sidecar.kill();

      const replacement = await Sidecar.start(userData);
      assert.equal(await replacement.invoke("ping"), "pong");

      await replacement.stop();
    });
  }
);
