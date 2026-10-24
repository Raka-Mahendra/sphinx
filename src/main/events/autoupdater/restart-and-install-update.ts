import { registerEvent } from "../register-event";
import { UpdateManager } from "@main/services/update-manager";

/**
 * `autoUpdater.quitAndInstall()`.
 *
 * Kept synchronous because the update notification calls it from a click
 * handler (`src/main/services/notifications/index.ts:205`) and cannot await.
 */
export const restartAndInstallUpdate = () => {
  void UpdateManager.restartAndInstallUpdate();
};

const restartAndInstallUpdateEvent = async (
  _event: Electron.IpcMainInvokeEvent
) => restartAndInstallUpdate();

registerEvent("restartAndInstallUpdate", restartAndInstallUpdateEvent);
