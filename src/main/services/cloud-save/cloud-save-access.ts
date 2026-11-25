import {
  assertGoogleDriveReady,
  isGoogleDriveConfigured,
  isGoogleDriveConnected,
} from "../google-drive/index.js";

/**
 * Cloud saves are backed by the user's own Google Drive now, so there is no
 * Hydra subscription to check. Access is simply "Drive is configured in this
 * build and the user connected it"; the legacy `SubscriptionRequiredError`
 * path is gone (PRD §4.F).
 */
export const assertCloudSaveAvailable = async (): Promise<void> => {
  await assertGoogleDriveReady();
};

export const isCloudSaveAvailable = async (): Promise<boolean> =>
  isGoogleDriveConfigured() && (await isGoogleDriveConnected());
