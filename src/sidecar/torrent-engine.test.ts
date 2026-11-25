import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { ClassicLevel } from "classic-level";

/**
 * The torrent engine across the process boundary (Fase 6, PRD §4.C).
 *
 * These spawn the real sidecar bundle the way Rust does and substitute only
 * libtorrent: `SPHINX_TEST_NATIVE_ADDON` points the native-addon resolver at
 * `fixtures/fake-torrent-engine.cjs`, which holds an exclusive socket on the
 * port it is initialised with. Everything else — `loadState`,
 * `DownloadManager.initializeTorrentService`, `TorrentService`, `TorrentClient`,
 * `NativeAddon`, the shutdown hooks and `process.exit` — is the shipped code.
 *
 * What each test therefore proves:
 *
 * - the engine is initialised exactly once per sidecar boot, with port 5881,
 *   and receives the `set_network_interface` action the baseline sends;
 * - a clean shutdown runs `torrentShutdown` once and releases the socket before
 *   the process exits;
 * - a second sidecar cannot become a second engine (the socket is exclusive),
 *   and after the first is killed a new one takes over;
 * - closing stdin — what happens when the shell dies — still stops the engine,
 *   so no sidecar (and therefore no engine) is orphaned.
 *
 * Prerequisite: `yarn build:sidecar` (`yarn test:torrent` does it).
 */

const ROOT = process.cwd();
const BUNDLE = path.join(ROOT, "out", "sidecar", "index.mjs");
const FIXTURE = path.join(
  ROOT,
  "src",
  "sidecar",
  "fixtures",
  "fake-torrent-engine.cjs"
);
const HAS_BUNDLE = fs.existsSync(BUNDLE);

/** `TorrentClient` initialises with this; kept in one place in the test. */
const TORRENT_PORT = 5881;

const temporaryDirectories: string[] = [];
const runningProcesses = new Set<ChildProcess>();

const makeTemporaryDirectory = (prefix: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

interface EngineEvent {
  event: "loaded" | "initialize" | "request" | "shutdown";
  pid: number;
  port?: number;
  ok?: boolean;
  code?: string;
  method?: string;
  params?: { action?: string };
  module?: string;
}

const readEngineLog = (file: string): EngineEvent[] => {
  if (!fs.existsSync(file)) return [];

  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EngineEvent);
};

const portIsFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
  description = "condition"
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`timed out waiting for ${description}`);
};

/**
 * Waits until LevelDB is free.
 *
 * The supervisor never spawns before the previous child is reaped; the test has
 * to be as careful, or a start that races the file handles looks like a torrent
 * failure instead of a lock race.
 */
const waitForDatabaseRelease = async (userData: string): Promise<void> => {
  await waitFor(
    async () => {
      try {
        const db = new ClassicLevel(path.join(userData, "hydra-db"), {
          valueEncoding: "json",
        });
        await db.close();
        return true;
      } catch {
        return false;
      }
    },
    10_000,
    "the LevelDB lock to be released"
  );
};

interface SidecarMessage {
  type: string;
  id?: string;
  seq?: number;
  result?: unknown;
  error?: { code: string; message: string };
}

class Sidecar {
  public readonly messages: SidecarMessage[] = [];
  public readonly stderr: string[] = [];
  private buffer = "";
  private waiters: {
    predicate: (message: SidecarMessage) => boolean;
    resolve: (message: SidecarMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  private constructor(
    public readonly child: ChildProcess,
    public readonly userData: string,
    public readonly engineLog: string
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

  public static async start(userData: string): Promise<Sidecar> {
    const engineLog = path.join(userData, "engine.log");

    const paths = JSON.stringify({
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
      logs: path.join(userData, "logs"),
      crashDumps: path.join(userData, "Crashpad"),
    });

    const child = spawn(process.execPath, [BUNDLE], {
      cwd: ROOT,
      env: {
        ...process.env,
        SPHINX_IS_PACKAGED: "0",
        SPHINX_APP_VERSION: "0.1.0",
        SPHINX_APP_NAME: "Sphinx Launcher",
        SPHINX_APP_PATH: ROOT,
        SPHINX_RESOURCES_DIR: path.join(ROOT, "resources"),
        SPHINX_HYDRA_NATIVE_DIR: path.join(ROOT, "hydra-native"),
        SPHINX_TEST_NATIVE_ADDON: FIXTURE,
        SPHINX_TEST_ENGINE_LOG: engineLog,
        SPHINX_PATHS: paths,
        SPHINX_DISPLAYS: JSON.stringify([
          {
            id: 0,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
            scaleFactor: 1,
          },
        ]),
        SPHINX_SUPERVISED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const sidecar = new Sidecar(child, userData, engineLog);
    await sidecar.waitFor((message) => message.type === "ready", 90_000);
    return sidecar;
  }

  public events(): EngineEvent[] {
    return readEngineLog(this.engineLog);
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
              .slice(-10)
              .join("\n")}`
          )
        );
      }, timeoutMs);

      this.waiters.push({ predicate, resolve, timer });
    });
  }

  /** Resolves once the process is gone; false if it is still alive. */
  public async waitForExit(timeoutMs = 10_000): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return true;
    }

    const exited = new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
    });

    const timer = new Promise<false>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs).unref?.();
    });

    const result = await Promise.race([exited.then(() => true), timer]);
    return result === true;
  }

  /** The shell's ordered teardown. Returns whether the process exited itself. */
  public async stop(): Promise<boolean> {
    if (this.child.exitCode !== null) return true;

    this.child.stdin?.write(
      `${JSON.stringify({ type: "control", action: "shutdown", timeoutMs: 5_000 })}\n`
    );

    await this.waitFor(
      (message) => message.type === "shutdown-complete",
      10_000
    ).catch(() => undefined);

    const exited = await this.waitForExit(10_000);

    if (!exited) await this.kill();

    return exited;
  }

  public async kill(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      runningProcesses.delete(this.child);
      return;
    }

    const exited = this.waitForExit(5_000);
    this.child.kill("SIGKILL");
    await exited;
    runningProcesses.delete(this.child);
  }

  public closeStdin(): void {
    this.child.stdin?.end();
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

    this.child.stdin?.write(
      `${JSON.stringify({ type: "rpc-result", id: message.id, result: null })}\n`
    );
  }
}

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
  "torrent engine lifecycle in the sidecar",
  {
    // Sequential on purpose: every test owns the one torrent port.
    concurrency: 1,
    skip: HAS_BUNDLE ? false : "run `yarn build:sidecar` first",
  },
  () => {
    const requireFreePort = async (context: {
      skip: (message?: string) => void;
    }): Promise<boolean> => {
      if (await portIsFree(TORRENT_PORT)) return true;

      context.skip(
        `port ${TORRENT_PORT} is already in use (a running Sphinx/Hydra instance?); ` +
          `stop it and re-run`
      );
      return false;
    };

    it("initializes one engine, serves a request, and shuts it down cleanly", async (context) => {
      if (!(await requireFreePort(context))) return;

      const sidecar = await Sidecar.start(
        makeTemporaryDirectory("sphinx-torrent-")
      );

      const bootEvents = sidecar.events();

      assert.ok(
        bootEvents.some(
          (event) => event.event === "loaded" && event.module === FIXTURE
        ),
        "the addon path must come from SPHINX_TEST_NATIVE_ADDON / SPHINX_HYDRA_NATIVE_DIR"
      );

      const initialisations = bootEvents.filter(
        (event) => event.event === "initialize"
      );
      assert.equal(
        initialisations.length,
        1,
        `expected exactly one engine initialisation, got ${JSON.stringify(initialisations)}`
      );
      assert.equal(initialisations[0]?.port, TORRENT_PORT);
      assert.equal(initialisations[0]?.ok, true);

      const actions = bootEvents
        .filter((event) => event.event === "request")
        .map((event) => event.params?.action)
        .filter(Boolean);

      assert.ok(
        actions.includes("set_network_interface"),
        `the baseline applies the network interface on startup, saw ${JSON.stringify(actions)}`
      );

      assert.equal(
        await portIsFree(TORRENT_PORT),
        false,
        "the engine must own its listen socket while the sidecar runs"
      );

      const exitedCleanly = await sidecar.stop();
      assert.equal(
        exitedCleanly,
        true,
        `the sidecar must exit on its own after shutdown; stderr tail:\n${sidecar.stderr
          .slice(-10)
          .join("\n")}`
      );

      const shutdownEvents = sidecar
        .events()
        .filter((event) => event.event === "shutdown");
      assert.equal(
        shutdownEvents.length,
        1,
        "torrentShutdown must run exactly once"
      );

      await waitFor(
        () => portIsFree(TORRENT_PORT),
        5_000,
        "the engine socket to be released"
      );

      assert.equal(
        sidecar.events().filter((event) => event.event === "initialize").length,
        1,
        "a clean shutdown must not initialise a second engine"
      );
    });

    it("refuses a second engine, then takes over after the first is killed", async () => {
      const first = await Sidecar.start(
        makeTemporaryDirectory("sphinx-torrent-a-")
      );

      assert.equal(await portIsFree(TORRENT_PORT), false);

      const second = await Sidecar.start(
        makeTemporaryDirectory("sphinx-torrent-b-")
      );

      const secondInitialisations = second
        .events()
        .filter((event) => event.event === "initialize");

      assert.equal(secondInitialisations.length, 1);
      assert.equal(
        secondInitialisations[0]?.ok,
        false,
        "the second sidecar must not become a second engine"
      );
      assert.match(
        secondInitialisations[0]?.code ?? "",
        /EADDRINUSE/,
        "the engine port is the exclusivity boundary"
      );
      assert.ok(
        second.stderr.some((line) => line.includes("loadState failed")),
        "the failure must be reported, not hidden"
      );

      // Still one engine: the first sidecar kept the socket.
      assert.equal(await portIsFree(TORRENT_PORT), false);

      const firstPid = first.child.pid;
      assert.ok(typeof firstPid === "number");

      await first.kill();
      await second.stop();

      assert.equal(
        processIsAlive(firstPid as number),
        false,
        "the killed sidecar must be reaped, not left as an orphan"
      );

      await waitForDatabaseRelease(first.userData);

      const third = await Sidecar.start(
        makeTemporaryDirectory("sphinx-torrent-c-")
      );

      const thirdInitialisations = third
        .events()
        .filter((event) => event.event === "initialize");

      assert.equal(thirdInitialisations.length, 1);
      assert.equal(thirdInitialisations[0]?.ok, true);
      assert.equal(thirdInitialisations[0]?.port, TORRENT_PORT);

      await third.stop();

      await waitFor(
        () => portIsFree(TORRENT_PORT),
        5_000,
        "the engine socket to be released"
      );
    });

    it("stops the engine when the shell disappears (stdin closed)", async (context) => {
      if (!(await requireFreePort(context))) return;

      const sidecar = await Sidecar.start(
        makeTemporaryDirectory("sphinx-torrent-")
      );

      sidecar.closeStdin();

      const exited = await sidecar.waitForExit(10_000);
      assert.equal(
        exited,
        true,
        "a sidecar whose shell is gone must exit instead of staying as an orphan"
      );

      assert.equal(
        sidecar.child.exitCode,
        0,
        `the stdin path is an ordered shutdown, not a crash; stderr tail:\n${sidecar.stderr
          .slice(-10)
          .join("\n")}`
      );

      const shutdownEvents = sidecar
        .events()
        .filter((event) => event.event === "shutdown");
      assert.equal(shutdownEvents.length, 1);

      await waitFor(
        () => portIsFree(TORRENT_PORT),
        5_000,
        "the engine socket to be released"
      );
    });

    it("leaves exactly one engine after a hard kill and restart", async (context) => {
      if (!(await requireFreePort(context))) return;

      const userData = makeTemporaryDirectory("sphinx-torrent-restart-");

      const first = await Sidecar.start(userData);
      const firstPid = first.child.pid;
      assert.ok(typeof firstPid === "number");

      await first.kill();
      await waitForDatabaseRelease(userData);

      assert.equal(processIsAlive(firstPid as number), false);

      const restarted = await Sidecar.start(userData);

      // The log is per userData, so it holds both boots; scope the assertions to
      // the restarted process. Two boots must mean one engine each, never two in
      // one process.
      const restartedEvents = restarted
        .events()
        .filter((event) => event.pid === restarted.child.pid);

      const initialisations = restartedEvents.filter(
        (event) => event.event === "initialize"
      );
      assert.equal(initialisations.length, 1);
      assert.equal(initialisations[0]?.ok, true);
      assert.equal(
        restartedEvents.filter((event) => event.event === "shutdown").length,
        0,
        "a crash writes no resume data; only the restart may initialise"
      );
      assert.equal(
        restarted.events().filter((event) => event.event === "initialize")
          .length,
        2,
        "one engine per boot, not a second engine in the restarted process"
      );

      await restarted.stop();

      await waitFor(
        () => portIsFree(TORRENT_PORT),
        5_000,
        "the engine socket to be released"
      );
    });
  }
);
