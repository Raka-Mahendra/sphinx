/**
 * Runtime stand-in for `@electron-toolkit/utils`.
 *
 * `src/main` uses three members: `is.dev` (a couple of log branches),
 * `electronApp.setAppUserModelId` and `optimizer.watchWindowShortcuts`, both in
 * the Electron bootstrap that the sidecar never runs. Rust owns the app user
 * model id now, so `setAppUserModelId` is a no-op rather than an error.
 */
import { shellEnvironment } from "./host.js";

export const is = {
  get dev(): boolean {
    return !shellEnvironment().isPackaged;
  },
  get prod(): boolean {
    return shellEnvironment().isPackaged;
  },
  get mac(): boolean {
    return process.platform === "darwin";
  },
  get windows(): boolean {
    return process.platform === "win32";
  },
  get linux(): boolean {
    return process.platform === "linux";
  },
};

export const electronApp = {
  setAppUserModelId: (): void => undefined,
};

export const optimizer = {
  watchWindowShortcuts: (): void => undefined,
  registerFramelessWindowIpc: (): void => undefined,
};

export default { is, electronApp, optimizer };
