import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getGoogleDriveState,
  updateGoogleDriveSettings,
} from "@main/services/google-drive";
import type {
  GoogleDriveDisconnectResult,
  GoogleDriveSettings,
  GoogleDriveState,
} from "@types";

import { registerEvent } from "../register-event";

// These channels are not gated by HYDRA_CLOUD_LEGACY: Google Drive is the cloud
// save provider now, and the Hydra flag only controls Hydra's own backend.
registerEvent(
  "getGoogleDriveState",
  (): Promise<GoogleDriveState> => getGoogleDriveState()
);

registerEvent(
  "connectGoogleDrive",
  (): Promise<GoogleDriveState> => connectGoogleDrive()
);

registerEvent(
  "disconnectGoogleDrive",
  (
    _event: Electron.IpcMainInvokeEvent,
    deleteCloudData?: boolean
  ): Promise<GoogleDriveDisconnectResult> =>
    disconnectGoogleDrive(deleteCloudData === true)
);

registerEvent(
  "setGoogleDriveSettings",
  (
    _event: Electron.IpcMainInvokeEvent,
    settings?: Partial<GoogleDriveSettings>
  ): Promise<GoogleDriveSettings> => updateGoogleDriveSettings(settings)
);
