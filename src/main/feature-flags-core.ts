// SPDX-License-Identifier: Apache-2.0

import {
  FeatureUnavailableError,
  isFeatureEnabled,
  type FeatureFlag,
} from "../shared/feature-flags.js";

const channelFlags: Readonly<Record<string, FeatureFlag>> = {
  getAuth: "HYDRA_ACCOUNT_FEATURES",
  getMe: "HYDRA_ACCOUNT_FEATURES",
  updateProfile: "HYDRA_ACCOUNT_FEATURES",
  cropProfileImage: "HYDRA_ACCOUNT_FEATURES",
  getProfileImageMetadata: "HYDRA_ACCOUNT_FEATURES",
  processProfileImage: "HYDRA_ACCOUNT_FEATURES",
  openCheckout: "HYDRA_ACCOUNT_FEATURES",
  syncDownloadSources: "HYDRA_ACCOUNT_FEATURES",
  getRemoteLibrarySyncState: "HYDRA_ACCOUNT_FEATURES",
  assignGameToCollection: "HYDRA_ACCOUNT_FEATURES",

  deleteAchievementSouvenir: "ACHIEVEMENTS",
  getUnlockedAchievements: "ACHIEVEMENTS",
  resetGameAchievements: "ACHIEVEMENTS",
  getComparedUnlockedAchievements: "ACHIEVEMENTS",
  getRetroAchievementsAchievements: "ACHIEVEMENTS",
  resetRetroAchievementsAchievements: "ACHIEVEMENTS",
  achievementNotificationContentReady: "ACHIEVEMENTS",
  achievementNotificationFailed: "ACHIEVEMENTS",
  achievementNotificationFinished: "ACHIEVEMENTS",
  achievementNotificationHostReady: "ACHIEVEMENTS",
  showAchievementTestNotification: "ACHIEVEMENTS",
  updateAchievementCustomNotificationWindow: "ACHIEVEMENTS",
  getAchievementSouvenirSyncStatus: "ACHIEVEMENTS",
  getAchievementSouvenirSyncDetails: "ACHIEVEMENTS",
  retryAchievementSouvenirSync: "ACHIEVEMENTS",
  cleanupAchievementSouvenirSync: "ACHIEVEMENTS",

  cancelSteamSync: "STEAM_INTEGRATION",
  disconnectSteam: "STEAM_INTEGRATION",
  getSteamSyncState: "STEAM_INTEGRATION",
  reconcileSteamSyncRun: "STEAM_INTEGRATION",
  startSteamOAuth: "STEAM_INTEGRATION",
  startSteamSync: "STEAM_INTEGRATION",
  syncSteamGameOnGamePage: "STEAM_INTEGRATION",

  cancelEpicAuth: "EPIC_INTEGRATION",
  cancelEpicGameInstallOptions: "EPIC_INTEGRATION",
  cancelEpicSync: "EPIC_INTEGRATION",
  disconnectEpic: "EPIC_INTEGRATION",
  getEpicCloudSaveState: "EPIC_INTEGRATION",
  getEpicConnection: "EPIC_INTEGRATION",
  getEpicGameInstallOptions: "EPIC_INTEGRATION",
  getEpicSyncState: "EPIC_INTEGRATION",
  getGameLinuxCompatibility: "EPIC_INTEGRATION",
  resolveEpicCloudSaveConflict: "EPIC_INTEGRATION",
  setEpicCloudSaveSettings: "EPIC_INTEGRATION",
  startEpicAuth: "EPIC_INTEGRATION",
  startEpicGameDownload: "EPIC_INTEGRATION",
  startEpicSync: "EPIC_INTEGRATION",
  syncEpicCloudSaves: "EPIC_INTEGRATION",
  syncEpicGameOnGamePage: "EPIC_INTEGRATION",

  confirmCloudSaveCustomPathApproval: "HYDRA_CLOUD_LEGACY",
  deleteGameCloudSaveData: "HYDRA_CLOUD_LEGACY",
  dismissCloudSaveCustomPathApproval: "HYDRA_CLOUD_LEGACY",
  downloadGameArtifact: "HYDRA_CLOUD_LEGACY",
  cancelGameArtifactExport: "HYDRA_CLOUD_LEGACY",
  exportGameArtifact: "HYDRA_CLOUD_LEGACY",
  getCloudSaveOverview: "HYDRA_CLOUD_LEGACY",
  getCloudSaveV2FileDetails: "HYDRA_CLOUD_LEGACY",
  getGameBackupPreview: "HYDRA_CLOUD_LEGACY",
  getPendingCloudSaveCustomPathApproval: "HYDRA_CLOUD_LEGACY",
  getRpcs3DiscIdentityStatus: "HYDRA_CLOUD_LEGACY",
  confirmCloudSaveCustomPathRebindApproval: "HYDRA_CLOUD_LEGACY",
  createCloudSaveCustomPathRebindApproval: "HYDRA_CLOUD_LEGACY",
  removeCloudSaveCustomPath: "HYDRA_CLOUD_LEGACY",
  removeEmulatorDestination: "HYDRA_CLOUD_LEGACY",
  resolveCloudSaveConflict: "HYDRA_CLOUD_LEGACY",
  getRetroArchLegacyBatteryCandidates: "HYDRA_CLOUD_LEGACY",
  getRetroArchLocalBatteryCandidates: "HYDRA_CLOUD_LEGACY",
  selectRetroArchLegacyBattery: "HYDRA_CLOUD_LEGACY",
  selectRetroArchLocalBattery: "HYDRA_CLOUD_LEGACY",
  selectCloudSaveCustomPath: "HYDRA_CLOUD_LEGACY",
  selectCloudSaveCustomPathApproval: "HYDRA_CLOUD_LEGACY",
  selectEmulatorDestination: "HYDRA_CLOUD_LEGACY",
  selectGameBackupPath: "HYDRA_CLOUD_LEGACY",
  setCloudSaveAutomaticSyncEnabled: "HYDRA_CLOUD_LEGACY",
  syncCloudSaveAfterCustomPathRebind: "HYDRA_CLOUD_LEGACY",
  syncCloudSaveOnGamePage: "HYDRA_CLOUD_LEGACY",
  syncGameCloudSave: "HYDRA_CLOUD_LEGACY",
  syncGameCloudSaveFromModal: "HYDRA_CLOUD_LEGACY",
  uploadSaveGame: "HYDRA_CLOUD_LEGACY",
  toggleAutomaticCloudSync: "HYDRA_CLOUD_LEGACY",
  uploadEmulationSave: "HYDRA_CLOUD_LEGACY",
  uploadEmulationSavesForCard: "HYDRA_CLOUD_LEGACY",
  uploadWiiEmulationSave: "HYDRA_CLOUD_LEGACY",
  getActiveEmulationBackups: "HYDRA_CLOUD_LEGACY",
  notifyCloudGiftResolved: "HYDRA_CLOUD_LEGACY",
  getCloudIframeUrl: "HYDRA_CLOUD_LEGACY",

  openChatWindow: "HYDRA_ACCOUNT_FEATURES",
  consumePendingChatFriends: "HYDRA_ACCOUNT_FEATURES",
  getChatUnreadState: "HYDRA_ACCOUNT_FEATURES",
  markChatRead: "HYDRA_ACCOUNT_FEATURES",
  openGameInMainWindow: "HYDRA_ACCOUNT_FEATURES",
  setChatWindowState: "HYDRA_ACCOUNT_FEATURES",
  closeChatWindow: "HYDRA_ACCOUNT_FEATURES",
  minimizeChatWindow: "HYDRA_ACCOUNT_FEATURES",
  uploadChatAttachment: "HYDRA_ACCOUNT_FEATURES",
  openFriendsWindow: "HYDRA_ACCOUNT_FEATURES",
  closeFriendsWindow: "HYDRA_ACCOUNT_FEATURES",
  friendsWindowReady: "HYDRA_ACCOUNT_FEATURES",
  minimizeFriendsWindow: "HYDRA_ACCOUNT_FEATURES",
  openAddFriendModalInMainWindow: "HYDRA_ACCOUNT_FEATURES",
  openFriendProfileInMainWindow: "HYDRA_ACCOUNT_FEATURES",
  getFriendsSnapshot: "HYDRA_ACCOUNT_FEATURES",
  prefetchFriends: "HYDRA_ACCOUNT_FEATURES",
  syncFriendRequests: "HYDRA_ACCOUNT_FEATURES",

  openRetroAchievementsConnectionWindow: "ACHIEVEMENTS",
  closeRetroAchievementsConnectionWindow: "ACHIEVEMENTS",
  minimizeRetroAchievementsConnectionWindow: "ACHIEVEMENTS",
  completeRetroAchievementsConnectionWindow: "ACHIEVEMENTS",
};

export const featureForChannel = (channel: string): FeatureFlag | undefined =>
  channelFlags[channel];

export const requireFeature = (flag: FeatureFlag): void => {
  if (isFeatureEnabled(flag)) return;

  throw new FeatureUnavailableError(flag);
};

export const requireFeatureChannel = (channel: string): void => {
  const flag = featureForChannel(channel);
  if (!flag) return;

  requireFeature(flag);
};

export const gatedChannels = (): readonly string[] =>
  Object.freeze(Object.keys(channelFlags));
