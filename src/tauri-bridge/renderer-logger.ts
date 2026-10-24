/**
 * `electron-log/renderer` replacement for the webview.
 *
 * The renderer imports `electron-log/renderer` for `logger.scope(...)`. That
 * module talks to Electron's main process over IPC; in a Tauri webview it
 * throws on import, which takes the whole entry module down and leaves a blank
 * window with nothing in the console to explain it.
 *
 * This keeps the same shape (`log.scope(name)` returning
 * debug/info/warn/error/verbose) and writes to the webview console. Routing
 * renderer logs into the sidecar's log files needs an IPC channel that the
 * generated allowlist does not have yet, so that is a Fase 6 item — until then
 * the browser console and the sidecar log are two separate places, which is
 * documented in docs/sidecar.md.
 */

export type LogLevel =
  | "silly"
  | "debug"
  | "verbose"
  | "info"
  | "warn"
  | "error";

interface ScopedLogger {
  silly: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  verbose: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  scope: (name: string) => ScopedLogger;
}

const write = (level: LogLevel, scope: string, args: unknown[]): void => {
  const prefix = `[${new Date().toISOString()}] [${level}]${
    scope ? ` (${scope})` : ""
  }`;

  if (level === "error" || level === "warn") {
    console.error(prefix, ...args);
    return;
  }

  console.log(prefix, ...args);
};

const makeLogger = (scopeName: string): ScopedLogger => ({
  silly: (...args) => write("silly", scopeName, args),
  debug: (...args) => write("debug", scopeName, args),
  verbose: (...args) => write("verbose", scopeName, args),
  info: (...args) => write("info", scopeName, args),
  warn: (...args) => write("warn", scopeName, args),
  error: (...args) => write("error", scopeName, args),
  log: (...args) => write("info", scopeName, args),
  scope: (name) => makeLogger(scopeName ? `${scopeName}/${name}` : name),
});

const logger = makeLogger("");

export default logger;
