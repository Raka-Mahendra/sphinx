/**
 * Runtime stand-in for `electron-log`.
 *
 * `src/main/services/logger.ts` configures electron-log through
 * `transports.file.resolvePathFn`, `transports.ipc.depth`, `errorHandler` and
 * `scope()`. None of that exists outside Electron, so this module reproduces the
 * same surface over plain `fs` streams:
 *
 * - one append stream per resolved path, cached, so `info.txt`, `error.txt`,
 *   `network.txt` and `achievements.txt` keep the baseline file split;
 * - the same `scope` propagation, so the achievement scope still routes to
 *   `achievements.txt`;
 * - `errorHandler.startCatching()` logs the failure and then **exits** with a
 *   non-zero code. Electron's version keeps the process alive; a sidecar that
 *   keeps running after an uncaught exception is a sidecar the supervisor can
 *   never repair, so the Tauri build deliberately differs here.
 */
import fs from "node:fs";
import path from "node:path";

export interface PathVariables {
  [key: string]: string;
}

export interface LogMessage {
  level?: string;
  scope?: string;
  data?: unknown[];
}

type ResolvePathFn = (variables: PathVariables, message?: LogMessage) => string;

interface Transport {
  level: string | false;
  resolvePathFn?: ResolvePathFn;
  depth?: number;
}

const LEVEL_ORDER = [
  "silly",
  "debug",
  "verbose",
  "info",
  "warn",
  "error",
] as const;
type Level = (typeof LEVEL_ORDER)[number];

const isLevel = (value: string): value is Level =>
  (LEVEL_ORDER as readonly string[]).includes(value);

const streams = new Map<string, fs.WriteStream>();

const streamFor = (target: string): fs.WriteStream => {
  const cached = streams.get(target);
  if (cached) return cached;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stream = fs.createWriteStream(target, { flags: "a" });
  stream.on("error", (error) => {
    process.stderr.write(`[logger] cannot write ${target}: ${error.message}\n`);
  });
  streams.set(target, stream);
  return stream;
};

const formatData = (data: unknown[]): string =>
  data
    .map((item) => {
      if (typeof item === "string") return item;
      if (item instanceof Error) return item.stack ?? item.message;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    })
    .join(" ");

class ScopedLogger {
  public readonly transports: {
    file: Transport;
    ipc: Transport;
    console: Transport;
  };
  public readonly variables: PathVariables = {};

  constructor(
    private readonly scopeName: string | undefined,
    transports: { file: Transport; ipc: Transport; console: Transport }
  ) {
    this.transports = transports;
  }

  public scope(name: string): ScopedLogger {
    const next = this.scopeName ? `${this.scopeName}/${name}` : name;
    return new ScopedLogger(next, this.transports);
  }

  public create(options: { logId?: string }): ScopedLogger {
    return new ScopedLogger(this.scopeName ?? options.logId, this.transports);
  }

  public silly(...data: unknown[]): void {
    this.write("silly", data);
  }

  public debug(...data: unknown[]): void {
    this.write("debug", data);
  }

  public verbose(...data: unknown[]): void {
    this.write("verbose", data);
  }

  public info(...data: unknown[]): void {
    this.write("info", data);
  }

  public warn(...data: unknown[]): void {
    this.write("warn", data);
  }

  public error(...data: unknown[]): void {
    this.write("error", data);
  }

  public log(...data: unknown[]): void {
    this.write("info", data);
  }

  public initialize(): void {
    // No preload to talk to; kept for API compatibility.
  }

  private write(level: string, data: unknown[]): void {
    const message: LogMessage = { level, scope: this.scopeName, data };
    const line = `[${new Date().toISOString()}] [${level}] ${
      this.scopeName ? `(${this.scopeName}) ` : ""
    }${formatData(data)}\n`;

    process.stderr.write(line);

    const fileTransport = this.transports.file;
    if (fileTransport.level === false) return;

    const minimum = isLevel(fileTransport.level)
      ? fileTransport.level
      : "silly";
    if (LEVEL_ORDER.indexOf(level as Level) < LEVEL_ORDER.indexOf(minimum))
      return;

    let target: string;
    try {
      target = fileTransport.resolvePathFn
        ? fileTransport.resolvePathFn(this.variables, message)
        : path.join(process.cwd(), "sphinx-sidecar.log");
    } catch (error) {
      process.stderr.write(
        `[logger] resolvePathFn threw: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
      return;
    }

    streamFor(target).write(line);
  }
}

const fileTransport: Transport = { level: "silly", resolvePathFn: undefined };
const ipcTransport: Transport = { level: false, depth: 1 };
const consoleTransport: Transport = { level: "silly" };

const root = new ScopedLogger(undefined, {
  file: fileTransport,
  ipc: ipcTransport,
  console: consoleTransport,
});

/**
 * Whether an uncaught error should terminate the process.
 *
 * Kept for symmetry with `setFatalExitEnabled`, but the default is `false` and
 * nothing sets it to `true`. Reason: `loadState()` calls
 * `Ludusavi.copyBinaryToUserData()` without a catch (baseline behaviour,
 * `docs/baseline-behavior.md` §1), so a missing optional binary produces an
 * unhandled rejection. Killing the process for that turned into a restart loop
 * and a UI that never settled. A *wedged* process is what the supervisor's
 * heartbeat is for; an error that leaves the loop running is not a wedge.
 */
let fatalExitEnabled = false;

export const setFatalExitEnabled = (enabled: boolean): void => {
  fatalExitEnabled = enabled;
};

const errorHandler = {
  startCatching: (options?: { showDialog?: boolean }): void => {
    const handle = (label: string, error: unknown): void => {
      root.error(label, error);

      if (!fatalExitEnabled) return;

      setTimeout(() => process.exit(1), 50).unref();
      void options;
    };

    process.on("uncaughtException", (error) =>
      handle("uncaughtException", error)
    );
    process.on("unhandledRejection", (reason) =>
      handle("unhandledRejection", reason)
    );
  },
  showDialog: false,
};

const logger = Object.assign(root, { errorHandler });

export default logger;
