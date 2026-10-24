import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  net,
  powerMonitor,
  protocol,
} from "electron";
import i18n from "i18next";
import path from "node:path";
import url from "node:url";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import {
  logger,
  clearGamesPlaytime,
  WindowManager,
  Lock,
  PowerSaveBlockerManager,
  DownloadOrchestrator,
  SSEClient,
  emulators,
} from "@main/services";
import resources from "@locales";
import { TorrentService } from "./services/torrent-service";
import { DownloadManager } from "./services/download/download-manager";
import { db, levelKeys } from "./level";
import { handleDeepLinkPath } from "./deep-link";
import { refreshPortableShortcutLauncher } from "./helpers/shortcut-launch";
import { loadState } from "./main";
import { isFeatureEnabled } from "./feature-flags";
import {
  initializeEpicIntegration,
  shutdownEpicIntegration,
  suspendEpicPlaytime,
  resumeEpicPlaytime,
} from "./services/epic";

crashReporter.start({
  uploadToServer: false,
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

i18n.init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

const PROTOCOL = "sphinx";

// Register the custom schemes as privileged so the renderer can fetch them
// (supportFetchAPI) and use the results on a canvas without tainting it
// (corsEnabled). Must run before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local",
    privileges: { supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: "gradient",
    privileges: { supportFetchAPI: true, corsEnabled: true },
  },
]);

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

const initializeApp = async () => {
  refreshPortableShortcutLauncher();
  electronApp.setAppUserModelId("gg.sphinx.launcher");

  logger.info("Crash dumps directory", app.getPath("crashDumps"));

  protocol.handle("local", (request) => {
    const filePath = request.url.slice("local:".length);
    return net.fetch(url.pathToFileURL(decodeURI(filePath)).toString());
  });

  protocol.handle("gradient", (request) => {
    const gradientCss = decodeURIComponent(
      request.url.slice("gradient:".length)
    );

    // Parse gradient CSS safely without regex to prevent ReDoS
    let direction = "45deg";
    let color1 = "#4a90e2";
    let color2 = "#7b68ee";

    // Simple string parsing approach - more secure than regex
    if (
      gradientCss.startsWith("linear-gradient(") &&
      gradientCss.endsWith(")")
    ) {
      const content = gradientCss.slice(16, -1); // Remove "linear-gradient(" and ")"
      const parts = content.split(",").map((part) => part.trim());

      if (parts.length >= 3) {
        direction = parts[0];
        color1 = parts[1];
        color2 = parts[2];
      }
    }

    let x1 = "0%",
      y1 = "0%",
      x2 = "100%",
      y2 = "100%";

    if (direction === "to right") {
      y2 = "0%";
    } else if (direction === "to bottom") {
      x2 = "0%";
    } else if (direction === "45deg") {
      y1 = "100%";
      y2 = "0%";
    } else if (direction === "225deg") {
      x1 = "100%";
      x2 = "0%";
    } else if (direction === "315deg") {
      x1 = "100%";
      y1 = "100%";
      x2 = "0%";
      y2 = "0%";
    }
    // Note: "135deg" case removed as it uses all default values

    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <defs>
          <linearGradient id="grad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
            <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
      </svg>
    `;

    return new Response(svgContent, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  });

  try {
    await loadState();
  } catch (error) {
    logger.error("Failed to load app state during startup", error);
  }
  if (isFeatureEnabled("EPIC_INTEGRATION")) {
    // Optional integration failures must not interrupt launcher startup.
    await initializeEpicIntegration().catch(() => {
      logger.warn("Epic integration initialization unavailable");
    });
  }

  // Suspend can outlive the 60s stall watchdog; reconnect right away instead
  if (isFeatureEnabled("EPIC_INTEGRATION")) {
    powerMonitor.on("suspend", suspendEpicPlaytime);
  }
  powerMonitor.on("resume", () => {
    if (isFeatureEnabled("EPIC_INTEGRATION")) {
      resumeEpicPlaytime();
    }
    if (isFeatureEnabled("HYDRA_ACCOUNT_FEATURES")) {
      SSEClient.reconnectNow();
    }
    DownloadOrchestrator.onNetworkStatusChanged({
      online: true,
      switched: true,
    });
  });

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .catch(() => "en");

  if (language) i18n.changeLanguage(language);

  // Check if starting from a "run" deep link - don't show main window in that case
  const deepLinkArg = process.argv.find((arg) => arg.startsWith("sphinx://"));
  const forceBigPicture = process.argv.includes("--big-picture");
  const isRunDeepLink = deepLinkArg?.startsWith("sphinx://run");

  if (!process.argv.includes("--hidden") && !isRunDeepLink) {
    WindowManager.createMainWindow({ forceBigPicture });
  }

  WindowManager.createSystemTray(language || "en");

  if (deepLinkArg) {
    handleDeepLinkPath(deepLinkArg);
  }
};

app.on("browser-window-created", (_, window) => {
  optimizer.watchWindowShortcuts(window);
});

app.on("child-process-gone", (_event, details) => {
  logger.error("Child process gone", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
    name: details.name,
  });
});

app.on("render-process-gone", (_event, _webContents, details) => {
  logger.error("Render process gone", {
    reason: details.reason,
    exitCode: details.exitCode,
  });
});

app.on("second-instance", (_event, commandLine) => {
  const deepLink = commandLine.find((arg) => arg.startsWith("sphinx://"));
  const forceBigPicture = commandLine.includes("--big-picture");

  // Check if this is a "run" deep link - don't show main window in that case
  const isRunDeepLink = deepLink?.startsWith("sphinx://run");

  if (!isRunDeepLink) {
    if (WindowManager.mainWindow) {
      if (WindowManager.mainWindow.isMinimized())
        WindowManager.mainWindow.restore();

      WindowManager.mainWindow.focus();
      if (forceBigPicture) {
        void WindowManager.openBigPictureWindow();
      }
    } else {
      WindowManager.createMainWindow({ forceBigPicture });
    }
  }

  handleDeepLinkPath(deepLink);
});

app.on("open-url", (_event, url) => {
  handleDeepLinkPath(url);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  WindowManager.clearMainWindow();
});

let canAppBeClosed = false;
let isAppClosing = false;

app.on("before-quit", async (e) => {
  if (!canAppBeClosed) {
    e.preventDefault();
    if (isAppClosing) return;
    isAppClosing = true;
    if (isFeatureEnabled("EPIC_INTEGRATION")) {
      try {
        await shutdownEpicIntegration();
      } catch {
        isAppClosing = false;
        logger.error(
          "Epic operation shutdown is unconfirmed; application remains open"
        );
        dialog.showErrorBox(
          i18n.t("settings.epic_games"),
          i18n.t("settings.epic_shutdown_failed")
        );
        return;
      }
    }
    DownloadOrchestrator.cancelPendingDebridPreparations();
    PowerSaveBlockerManager.reset();
    try {
      await DownloadManager.pauseDownload();
    } catch (error) {
      logger.error("Could not save active download before quitting", error);
    }
    const results = await Promise.allSettled([
      Lock.releaseLock(),
      TorrentService.shutdown(),
      clearGamesPlaytime(),
      emulators.stopAllEmulatorSouvenirCaptureSessions(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        logger.error("Application shutdown cleanup failed", result.reason);
      }
    }
    canAppBeClosed = true;
    app.quit();
  }
});

app.on("will-quit", () => {
  logger.info("Application will quit");
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    WindowManager.createMainWindow();
  }
});

// Some Electron APIs can only be used after initialization finishes.
// Top-level await blocks Electron startup when running through electron-vite.
app.once("ready", initializeApp);

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
