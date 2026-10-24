/**
 * Public surface of the Tauri bridge.
 *
 * The module that actually installs `window.electron` is `./install`, which the
 * entry files import for its side effect. This module re-exports the pieces
 * that are useful on their own — the `ipcRenderer`-compatible object and a
 * listener counter for tests.
 *
 * `installTauriBridge` is the awaitable form, kept for callers that need to know
 * the `sphinx:ipc-event` subscription is live before doing something. Entry
 * files do not use it, because an `await` in the module body runs too late:
 * other modules in the same import list have already been evaluated.
 */
import { whenEventStreamReady, whenStatusStreamReady } from "./electron";

export const installTauriBridge = async (): Promise<void> => {
  await Promise.all([
    whenEventStreamReady().catch(() => {
      // No Tauri runtime (a plain `vite dev` in a browser). The bridge stays
      // installed but events never arrive, which is the right failure for a
      // preview that has no shell behind it.
    }),
    whenStatusStreamReady().catch(() => undefined),
  ]);
};

export { activeChannelCount, ipcRenderer } from "./electron";
