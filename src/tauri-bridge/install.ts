/**
 * Installs `window.electron` **before any renderer module runs**.
 *
 * This must be a side-effect import at the very top of an entry file, not an
 * awaited call inside it. ES module imports are evaluated before the importing
 * module's body, and several renderer modules read `window.electron` at module
 * scope (for example `src/big-picture/src/pages/settings/content.tsx:48`
 * reads `window.electron.platform` while building a default form). In Electron
 * the preload always ran first; in Tauri nothing does, so the preload has to be
 * pulled in by the entry's *import list* rather than by its body.
 *
 * `@preload/index` calls `contextBridge.exposeInMainWorld`, which assigns
 * `globalThis.electron` synchronously. The `sphinx:ipc-event` subscription is
 * fire-and-forget: listeners are registered synchronously in a table first, so
 * no event can arrive before the subscription is live.
 */
// The preload reads `process.platform` and `process.env` at module scope, so
// the shim has to be in place before it is evaluated. Import order is the
// mechanism: this module's body runs before the next import is evaluated.
import "./process";

// `local:` artwork must be rewritten before the first `<img src>` is rendered,
// so this runs on import rather than on an explicit call.
import { installAssetUrlRewrite } from "./asset-url";

installAssetUrlRewrite();

import "@preload/index";

import { ensureSubscription, ensureStatusSubscription } from "./electron";

void ensureSubscription().catch(() => {
  // No Tauri runtime (a plain `vite dev` in a browser). `window.electron` is
  // still installed, which is what a preview needs.
});

void ensureStatusSubscription().catch(() => undefined);
