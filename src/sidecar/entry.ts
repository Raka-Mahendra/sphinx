/**
 * Sidecar entry point.
 *
 * The Rust shell spawns `node <this bundle>` with a set of `SPHINX_*`
 * environment variables, then talks to it over JSON Lines on stdin/stdout.
 * This file owns four things:
 *
 * 1. turning the environment into the paths `src/main/constants.ts` reads at
 *    module load, before anything else is imported;
 * 2. wiring the protocol to the baseline `ipcMain` registry, so the existing
 *    311 `registerEvent` handlers serve the renderer without being rewritten;
 * 3. running the baseline state bootstrap (`loadState`) and the recovery scan;
 * 4. the ordered shutdown that the supervisor asks for over RPC.
 */
import { SidecarRpc } from "./rpc.js";
import { isChannelAllowed, isEventChannelAllowed } from "./allowlist.js";
import {
  BrowserWindow,
  WebContents,
  app,
  attachHostRpc,
  ipcMain,
  loadShellEnvironment,
  notifyWindowReady,
  dispatchTrayClick,
  dispatchTrayEvent,
  getActiveTray,
} from "./electron-shim/index.js";
import { setFatalExitEnabled } from "./electron-shim/logger.js";

// Everything that reaches `@main` must be imported dynamically. ES module
// imports are evaluated before this file's body runs, and `src/main/constants.ts`
// reads `process.resourcesPath` at module load — which this file defines below.
// A static import of `@main/*` would therefore read it too early.

const env = loadShellEnvironment();

/**
 * Initialise i18next the way `src/main/index.ts:52` does in the Electron build.
 *
 * The sidecar replaces that bootstrap, so without this the sidecar's i18next
 * instance has no resources and `changeLanguage` throws
 * `Cannot read properties of undefined (reading 'toResolveHierarchy')` inside
 * `updateLanguagePreference`. The renderer has its own instance; this one is
 * only for main-process strings (window titles, tray text, dialogs).
 */
const initializeI18n = async (): Promise<void> => {
  try {
    const [{ default: i18n }, { default: resources }] = await Promise.all([
      import("i18next"),
      import("@locales"),
    ]);

    if (i18n.isInitialized) return;

    await i18n.init({
      resources,
      lng: env.locale.startsWith("pt") ? "pt" : env.locale.split("-")[0],
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    });
  } catch (error) {
    // Translation strings are cosmetic; a failure here must not stop boot.
    process.stderr.write(
      `[sidecar] i18n init failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }
};

// `src/main/constants.ts` reads `process.resourcesPath` while the module graph
// loads. Plain Node has no such property, so it is defined here — before any
// import that reaches constants.ts — from the directory Rust passes in.
Object.defineProperty(process, "resourcesPath", {
  value: env.resourcesPath,
  enumerable: false,
  configurable: false,
  writable: false,
});

const rpc = new SidecarRpc({
  input: process.stdin,
  output: process.stdout,
  isChannelAllowed,
  defaultShutdownTimeoutMs: 8_000,
});

attachHostRpc(rpc);

// ---------------------------------------------------------------------------
// IPC dispatch
// ---------------------------------------------------------------------------

const senderFor = (windowLabel: string | null): WebContents => {
  const window =
    (windowLabel
      ? BrowserWindow.getAllWindows().find(
          (candidate) => candidate.label === windowLabel
        )
      : null) ??
    BrowserWindow.getAllWindows()[0] ??
    null;

  if (window) return window.webContents;

  // No window is attached yet (very early boot, or every window was closed).
  // `showOpenDialog` and friends fall back to `WindowManager.mainWindow`, so a
  // detached sender is tolerated instead of throwing.
  return new WebContents(windowLabel ?? "detached", -1);
};

rpc.onInvoke(async (channel, args, context) => {
  const handler = ipcMain.invokeHandler(channel);

  if (!handler) {
    const error = new Error(`No handler registered for '${channel}'`);
    error.name = "HandlerMissing";
    throw Object.assign(error, { code: "handler_missing" });
  }

  const event = {
    sender: senderFor(context.windowLabel),
    senderFrame: null,
    frameId: 0,
    processId: process.pid,
    returnValue: undefined,
  };

  return handler(event, ...args);
});

rpc.onSend(async (channel, args, context) => {
  const event = {
    sender: senderFor(context.windowLabel),
    senderFrame: null,
    frameId: 0,
    processId: process.pid,
    returnValue: undefined,
  };

  ipcMain.fire(channel, event, args);
});

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

const shutdownStartedAt = new Map<string, number>();

const timed = (
  name: string,
  run: () => Promise<void> | void,
  timeoutMs: number
) => ({
  name,
  timeoutMs,
  run: async () => {
    const startedAt = Date.now();
    shutdownStartedAt.set(name, startedAt);
    await run();
    process.stderr.write(
      `[sidecar] shutdown step ${name} finished in ${Date.now() - startedAt}ms\n`
    );
  },
});

rpc.addShutdownHook(
  timed(
    "pauseActiveDownload",
    async () => {
      // Baseline order: cancel debrid preparations, drop the sleep blocker,
      // pause the download so its progress row survives the restart.
      const [{ DownloadOrchestrator }, { PowerSaveBlockerManager }, { DownloadManager }] =
        await Promise.all([
          import("@main/services/download-orchestrator"),
          import("@main/services/power-save-blocker"),
          import("@main/services/download/download-manager"),
        ]);

      DownloadOrchestrator.cancelPendingDebridPreparations();
      PowerSaveBlockerManager.reset();
      await DownloadManager.pauseDownload();
    },
    5_000
  )
);

rpc.addShutdownHook(
  timed(
    "shutdownEpicIntegration",
    async () => {
      // Only when the feature is on: legendary keeps its own process, and an
      // update installer must not find it holding files.
      const { isFeatureEnabled } = await import("@shared/feature-flags");
      if (!isFeatureEnabled("EPIC_INTEGRATION")) return;

      const { shutdownEpicIntegration } = await import("@main/services/epic");
      await shutdownEpicIntegration();
    },
    8_000
  )
);

rpc.addShutdownHook(
  timed(
    "stopEmulatorSessions",
    async () => {
      const { stopAllEmulatorSouvenirCaptureSessions } = await import(
        "@main/services/emulators/emulator-session-tracker"
      );
      await stopAllEmulatorSouvenirCaptureSessions();
    },
    3_000
  )
);

rpc.addShutdownHook(
  timed(
    "torrentShutdown",
    async () => {
      // Saves resume data. Without it the next start re-checks every piece.
      const { NativeAddon } = await import("@main/services/native-addon");
      await NativeAddon.torrentShutdown();
    },
    5_000
  )
);

rpc.addShutdownHook(
  timed(
    "clearGamesPlaytime",
    async () => {
      const { clearGamesPlaytime } = await import(
        "@main/services/process-watcher"
      );
      await clearGamesPlaytime();
    },
    3_000
  )
);

rpc.addShutdownHook(
  timed(
    "closeLevelDatabase",
    async () => {
      // The LevelDB lock is the reason the supervisor waits for this process to
      // exit before spawning the next one.
      const { db } = await import("@main/level");
      await db.close();
    },
    3_000
  )
);

rpc.addShutdownHook(
  timed(
    "flushLogs",
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
    500
  )
);

// ---------------------------------------------------------------------------
// Control messages
// ---------------------------------------------------------------------------

let exiting = false;

const finish = async (reason: string, timeoutMs: number): Promise<void> => {
  if (exiting) return;
  exiting = true;

  // A teardown failure must not be reported as a crash by the supervisor.
  setFatalExitEnabled(false);

  await rpc.shutdown(reason, timeoutMs);

  // Give stdout a tick to drain before the process disappears; the supervisor
  // reads `shutdown-complete` as the signal that no work was abandoned.
  setTimeout(() => process.exit(0), 30).unref();
};

rpc.setControlHandler((message) => {
  switch (message.action) {
    case "shutdown":
      void finish("shutdown-requested", message.timeoutMs);
      return;
    case "window-attached": {
      const window = BrowserWindow.adopt(
        message.label,
        message.windowId,
        message.url
      );
      void import("@main/services/window-manager").then(({ WindowManager }) => {
        WindowManager.attachExternalWindow(
          message.label,
          window as unknown as Electron.BrowserWindow
        );
      });
      return;
    }
    case "window-detached":
      BrowserWindow.release(message.label);
      void import("@main/services/window-manager").then(({ WindowManager }) => {
        WindowManager.attachExternalWindow(message.label, null);
      });
      return;
    case "deep-link":
      void import("@main/deep-link").then(({ handleDeepLinkPath }) => {
        handleDeepLinkPath(message.url);
      });
      return;
    case "second-instance":
      void import("@main/deep-link").then(({ handleSecondInstance }) => {
        handleSecondInstance(message.url, message.forceBigPicture === true);
      });
      return;
    case "tray-click":
      dispatchTrayClick(getActiveTray(), message.label);
      return;
    case "tray-event":
      dispatchTrayEvent(getActiveTray(), message.label);
      return;
    case "update-progress":
      // The baseline's `autoUpdater` emitted `download-progress`; nothing in the
      // renderer listens for it, so the value only reaches the log.
      void import("@main/services/logger").then(({ logger }) => {
        logger.debug("Update download progress", {
          downloaded: message.seq,
          total: message.timeoutMs,
        });
      });
      return;
    case "window-ready":
      // Electron's `ready-to-show`, sourced from the shell: only it sees the
      // webview finish painting. `window-manager.ts` shows every auxiliary
      // window from this event, so dropping it leaves those windows invisible.
      notifyWindowReady(message.label);
      return;
    default:
      return;
  }
});

rpc.start();

// The shell owns the process lifetime. If stdin closes, the shell is gone and
// staying alive would orphan a LevelDB lock.
process.stdin.on("end", () => void finish("shell-closed-stdin", 3_000));
process.on("SIGTERM", () => void finish("sigterm", 5_000));
process.on("SIGINT", () => void finish("sigint", 5_000));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const boot = async (): Promise<void> => {
  await initializeI18n();

  process.stderr.write(
    `[sidecar] booting pid=${process.pid} packaged=${env.isPackaged} userData=${
      env.paths.userData ?? "?"
    }\n`
  );

  try {
    const { loadState } = await import("@main/main");
    await loadState();
  } catch (error) {
    // Baseline behaviour (`src/main/index.ts:183-187`): log and continue so the
    // UI still opens, even when a migration or the network fails.
    process.stderr.write(
      `[sidecar] loadState failed: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }\n`
    );
  }

  try {
    const { runRecoveryScan } = await import("./recovery");
    const report = await runRecoveryScan();
    process.stderr.write(`[sidecar] recovery ${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(
      `[sidecar] recovery scan failed: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }\n`
    );
  }

  rpc.announceReady();
  process.stderr.write("[sidecar] ready\n");

  // Test-only hook: block the event loop so the supervisor's heartbeat watchdog
  // has something to detect. `src/sidecar/crash-recovery.test.ts` sets
  // SPHINX_TEST_FREEZE_MS; nothing else does, and the default is 0. The delay
  // starts after `ready`, so the first ping in that test is answered before the
  // freeze begins.
  const freezeMs = Number(process.env.SPHINX_TEST_FREEZE_MS ?? "0");
  if (Number.isFinite(freezeMs) && freezeMs > 0) {
    setTimeout(() => {
      const until = Date.now() + freezeMs;
      while (Date.now() < until) {
        // spin: a real hang, not a promise that never settles
      }
    }, 700);
  }
};

void boot();

export { app, rpc, isEventChannelAllowed };
