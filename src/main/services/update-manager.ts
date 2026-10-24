/**
 * Updater client.
 *
 * The shell owns the update: only Rust may check, download or install anything
 * (PRD §4.E). This class is a thin RPC client that keeps the *renderer contract*
 * exactly as it was — `checkForUpdates()` still resolves to
 * `isAutoInstallAvailable`, and the two-stage UX still arrives as
 * `autoUpdaterEvent` with `{ type: "update-available", info }` and
 * `{ type: "update-downloaded" }` (`src/types/index.ts:160-162`).
 *
 * The baseline used `electron-updater`'s `autoUpdater` directly here. It emitted
 * the same two events, so the renderer cannot tell the difference.
 */
import { hostRpc } from "@main/services/shell-rpc";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import type { AppUpdaterEvent } from "@types";

type UpdateCheckResult = {
  available?: boolean;
  version?: string;
  currentVersion?: string;
  notes?: string | null;
  autoInstallAvailable?: boolean;
};

const emit = (event: AppUpdaterEvent) => {
  WindowManager.sendToAppWindows("autoUpdaterEvent", event);
};

export class UpdateManager {
  /**
   * `autoUpdater.checkForUpdates()`.
   *
   * Resolves to the baseline's flag: whether the app can install the update
   * itself. The UI uses it to choose between "download from the releases page"
   * and "install now" (`auto-update-sub-header.tsx:34-36`).
   */
  public static async checkForUpdates(): Promise<boolean> {
    let result: UpdateCheckResult;

    try {
      result = (await hostRpc().request(
        "updater.check",
        {}
      )) as UpdateCheckResult;
    } catch (error) {
      // A failed check is not an error the user needs to see; the baseline
      // swallowed `autoUpdater` rejections the same way.
      logger.error("Update check failed", error);
      return false;
    }

    if (!result?.available || !result.version) {
      return false;
    }

    emit({ type: "update-available", info: { version: result.version } });

    // Stage two: the download starts as soon as an update is announced, and the
    // banner turns into an install button when it finishes.
    try {
      await hostRpc().request("updater.download", {});
      emit({ type: "update-downloaded" });
    } catch (error) {
      // The user still sees "version available" plus the releases link, which
      // is the baseline's fallback when the download could not start.
      logger.error("Update download failed", error);
    }

    return result.autoInstallAvailable === true;
  }

  /**
   * `autoUpdater.quitAndInstall()`.
   *
   * On Windows the shell spawns the installer and exits; `on_before_exit` in
   * Rust stops the sidecar first, so the installer never has to replace a
   * `node.exe` that is still running.
   */
  public static async restartAndInstallUpdate(): Promise<void> {
    try {
      await hostRpc().request("updater.install", {});
    } catch (error) {
      logger.error("Update install failed", error);
    }
  }
}
