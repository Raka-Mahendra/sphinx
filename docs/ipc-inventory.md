# IPC inventory

**Generated file — do not edit.** Produced by `scripts/generate-ipc-allowlist.mjs`
from `src/main`. The Fase 0 hand-written audit is preserved in
`docs/ipc-inventory-audit.md`; this file is the build-time truth consumed by
both the Rust shell and the sidecar.

## Totals

| Kind | Count | Reaches |
| --- | ---: | --- |
| Renderer → sidecar (`ipcMain.handle` / `registerEvent`) | 346 | `ipc_invoke` |
| Renderer → sidecar (`ipcMain.on`) | 0 | `ipc_send` |
| Sidecar → renderer, static | 72 | `sphinx:ipc-event` |
| Sidecar → renderer, dynamic prefixes | 6 | `sphinx:ipc-event` |
| Forwarder call sites (channel passed as a parameter) | 9 | resolved above |

## Renderer → sidecar channels

| Channel | Registered at |
| --- | --- |
| `achievementNotificationContentReady` | `src/main/events/notifications/achievement-notification-lifecycle.ts:10` |
| `achievementNotificationFailed` | `src/main/events/notifications/achievement-notification-lifecycle.ts:27` |
| `achievementNotificationFinished` | `src/main/events/notifications/achievement-notification-lifecycle.ts:20` |
| `achievementNotificationHostReady` | `src/main/events/notifications/achievement-notification-lifecycle.ts:4` |
| `addCustomGameToLibrary` | `src/main/events/library/add-custom-game-to-library.ts:69` |
| `addCustomTheme` | `src/main/events/themes/add-custom-theme.ts:12` |
| `addDownloadSource` | `src/main/events/download-sources/add-download-source.ts:50` |
| `addEmulatorRomPath` | `src/main/events/emulators/emulator-rom-paths.ts:43` |
| `addGameToFavorites` | `src/main/events/library/add-game-to-favorites.ts:30` |
| `addGameToLibrary` | `src/main/events/library/add-game-to-library.ts:91` |
| `addGameToQueue` | `src/main/events/torrenting/add-game-to-queue.ts:117` |
| `addRetroArchRomFolder` | `src/main/events/retroarch/add-retroarch-rom-folder.ts:30` |
| `addRomFolder` | `src/main/events/emulators/add-rom-folder.ts:30` |
| `addScannedGames` | `src/main/events/library/add-scanned-game.ts:34` |
| `assignGameToCollection` | `src/main/events/library/assign-game-to-collection.ts:58` |
| `authenticateAllDebrid` | `src/main/events/user-preferences/authenticate-all-debrid.ts:14` |
| `authenticatePremiumize` | `src/main/events/user-preferences/authenticate-premiumize.ts:14` |
| `authenticateRealDebrid` | `src/main/events/user-preferences/authenticate-real-debrid.ts:14` |
| `authenticateTorBox` | `src/main/events/user-preferences/authenticate-torbox.ts:14` |
| `autoLaunch` | `src/main/events/user-preferences/auto-launch.ts:28` |
| `cancelEpicAuth` | `src/main/events/epic/index.ts:36` |
| `cancelEpicGameInstallOptions` | `src/main/events/epic/index.ts:105` |
| `cancelEpicSync` | `src/main/events/epic/index.ts:53` |
| `cancelGameArtifactExport` | `src/main/events/cloud-save/export-game-artifact.ts:170` |
| `cancelGameDownload` | `src/main/events/torrenting/cancel-game-download.ts:14` |
| `cancelGameTransfer` | `src/main/events/library/transfer-game-files.ts:414` |
| `cancelLaunchboxImport` | `src/main/events/emulators/import-launchbox-roms.ts:1085` |
| `cancelPs1MemcardScan` | `src/main/events/emulators/scan-ps1-memcards.ts:295` |
| `cancelPs2MemcardScan` | `src/main/events/emulators/scan-ps2-memcards.ts:295` |
| `cancelRetroArchImport` | `src/main/events/retroarch/import-retroarch-roms.ts:758` |
| `cancelScanInstalledGames` | `src/main/events/library/scan-installed-games.ts:1204` |
| `cancelSteamSync` | `src/main/events/user/cancel-steam-sync.ts:6` |
| `canInstallCommonRedist` | `src/main/events/misc/can-install-common-redist.ts:7` |
| `changeGamePlayTime` | `src/main/events/library/change-game-playtime.ts:61` |
| `changeRetroArchRomFolder` | `src/main/events/retroarch/change-retroarch-rom-folder.ts:55` |
| `checkEmulatorBios` | `src/main/events/emulators/check-emulator-bios.ts:36` |
| `checkEmulatorExecutable` | `src/main/events/emulators/check-emulator-executable.ts:16` |
| `checkFolderWritePermission` | `src/main/events/hardware/check-folder-write-permission.ts:21` |
| `checkForUpdates` | `src/main/events/autoupdater/check-for-updates.ts:8` |
| `checkHomebrewFolderExists` | `src/main/events/misc/check-homebrew-folder-exists.ts:13` |
| `checkPs3Firmware` | `src/main/events/emulators/check-ps3-firmware.ts:12` |
| `checkRetroArchExecutable` | `src/main/events/retroarch/check-retroarch-executable.ts:14` |
| `checkSteamShortcut` | `src/main/events/library/check-steam-shortcut.ts:102` |
| `cleanupAchievementSouvenirSync` | `src/main/events/index.ts:50` |
| `cleanupUnusedAssets` | `src/main/events/library/cleanup-unused-assets.ts:90` |
| `clearAllLocalNotifications` | `src/main/events/notifications/clear-all-local-notifications.ts:8` |
| `clearNewDownloadOptions` | `src/main/events/library/clear-new-download-options.ts:27` |
| `clipboardWriteText` | `src/main/events/misc/clipboard-write-text.ts:11` |
| `closeChatWindow` | `src/main/events/chat/chat-window-controls.ts:8`, `src/main/events/register-disabled-account-events.ts:9` |
| `closeEditorWindow` | `src/main/events/themes/close-editor-window.ts:11` |
| `closeFriendsWindow` | `src/main/events/friends/friends-window-controls.ts:8`, `src/main/events/register-disabled-account-events.ts:9` |
| `closeGame` | `src/main/events/library/close-game.ts:125` |
| `closeGameLauncherWindow` | `src/main/events/misc/close-game-launcher-window.ts:8` |
| `closeMainWindow` | `src/main/events/main-window-controls.ts:12` |
| `closeRetroAchievementsConnectionWindow` | `src/main/events/user/retroachievements-connection-window.ts:13` |
| `completeRetroAchievementsConnectionWindow` | `src/main/events/user/retroachievements-connection-window.ts:17` |
| `confirmCloudSaveCustomPathApproval` | `src/main/events/cloud-save/confirm-cloud-save-custom-path-approval.ts:11` |
| `confirmCloudSaveCustomPathRebindApproval` | `src/main/events/cloud-save/rebind-cloud-save-custom-path.ts:48` |
| `consumePendingChatFriends` | `src/main/events/chat/open-chat-window.ts:9`, `src/main/events/register-disabled-account-events.ts:9` |
| `copyCustomGameAsset` | `src/main/events/library/copy-custom-game-asset.ts:36` |
| `copyThemeAchievementSound` | `src/main/events/themes/copy-theme-achievement-sound.ts:40` |
| `createCloudSaveCustomPathRebindApproval` | `src/main/events/cloud-save/rebind-cloud-save-custom-path.ts:28` |
| `createGameShortcut` | `src/main/events/library/create-game-shortcut.ts:286` |
| `createSteamShortcut` | `src/main/events/library/create-steam-shortcut.ts:258` |
| `cropProfileImage` | `src/main/events/profile/crop-profile-image.ts:136` |
| `deleteAchievementSouvenir` | `src/main/events/user/delete-achievement-souvenir.ts:29` |
| `deleteAllCustomThemes` | `src/main/events/themes/delete-all-custom-themes.ts:8` |
| `deleteArchive` | `src/main/events/library/delete-archive.ts:52` |
| `deleteCustomTheme` | `src/main/events/themes/delete-custom-theme.ts:11` |
| `deleteEmulationSave` | `src/main/events/emulators/emulation-saves.ts:42` |
| `deleteGameCloudSaveData` | `src/main/events/cloud-save/delete-game-cloud-save-data.ts:7` |
| `deleteGameFolder` | `src/main/events/library/delete-game-folder.ts:223` |
| `deleteLocalNotification` | `src/main/events/notifications/delete-local-notification.ts:11` |
| `deleteSteamShortcut` | `src/main/events/library/delete-steam-shortcut.ts:107` |
| `deleteTempFile` | `src/main/events/misc/delete-temp-file.ts:18` |
| `detectEmulator` | `src/main/events/emulators/detect-emulator.ts:40` |
| `detectEmulators` | `src/main/events/emulators/detect-emulators.ts:43` |
| `detectRetroArch` | `src/main/events/retroarch/detect-retroarch.ts:41` |
| `disconnectEpic` | `src/main/events/epic/index.ts:40` |
| `disconnectSteam` | `src/main/events/user/disconnect-steam.ts:137` |
| `dismissCloudSaveCustomPathApproval` | `src/main/events/cloud-save/dismiss-cloud-save-custom-path-approval.ts:8` |
| `downloadGameArtifact` | `src/main/events/cloud-save/download-game-artifact.ts:169` |
| `downloadGameArtwork` | `src/main/events/library/download-game-artwork.ts:131` |
| `executeSystemPowerAction` | `src/main/events/big-picture/system-power.ts:8` |
| `exportGameArtifact` | `src/main/events/cloud-save/export-game-artifact.ts:169` |
| `exportPs1Save` | `src/main/events/emulators/export-ps1-save.ts:44` |
| `exportPs2Save` | `src/main/events/emulators/export-ps2-save.ts:44` |
| `extractGameDownload` | `src/main/events/library/extract-game-download.ts:116` |
| `forgetPs1MemcardCard` | `src/main/events/emulators/ps1-memcard-saves.ts:41` |
| `forgetPs1MemcardSave` | `src/main/events/emulators/ps1-memcard-saves.ts:40` |
| `forgetPs2MemcardCard` | `src/main/events/emulators/ps2-memcard-saves.ts:41` |
| `forgetPs2MemcardSave` | `src/main/events/emulators/ps2-memcard-saves.ts:40` |
| `friendsWindowReady` | `src/main/events/friends/friends-window-controls.ts:12`, `src/main/events/register-disabled-account-events.ts:9` |
| `getAchievementSouvenirSyncDetails` | `src/main/events/index.ts:44` |
| `getAchievementSouvenirSyncStatus` | `src/main/events/index.ts:41` |
| `getActiveClassicsImport` | `src/main/events/emulators/get-active-classics-import.ts:6` |
| `getActiveCustomTheme` | `src/main/events/themes/get-active-custom-theme.ts:9` |
| `getActiveEmulationBackups` | `src/main/events/emulators/upload-emulation-save.ts:363` |
| `getActiveRetroArchImport` | `src/main/events/retroarch/get-active-retroarch-import.ts:8` |
| `getAllCustomThemes` | `src/main/events/themes/get-all-custom-themes.ts:8` |
| `getAppSessionId` | `src/main/events/misc/get-app-session-id.ts:9` |
| `getAuth` | `src/main/events/user/get-auth.ts:11` |
| `getAvailableDrives` | `src/main/events/library/get-available-drives.ts:138` |
| `getChatUnreadState` | `src/main/events/chat/chat-state.ts:24`, `src/main/events/register-disabled-account-events.ts:9` |
| `getClassicsImportStatus` | `src/main/events/emulators/get-classics-import-status.ts:6` |
| `getCloudIframeUrl` | `src/main/events/index.ts:53` |
| `getCloudSaveOverview` | `src/main/events/cloud-save/get-cloud-save-overview.ts:6` |
| `getCloudSaveV2FileDetails` | `src/main/events/cloud-save/get-cloud-save-v2-file-details.ts:6` |
| `getComparedUnlockedAchievements` | `src/main/events/user/get-compared-unlocked-achievements.ts:71` |
| `getCoverPoster` | `src/main/events/catalogue/get-cover-poster.ts:207` |
| `getCustomThemeById` | `src/main/events/themes/get-custom-theme-by-id.ts:11` |
| `getDebridFiles` | `src/main/events/torrenting/get-debrid-files.ts:62` |
| `getDefaultDownloadsPath` | `src/main/events/index.ts:37` |
| `getDefaultWinePrefixSelectionPath` | `src/main/events/library/get-default-wine-prefix-selection-path.ts:16` |
| `getDiskFreeSpace` | `src/main/events/hardware/get-disk-free-space.ts:12` |
| `getDownloadLayoutState` | `src/main/events/torrenting/get-download-layout-state.ts:8` |
| `getDownloadPauseWarning` | `src/main/events/torrenting/pause-game-download.ts:17` |
| `getDownloadSources` | `src/main/events/download-sources/get-download-sources.ts:10` |
| `getDownloadSourcesCheckBaseline` | `src/main/events/download-sources/get-download-sources-check-baseline.ts:10` |
| `getDownloadSourcesSinceValue` | `src/main/events/download-sources/get-download-sources-since-value.ts:10` |
| `getEmulatorConfigs` | `src/main/events/emulators/get-emulator-configs.ts:6` |
| `getEmulatorInstallOptions` | `src/main/events/emulators/get-emulator-install-options.ts:10` |
| `getEmulatorRomExtensions` | `src/main/events/emulators/get-emulator-rom-extensions.ts:15` |
| `getEmulatorRomPaths` | `src/main/events/emulators/emulator-rom-paths.ts:42` |
| `getEpicCloudSaveState` | `src/main/events/epic/index.ts:122` |
| `getEpicConnection` | `src/main/events/epic/index.ts:28` |
| `getEpicGameInstallOptions` | `src/main/events/epic/index.ts:67` |
| `getEpicSyncState` | `src/main/events/epic/index.ts:49` |
| `getFriendsSnapshot` | `src/main/events/friends/prefetch-friends.ts:10`, `src/main/events/register-disabled-account-events.ts:9` |
| `getGameArtwork` | `src/main/events/catalogue/get-game-artwork.ts:25` |
| `getGameArtworkSelection` | `src/main/events/library/get-game-artwork-selection.ts:17` |
| `getGameAssets` | `src/main/events/catalogue/get-game-assets.ts:95` |
| `getGameBackupPreview` | `src/main/events/cloud-save/get-game-backup-preview.ts:20` |
| `getGameByObjectId` | `src/main/events/library/get-game-by-object-id.ts:56` |
| `getGameInstallerActionType` | `src/main/events/library/get-game-installer-action-type.ts:58` |
| `getGameLauncherStatuses` | `src/main/events/misc/get-game-launcher-statuses.ts:12` |
| `getGameLaunchProtonVersion` | `src/main/events/library/get-game-launch-proton-version.ts:37` |
| `getGameLinuxCompatibility` | `src/main/events/epic/index.ts:110` |
| `getGameSaveFolder` | `src/main/events/library/get-game-save-folder.ts:36` |
| `getGameShopDetails` | `src/main/events/catalogue/get-game-shop-details.ts:435` |
| `getGamesRunning` | `src/main/events/library/get-games-running.ts:8` |
| `getGameStats` | `src/main/events/catalogue/get-game-stats.ts:40` |
| `getHiddenLibrary` | `src/main/events/library/get-library.ts:200` |
| `getHydraDeckyPluginInfo` | `src/main/events/misc/get-hydra-decky-plugin-info.ts:94` |
| `getImageDataUrl` | `src/main/events/misc/get-image-data-url.ts:53` |
| `getInstalledProtonVersions` | `src/main/events/library/get-installed-proton-versions.ts:8` |
| `getLibrary` | `src/main/events/library/get-library.ts:197` |
| `getLocalNotifications` | `src/main/events/notifications/get-local-notifications.ts:8` |
| `getLocalNotificationsCount` | `src/main/events/notifications/get-local-notifications-count.ts:8` |
| `getMe` | `src/main/events/profile/get-me.ts:11` |
| `getMemcardRestoreTargets` | `src/main/events/emulators/restore-emulation-save.ts:408` |
| `getNetworkInterfaces` | `src/main/events/hardware/get-network-interfaces.ts:33` |
| `getPathInfo` | `src/main/events/misc/file-system.ts:229` |
| `getPendingCloudSaveCustomPathApproval` | `src/main/events/cloud-save/get-pending-cloud-save-custom-path-approval.ts:9` |
| `getProcessedImage` | `src/main/events/misc/get-processed-image.ts:182` |
| `getProfileImageMetadata` | `src/main/events/profile/get-profile-image-metadata.ts:207` |
| `getRandomGame` | `src/main/events/catalogue/get-random-game.ts:31` |
| `getRemoteLibrarySyncState` | `src/main/events/library/get-remote-library-sync-state.ts:7` |
| `getRetroAchievementsAchievements` | `src/main/events/user/get-retroachievements-achievements.ts:25` |
| `getRetroArchConfig` | `src/main/events/retroarch/get-retroarch-config.ts:33` |
| `getRetroArchInstallOptions` | `src/main/events/retroarch/get-retroarch-install-options.ts:8` |
| `getRetroArchLegacyBatteryCandidates` | `src/main/events/cloud-save/retroarch-local-battery.ts:88` |
| `getRetroArchLocalBatteryCandidates` | `src/main/events/cloud-save/retroarch-local-battery.ts:28` |
| `getRpcs3ConfigRootStatus` | `src/main/events/emulators/rpcs3-config-root.ts:41` |
| `getRpcs3DefaultSources` | `src/main/events/emulators/emulator-rom-paths.ts:44` |
| `getRpcs3DiscIdentityStatus` | `src/main/events/cloud-save/get-rpcs3-disc-identity-status.ts:8` |
| `getScreenshotsPath` | `src/main/events/index.ts:38` |
| `getSteamSyncState` | `src/main/events/user/get-steam-sync-state.ts:6` |
| `getThemeSoundDataUrl` | `src/main/events/themes/get-theme-sound-data-url.ts:40` |
| `getThemeSoundPath` | `src/main/events/themes/get-theme-sound-path.ts:13` |
| `getTorrentFiles` | `src/main/events/torrenting/get-torrent-files.ts:83` |
| `getUnlockedAchievements` | `src/main/events/user/get-unlocked-achievements.ts:236` |
| `getUserPreferences` | `src/main/events/user-preferences/get-user-preferences.ts:10` |
| `getVersion` | `src/main/events/index.ts:35` |
| `hydraApiCall` | `src/main/events/misc/hydra-api-call.ts:129` |
| `importLaunchboxRoms` | `src/main/events/emulators/import-launchbox-roms.ts:1084` |
| `importRetroArchRoms` | `src/main/events/retroarch/import-retroarch-roms.ts:757` |
| `importThemeSoundFromStore` | `src/main/events/themes/import-theme-sound-from-store.ts:60` |
| `inspectMemcard` | `src/main/events/emulators/inspect-memcard.ts:15` |
| `installAllRetroArchCores` | `src/main/events/retroarch/install-all-retroarch-cores.ts:7` |
| `installCommonRedist` | `src/main/events/misc/install-common-redist.ts:12` |
| `installEmulator` | `src/main/events/emulators/install-emulator.ts:11` |
| `installGameOnSteam` | `src/main/events/library/install-game-on-steam.ts:18` |
| `installHydraDeckyPlugin` | `src/main/events/misc/install-hydra-decky-plugin.ts:50` |
| `installRetroArch` | `src/main/events/retroarch/install-retroarch.ts:9` |
| `installRetroArchCore` | `src/main/events/retroarch/install-retroarch-core.ts:10` |
| `isGamemodeAvailable` | `src/main/events/library/is-gamemode-available.ts:4` |
| `isMainWindowMaximized` | `src/main/events/main-window-controls.ts:16` |
| `isMainWindowOpen` | `src/main/events/misc/is-main-window-open.ts:12` |
| `isMangohudAvailable` | `src/main/events/library/is-mangohud-available.ts:4` |
| `isStaging` | `src/main/events/index.ts:36` |
| `isSteamAppExecutable` | `src/main/events/library/is-steam-app-executable.ts:11` |
| `isWinetricksAvailable` | `src/main/events/library/is-winetricks-available.ts:4` |
| `leveldbClear` | `src/main/events/leveldb/leveldb-clear.ts:18` |
| `leveldbDel` | `src/main/events/leveldb/leveldb-del.ts:28` |
| `leveldbGet` | `src/main/events/leveldb/leveldb-get.ts:28` |
| `leveldbIterator` | `src/main/events/leveldb/leveldb-iterator.ts:18` |
| `leveldbPut` | `src/main/events/leveldb/leveldb-put.ts:27` |
| `leveldbValues` | `src/main/events/leveldb/leveldb-values.ts:18` |
| `listDrives` | `src/main/events/misc/file-system.ts:230` |
| `listEmulationSaves` | `src/main/events/emulators/emulation-saves.ts:41` |
| `listEmulatorRoms` | `src/main/events/emulators/list-emulator-roms.ts:65` |
| `listLocalEmulationSaves` | `src/main/events/emulators/list-local-emulation-saves.ts:99` |
| `listPs1MemcardSaves` | `src/main/events/emulators/ps1-memcard-saves.ts:39` |
| `listPs2MemcardSaves` | `src/main/events/emulators/ps2-memcard-saves.ts:39` |
| `listRetroArchRoms` | `src/main/events/retroarch/list-retroarch-roms.ts:68` |
| `markAllLocalNotificationsRead` | `src/main/events/notifications/mark-all-local-notifications-read.ts:8` |
| `markChatRead` | `src/main/events/chat/chat-state.ts:26`, `src/main/events/register-disabled-account-events.ts:9` |
| `markLocalNotificationRead` | `src/main/events/notifications/mark-local-notification-read.ts:11` |
| `markLocalNotificationUnread` | `src/main/events/notifications/mark-local-notification-unread.ts:11` |
| `minimizeChatWindow` | `src/main/events/chat/chat-window-controls.ts:4`, `src/main/events/register-disabled-account-events.ts:9` |
| `minimizeFriendsWindow` | `src/main/events/friends/friends-window-controls.ts:4`, `src/main/events/register-disabled-account-events.ts:9` |
| `minimizeMainWindow` | `src/main/events/main-window-controls.ts:4` |
| `minimizeRetroAchievementsConnectionWindow` | `src/main/events/user/retroachievements-connection-window.ts:9` |
| `moveDownloadPlacement` | `src/main/events/torrenting/move-download-placement.ts:22` |
| `notifyCloudGiftResolved` | `src/main/events/misc/notify-cloud-gift-resolved.ts:13` |
| `openAddFriendModalInMainWindow` | `src/main/events/friends/open-add-friend-modal.ts:4`, `src/main/events/register-disabled-account-events.ts:9` |
| `openBigPictureWindow` | `src/main/events/big-picture/open-big-picture-window.ts:4` |
| `openChatWindow` | `src/main/events/chat/open-chat-window.ts:5`, `src/main/events/register-disabled-account-events.ts:9` |
| `openCheckout` | `src/main/events/misc/open-checkout.ts:43` |
| `openClassicsGame` | `src/main/events/library/open-classics-game.ts:13` |
| `openEditorWindow` | `src/main/events/themes/open-editor-window.ts:11` |
| `openExternal` | `src/main/events/misc/open-external.ts:24` |
| `openFolder` | `src/main/events/misc/open-folder.ts:14` |
| `openFriendProfileInMainWindow` | `src/main/events/friends/open-friend-profile.ts:4`, `src/main/events/register-disabled-account-events.ts:9` |
| `openFriendsWindow` | `src/main/events/friends/open-friends-window.ts:4`, `src/main/events/register-disabled-account-events.ts:9` |
| `openGame` | `src/main/events/library/open-game.ts:32` |
| `openGameExecutablePath` | `src/main/events/library/open-game-executable-path.ts:18` |
| `openGameInMainWindow` | `src/main/events/chat/open-game-in-main-window.ts:4`, `src/main/events/register-disabled-account-events.ts:9` |
| `openGameInstaller` | `src/main/events/library/open-game-installer.ts:160` |
| `openGameInstallerPath` | `src/main/events/library/open-game-installer-path.ts:25` |
| `openGameSaveFolder` | `src/main/events/library/open-game-save-folder.ts:21` |
| `openGameWinetricks` | `src/main/events/library/open-game-winetricks.ts:66` |
| `openMainWindow` | `src/main/events/misc/open-main-window.ts:8` |
| `openRetroAchievementsConnectionWindow` | `src/main/events/user/retroachievements-connection-window.ts:5` |
| `pauseGameDownload` | `src/main/events/torrenting/pause-game-download.ts:16` |
| `pauseGameSeed` | `src/main/events/torrenting/pause-game-seed.ts:26` |
| `ping` | `src/main/events/index.ts:34` |
| `prefetchFriends` | `src/main/events/friends/prefetch-friends.ts:6`, `src/main/events/register-disabled-account-events.ts:9` |
| `previewEmulatorExecutable` | `src/main/events/emulators/preview-emulator-executable.ts:44` |
| `previewRetroArchExecutable` | `src/main/events/retroarch/preview-retroarch-executable.ts:35` |
| `previewRetroArchRomFolder` | `src/main/events/retroarch/preview-retroarch-rom-folder.ts:16` |
| `previewRomFolder` | `src/main/events/emulators/preview-rom-folder.ts:20` |
| `processProfileImage` | `src/main/events/profile/process-profile-image.ts:15` |
| `publishNewRepacksNotification` | `src/main/events/notifications/publish-new-repacks-notification.ts:33` |
| `readDirectory` | `src/main/events/misc/file-system.ts:228` |
| `reconcileSteamSyncRun` | `src/main/events/user/reconcile-steam-sync-run.ts:10` |
| `refreshLibraryAssets` | `src/main/events/library/refresh-library-assets.ts:10` |
| `registerRomFolder` | `src/main/events/emulators/register-rom-folder.ts:17` |
| `removeCloudSaveCustomPath` | `src/main/events/cloud-save/remove-cloud-save-custom-path.ts:10` |
| `removeDownloadSource` | `src/main/events/download-sources/remove-download-source.ts:27` |
| `removeEmulator` | `src/main/events/emulators/remove-emulator.ts:22` |
| `removeEmulatorDestination` | `src/main/events/cloud-save/remove-emulator-destination.ts:17` |
| `removeGame` | `src/main/events/library/remove-game.ts:14` |
| `removeGameFromFavorites` | `src/main/events/library/remove-game-from-favorites.ts:32` |
| `removeGameFromLibrary` | `src/main/events/library/remove-game-from-library.ts:119` |
| `removeRetroArch` | `src/main/events/retroarch/remove-retroarch.ts:18` |
| `removeRetroArchRomFolder` | `src/main/events/retroarch/remove-retroarch-rom-folder.ts:35` |
| `removeRomFolder` | `src/main/events/emulators/remove-rom-folder.ts:18` |
| `removeThemeAchievementSound` | `src/main/events/themes/remove-theme-achievement-sound.ts:48` |
| `rescanEmulator` | `src/main/events/emulators/rescan-emulator.ts:34` |
| `rescanRetroArch` | `src/main/events/retroarch/rescan-retroarch.ts:30` |
| `resetCommonRedistPreflight` | `src/main/events/misc/reset-common-redist-preflight.ts:8` |
| `resetGameAchievements` | `src/main/events/library/reset-game-achievements.ts:173` |
| `resetGamePlayTime` | `src/main/events/library/reset-game-playtime.ts:56` |
| `resetRetroAchievementsAchievements` | `src/main/events/user/reset-retroachievements-achievements.ts:44` |
| `resolveCloudSaveConflict` | `src/main/events/cloud-save/resolve-cloud-save-conflict.ts:11` |
| `resolveEpicCloudSaveConflict` | `src/main/events/epic/index.ts:140` |
| `restartAndInstallUpdate` | `src/main/events/autoupdater/restart-and-install-update.ts:18` |
| `restoreEmulationSave` | `src/main/events/emulators/restore-emulation-save.ts:409` |
| `resumeGameDownload` | `src/main/events/torrenting/resume-game-download.ts:18` |
| `resumeGameSeed` | `src/main/events/torrenting/resume-game-seed.ts:26` |
| `retryAchievementSouvenirSync` | `src/main/events/index.ts:47` |
| `saveGlobalTrackers` | `src/main/events/torrenting/save-global-trackers.ts:48` |
| `saveTempFile` | `src/main/events/misc/save-temp-file.ts:27` |
| `scanInstalledGames` | `src/main/events/library/scan-installed-games.ts:1203` |
| `scanPs1Memcards` | `src/main/events/emulators/scan-ps1-memcards.ts:294` |
| `scanPs2Memcards` | `src/main/events/emulators/scan-ps2-memcards.ts:294` |
| `selectCloudSaveCustomPath` | `src/main/events/cloud-save/select-cloud-save-custom-path.ts:21` |
| `selectCloudSaveCustomPathApproval` | `src/main/events/cloud-save/select-cloud-save-custom-path-approval.ts:13` |
| `selectEmulatorDestination` | `src/main/events/cloud-save/select-emulator-destination.ts:28` |
| `selectGameBackupPath` | `src/main/events/cloud-save/select-game-backup-path.ts:14` |
| `selectGameProtonPath` | `src/main/events/library/select-game-proton-path.ts:39` |
| `selectGameWinePrefix` | `src/main/events/library/select-game-wine-prefix.ts:50` |
| `selectRetroArchLegacyBattery` | `src/main/events/cloud-save/retroarch-local-battery.ts:94` |
| `selectRetroArchLocalBattery` | `src/main/events/cloud-save/retroarch-local-battery.ts:37` |
| `setChatWindowState` | `src/main/events/chat/chat-state.ts:13`, `src/main/events/register-disabled-account-events.ts:9` |
| `setCloudSaveAutomaticSyncEnabled` | `src/main/events/cloud-save/set-cloud-save-automatic-sync-enabled.ts:11` |
| `setDownloadQueuePosition` | `src/main/events/torrenting/set-download-queue-position.ts:14` |
| `setEmulatorBiosPath` | `src/main/events/emulators/set-emulator-bios-path.ts:28` |
| `setEmulatorExecutablePath` | `src/main/events/emulators/set-emulator-executable-path.ts:45` |
| `setEpicCloudSaveSettings` | `src/main/events/epic/index.ts:126` |
| `setGameArtworkSelection` | `src/main/events/library/set-game-artwork-selection.ts:155` |
| `setGameHydraPlaytimeEnabled` | `src/main/events/library/set-game-hydra-playtime-enabled.ts:24` |
| `setGameVisibility` | `src/main/events/library/set-game-visibility.ts:55` |
| `setPausedDownloadPosition` | `src/main/events/torrenting/set-paused-download-position.ts:14` |
| `setRetroArchCoresDir` | `src/main/events/retroarch/set-retroarch-cores-dir.ts:19` |
| `setRetroArchExecutablePath` | `src/main/events/retroarch/set-retroarch-executable-path.ts:51` |
| `setRpcs3ConfigRoot` | `src/main/events/emulators/rpcs3-config-root.ts:42` |
| `showAchievementTestNotification` | `src/main/events/notifications/show-achievement-test-notification.ts:45` |
| `showGameLauncherWindow` | `src/main/events/misc/show-game-launcher-window.ts:8` |
| `showItemInFolder` | `src/main/events/misc/show-item-in-folder.ts:11` |
| `showOpenDialog` | `src/main/events/misc/show-open-dialog.ts:22` |
| `startEpicAuth` | `src/main/events/epic/index.ts:32` |
| `startEpicGameDownload` | `src/main/events/epic/index.ts:118` |
| `startEpicSync` | `src/main/events/epic/index.ts:45` |
| `startGameDownload` | `src/main/events/torrenting/start-game-download.ts:113` |
| `startSteamOAuth` | `src/main/events/user/start-steam-oauth.ts:49` |
| `startSteamSync` | `src/main/events/user/start-steam-sync.ts:6` |
| `syncCloudSaveAfterCustomPathRebind` | `src/main/events/cloud-save/sync-cloud-save-after-custom-path-rebind.ts:10` |
| `syncCloudSaveOnGamePage` | `src/main/events/cloud-save/sync-cloud-save-on-game-page.ts:7` |
| `syncDownloadSources` | `src/main/events/download-sources/sync-download-sources.ts:29` |
| `syncEpicCloudSaves` | `src/main/events/epic/index.ts:136` |
| `syncEpicGameOnGamePage` | `src/main/events/epic/index.ts:57` |
| `syncFriendRequests` | `src/main/events/friends/sync-friend-requests.ts:9`, `src/main/events/register-disabled-account-events.ts:9` |
| `syncGameCloudSave` | `src/main/events/cloud-save/sync-game-cloud-save.ts:7` |
| `syncGameCloudSaveFromModal` | `src/main/events/cloud-save/sync-game-cloud-save-from-modal.ts:22` |
| `syncSteamGameOnGamePage` | `src/main/events/user/sync-steam-game-on-game-page.ts:30` |
| `toggleAutomaticCloudSync` | `src/main/events/library/toggle-automatic-cloud-sync.ts:18` |
| `toggleCustomTheme` | `src/main/events/themes/toggle-custom-theme.ts:25` |
| `toggleGameGamemode` | `src/main/events/library/toggle-game-gamemode.ts:22` |
| `toggleGameMangohud` | `src/main/events/library/toggle-game-mangohud.ts:22` |
| `toggleGamePin` | `src/main/events/library/toggle-game-pin.ts:42` |
| `toggleMaximizeMainWindow` | `src/main/events/main-window-controls.ts:8` |
| `toggleRetroArchSubfolders` | `src/main/events/retroarch/toggle-retroarch-subfolders.ts:17` |
| `toggleRomFolderSubfolders` | `src/main/events/emulators/toggle-rom-folder-subfolders.ts:38` |
| `transferGameFiles` | `src/main/events/library/transfer-game-files.ts:304` |
| `updateAchievementCustomNotificationWindow` | `src/main/events/notifications/update-achievement-notification-window.ts:10` |
| `updateClassicsDisc` | `src/main/events/library/update-classics-disc.ts:121` |
| `updateCustomGame` | `src/main/events/library/update-custom-game.ts:120` |
| `updateCustomTheme` | `src/main/events/themes/update-custom-theme.ts:31` |
| `updateDownloadQueuePosition` | `src/main/events/torrenting/update-download-queue-position.ts:52` |
| `updateEmulationSaveLabel` | `src/main/events/emulators/emulation-saves.ts:43` |
| `updateExecutablePath` | `src/main/events/library/update-executable-path.ts:75` |
| `updateGameCustomAssets` | `src/main/events/library/update-game-custom-assets.ts:268` |
| `updateLaunchOptions` | `src/main/events/library/update-launch-options.ts:23` |
| `updateNetworkStatus` | `src/main/events/connectivity/update-network-status.ts:12` |
| `updateProfile` | `src/main/events/profile/update-profile.ts:89` |
| `updateTrackingExecutablePaths` | `src/main/events/library/update-executable-path.ts:97` |
| `updateUserPreferences` | `src/main/events/user-preferences/update-user-preferences.ts:169` |
| `uploadChatAttachment` | `src/main/events/chat/upload-chat-attachment.ts:98`, `src/main/events/register-disabled-account-events.ts:9` |
| `uploadEmulationSave` | `src/main/events/emulators/upload-emulation-save.ts:360` |
| `uploadEmulationSavesForCard` | `src/main/events/emulators/upload-emulation-save.ts:362` |
| `uploadSaveGame` | `src/main/events/cloud-save/upload-save-game.ts:22` |
| `uploadWiiEmulationSave` | `src/main/events/emulators/upload-emulation-save.ts:361` |
| `verifyExecutablePathInUse` | `src/main/events/library/verify-executable-path.ts:17` |


## `ipcMain.on` channels

_None._


## Sidecar → renderer channels

| Channel | Registered at |
| --- | --- |
| `autoUpdaterEvent` | `src/main/services/update-manager.ts:28` |
| `common-redist-progress` | `src/main/services/common-redist-manager.ts:118`, `src/main/services/common-redist-manager.ts:145` |
| `game-launcher-status` | `src/main/services/game-launcher-status.ts:55` |
| `on-achievement-souvenir-screenshots-missing` | `src/main/services/achievements/grouped-souvenir-worker.ts:834` |
| `on-achievement-souvenir-sync-completed` | `src/main/services/achievements/grouped-souvenir-worker.ts:828` |
| `on-achievement-souvenir-sync-status` | `src/main/services/achievements/grouped-souvenir-worker.ts:200` |
| `on-achievement-unlocked` | `src/main/services/notifications/index.ts:435`, `src/main/services/notifications/index.ts:510` |
| `on-achievement-unlocked-in-app` | `src/main/services/window-manager.ts:971` |
| `on-archive-deletion-prompt` | `src/main/services/game-files-manager.ts:247`, `src/main/services/game-files-manager.ts:941` |
| `on-chat-attachment-upload-progress` | `src/main/events/chat/upload-chat-attachment.ts:63` |
| `on-chat-friends-pending` | `src/main/services/window-manager.ts:683`, `src/main/services/window-manager.ts:768` |
| `on-chat-message` | `src/main/services/sse/events/chat-message.ts:45` |
| `on-chat-message-rejected` | `src/main/services/sse/events/chat-message-rejected.ts:17` |
| `on-chat-message-sound` | `src/main/services/notifications/index.ts:283` |
| `on-chat-message-visibility` | `src/main/services/sse/events/chat-message-visibility.ts:20` |
| `on-chat-reaction` | `src/main/services/sse/events/chat-reaction.ts:19` |
| `on-chat-resync` | `src/main/services/sse/resync.ts:71` |
| `on-chat-typing` | `src/main/services/sse/events/chat-typing.ts:7` |
| `on-chat-unread-updated` | `src/main/services/chat/chat-unread-store.ts:198` |
| `on-classics-import-progress` | `src/main/events/emulators/import-launchbox-roms.ts:989`, `src/main/events/emulators/import-launchbox-roms.ts:989`, `src/main/events/emulators/import-launchbox-roms.ts:989` |
| `on-classics-import-status` | `src/main/events/emulators/import-launchbox-roms.ts:1017`, `src/main/events/emulators/import-launchbox-roms.ts:1066` |
| `on-cloud-gift-resolved` | `src/main/events/misc/notify-cloud-gift-resolved.ts:10` |
| `on-cloud-save-automatic-sync` | `src/main/services/cloud-save/automatic-sync.ts:108` |
| `on-cloud-save-automatic-sync-mode-changed` | `src/main/services/cloud-save/automatic-sync-settings.ts:36` |
| `on-cloud-save-sync-progress` | `src/main/events/cloud-save/resolve-cloud-save-conflict.ts:38`, `src/main/events/cloud-save/sync-cloud-save-after-custom-path-rebind.ts:41`, `src/main/events/cloud-save/sync-game-cloud-save-from-modal.ts:61`, `src/main/events/cloud-save/sync-game-cloud-save.ts:29` |
| `on-custom-theme-updated` | `src/main/events/themes/update-custom-theme.ts:26`, `src/main/services/achievement-notification-presenter.ts:125` |
| `on-download-halted` | `src/main/services/download/download-manager.ts:959` |
| `on-download-progress` | `src/main/services/download/download-manager.ts:937`, `src/main/services/download/download-manager.ts:982`, `src/main/services/download/download-manager.ts:1381`, `src/main/services/download/download-manager.ts:1618` +4 |
| `on-downloads-updated` | `src/main/services/window-manager.ts:243` |
| `on-emulation-backup-progress` | `src/main/events/emulators/upload-emulation-save.ts:27` |
| `on-emulator-install-progress` | `src/main/services/emulators/emulator-installer.ts:38` |
| `on-epic-cloud-save-state-changed` | `src/main/services/epic/index.ts:131` |
| `on-epic-connection-changed` | `src/main/services/epic/index.ts:393` |
| `on-epic-sync-finished` | `src/main/services/epic/sync-runtime.ts:301` |
| `on-epic-sync-progress` | `src/main/services/epic/sync-runtime.ts:299` |
| `on-extraction-complete` | `src/main/services/game-files-manager.ts:356` |
| `on-extraction-failed` | `src/main/services/game-files-manager.ts:115` |
| `on-extraction-progress` | `src/main/services/game-files-manager.ts:74` |
| `on-friend-presence` | `src/main/services/sse/events/friend-presence.ts:10` |
| `on-friends-updated` | `src/main/services/sse/friends-updated-broadcast.ts:5` |
| `on-game-artifact-export-progress` | `src/main/events/cloud-save/export-game-artifact.ts:46` |
| `on-game-executable-not-found` | `src/main/helpers/launch-game.ts:1053` |
| `on-game-transfer-cancelled` | `src/main/events/library/transfer-game-files.ts:376` |
| `on-game-transfer-complete` | `src/main/events/library/transfer-game-files.ts:408` |
| `on-game-transfer-error` | `src/main/events/library/transfer-game-files.ts:380`, `src/main/events/library/transfer-game-files.ts:398` |
| `on-game-transfer-progress` | `src/main/events/library/transfer-game-files.ts:64`, `src/main/events/library/transfer-game-files.ts:344` |
| `on-games-running` | `src/main/services/process-watcher.ts:449` |
| `on-hard-delete` | `src/main/services/download/download-manager.ts:1468` |
| `on-library-batch-complete` | `src/main/events/library/add-scanned-game.ts:28`, `src/main/events/library/scan-installed-games.ts:1185`, `src/main/events/library/set-game-artwork-selection.ts:149`, `src/main/events/library/update-custom-game.ts:115` +20 |
| `on-local-notification-created` | `src/main/services/notifications/local-notifications.ts:36` |
| `on-navigate` | `src/main/services/window-manager.ts:888`, `src/main/services/window-manager.ts:1164` |
| `on-new-download-options` | `src/main/services/download-sources-checker.ts:90` |
| `on-open-add-friend-modal` | `src/main/services/window-manager.ts:893` |
| `on-profile-updated` | `src/main/events/profile/update-profile.ts:84` |
| `on-remote-library-sync-state` | `src/main/services/library-sync/remote-library-sync-state.ts:13`, `src/main/services/library-sync/remote-library-sync-state.ts:22` |
| `on-retroachievements-connected` | `src/main/services/window-manager.ts:959` |
| `on-retroarch-core-install-progress` | `src/main/services/retroarch/retroarch-core-installer.ts:82` |
| `on-retroarch-import-progress` | `src/main/events/retroarch/import-retroarch-roms.ts:651`, `src/main/events/retroarch/import-retroarch-roms.ts:651`, `src/main/events/retroarch/import-retroarch-roms.ts:651` |
| `on-retroarch-import-status` | `src/main/events/retroarch/import-retroarch-roms.ts:684`, `src/main/events/retroarch/import-retroarch-roms.ts:732` |
| `on-retroarch-install-progress` | `src/main/services/retroarch/retroarch-core-installer.ts:89` |
| `on-seeding-status` | `src/main/services/download/download-manager.ts:1433`, `src/main/services/download/download-manager.ts:1438`, `src/main/services/download/download-manager.ts:1472` |
| `on-steam-connect-error` | `src/main/services/steam-integration/steam-store-session.ts:122` |
| `on-steam-connected` | `src/main/services/steam-integration/steam-store-session.ts:117` |
| `on-steam-sync-finished` | `src/main/services/steam-integration/steam-sync-orchestrator.ts:437` |
| `on-steam-sync-progress` | `src/main/services/steam-integration/steam-sync-orchestrator.ts:430` |
| `on-sync-friend-requests` | `src/main/events/friends/sync-friend-requests.ts:10`, `src/main/services/sse/resync.ts:47` |
| `on-sync-notification-count` | `src/main/services/sse/resync.ts:61` |
| `on-user-preferences-updated` | `src/main/events/user-preferences/update-user-preferences.ts:161` |
| `on-window-maximize-change` | `src/main/services/window-manager.ts:342` |
| `preflight-progress` | `src/main/services/common-redist-manager.ts:363` |
| `prepare-achievement-notification` | `src/main/services/achievement-notification-presenter.ts:306` |
| `start-achievement-notification` | `src/main/services/achievement-notification-presenter.ts:185` |


## Dynamic event channels

| Template | Producers |
| --- | --- |
| `on-backup-download-complete-${objectId}-${shop}` | `src/main/events/cloud-save/download-game-artifact.ts:154`, `src/main/events/cloud-save/download-game-artifact.ts:161` |
| `on-backup-download-progress-${objectId}-${shop}` | `src/main/events/cloud-save/download-game-artifact.ts:130` |
| `on-ps1-memcard-scan-progress-${requestId}` | `src/main/events/emulators/scan-ps1-memcards.ts:264` |
| `on-ps2-memcard-scan-progress-${requestId}` | `src/main/events/emulators/scan-ps2-memcards.ts:264` |
| `on-update-achievements-${game.objectId}-${game.shop}` | `src/main/events/library/reset-game-achievements.ts:150`, `src/main/events/user/reset-retroachievements-achievements.ts:37`, `src/main/services/achievements/merge-achievements.ts:164`, `src/main/services/achievements/reconcile-achievement-memory.ts:33`, `src/main/services/emulators/emulator-session-tracker.ts:264` |
| `on-upload-complete-${objectId}-${shop}` | `src/main/services/cloud-sync.ts:151` |

Match rule: the literal prefix followed by 1-200 characters of
`[A-Za-z0-9_.:@-]`. Path separators, whitespace and quotes are rejected,
so a dynamic channel cannot be turned into a different one.


## Forwarder call sites

- `src/main/events/library/transfer-game-files.ts:19 (send)`
- `src/main/services/achievement-notification-presenter-electron.ts:43 (send)`
- `src/main/services/epic/sync-runtime.ts:327 (send)`
- `src/main/services/window-manager.ts:228 (sendToAppWindows)`
- `src/main/services/window-manager.ts:238 (sendToAppWindows)`
- `src/main/services/window-manager.ts:811 (sendToFirstLoadedWindow)`
- `src/main/services/window-manager.ts:819 (sendToFirstLoadedWindow)`
- `src/main/services/window-manager.ts:823 (sendToChatWindow)`
- `src/main/services/window-manager.ts:825 (sendToChatWindow)`

