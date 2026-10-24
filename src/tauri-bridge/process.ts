/**
 * Minimal `process` for the webview.
 *
 * `src/preload/index.ts` reads `process.platform`, `process.env.XDG_SESSION_TYPE`
 * and `process.env.PORTABLE_EXECUTABLE_FILE` at module scope. In Electron those
 * exist because the preload runs in a Node context; in a Tauri webview there is
 * no `process` at all, and the preload throws on import — which leaves a blank
 * window with no visible cause.
 *
 * Only what the preload actually reads is provided. `platform` is derived from
 * the user agent rather than guessed from the build, so a macOS or Linux build
 * reports the right value without a second source of truth.
 *
 * This module must be imported **before** `@preload/index`; see `install.ts`.
 */

type Platform = "win32" | "darwin" | "linux";

const detectPlatform = (): Platform => {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;

  if (/Windows/i.test(agent)) return "win32";
  if (/Mac OS X|Macintosh/i.test(agent)) return "darwin";
  return "linux";
};

export interface WebviewProcess {
  platform: Platform;
  env: Record<string, string | undefined>;
  /** Electron-only fields kept so `process.x` does not throw. */
  versions: Record<string, string>;
  type: "renderer";
  cwd: () => string;
  nextTick: (callback: () => void) => void;
}

const webviewProcess: WebviewProcess = {
  platform: detectPlatform(),
  // `PORTABLE_EXECUTABLE_FILE` is absent, so `isPortableVersion` is false —
  // the same answer a normal install gives in the Electron baseline.
  env: {
    NODE_ENV: import.meta.env.MODE,
  },
  versions: {},
  type: "renderer",
  cwd: () => "/",
  nextTick: (callback) => setTimeout(callback, 0),
};

const globalObject = globalThis as { process?: WebviewProcess };

if (!globalObject.process) {
  globalObject.process = webviewProcess;
}

export const webviewPlatform = webviewProcess.platform;
export const webviewEnv = webviewProcess.env;
