import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";

import { dialog, shell } from "electron";
import type {
  GoogleDriveDisconnectResult,
  GoogleDriveSettings,
  GoogleDriveState,
  GoogleDriveUsage,
  LocalGameSnapshotSourceFile,
} from "@types";

import { logger } from "../logger.js";
import { SystemPath } from "../system-path.js";
import { readGoogleDriveConfig, type GoogleDriveConfig } from "./config.js";
import {
  GoogleOAuthError,
  refreshGoogleDriveAccessToken,
  requestGoogleDriveAuthorization,
  revokeGoogleDriveToken,
  type GoogleDriveTokens,
} from "./oauth.js";
import { GoogleDriveClient, GoogleDriveError } from "./drive-client.js";
import {
  GoogleDriveCloudSaveProvider,
  type GoogleDriveConflictChoice,
} from "./google-drive-provider.js";
import {
  createShellKeychainStore,
  RefreshTokenStore,
  type RefreshTokenStorage,
} from "./token-store.js";
import {
  readGoogleDriveSettings,
  writeGoogleDriveSettings,
} from "./drive-settings.js";

const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const DEVICE_ID_FILE = "google-drive-device-id";
const BACKUP_DIRECTORY = "cloud-save-conflict-backups";

const tokenStore = new RefreshTokenStore(createShellKeychainStore());

class GoogleDriveTokenManager {
  private tokens: GoogleDriveTokens | null = null;

  setTokens(tokens: GoogleDriveTokens): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }

  private requireConfig(): GoogleDriveConfig {
    const config = readGoogleDriveConfig();
    if (!config.configured) {
      throw new GoogleDriveError(
        "google_drive_not_configured",
        "Google Drive is not configured in this build"
      );
    }
    return config;
  }

  async getAccessToken(): Promise<string> {
    if (this.tokens && this.tokens.expiresAt - 60_000 > Date.now()) {
      return this.tokens.accessToken;
    }

    if (this.tokens) return this.refresh(this.tokens.refreshToken);

    const stored = await tokenStore.load();
    if (!stored) {
      throw new GoogleDriveError(
        "google_drive_not_connected",
        "Connect Google Drive in Settings to sync cloud saves"
      );
    }
    return this.refresh(stored);
  }

  async refreshAccessToken(): Promise<string> {
    const refreshToken =
      this.tokens?.refreshToken ?? (await tokenStore.load()) ?? "";
    if (!refreshToken) {
      throw new GoogleDriveError(
        "google_drive_not_connected",
        "Connect Google Drive in Settings to sync cloud saves"
      );
    }
    return this.refresh(refreshToken);
  }

  private async refresh(refreshToken: string): Promise<string> {
    const config = this.requireConfig();
    try {
      const tokens = await refreshGoogleDriveAccessToken(config, refreshToken, {
        fetch,
      });
      this.tokens = tokens;
      return tokens.accessToken;
    } catch (error) {
      if (
        error instanceof GoogleOAuthError &&
        error.code === "google_drive_reconnect_required"
      ) {
        // The refresh token is dead; forget it so the UI stops claiming a
        // working connection and offers to connect again.
        await tokenStore.clear();
        this.tokens = null;
      }
      throw error;
    }
  }
}

const tokenManager = new GoogleDriveTokenManager();

let driveClient: GoogleDriveClient | null = null;
let provider: GoogleDriveCloudSaveProvider | null = null;
let usageCache: { measuredAt: number; value: GoogleDriveUsage } | null = null;

const getClient = (): GoogleDriveClient => {
  driveClient ??= new GoogleDriveClient({
    getAccessToken: () => tokenManager.getAccessToken(),
    refreshAccessToken: () => tokenManager.refreshAccessToken(),
    fetch,
  });
  return driveClient;
};

const deviceIdPath = () =>
  path.join(SystemPath.getPath("userData"), DEVICE_ID_FILE);

const getDeviceId = async (): Promise<string> => {
  const target = deviceIdPath();
  try {
    const value = (await fs.readFile(target, "utf8")).trim();
    if (value) return value;
  } catch {
    // First run, or the file was removed.
  }

  const id = randomUUID();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${id}\n`, { encoding: "utf8", mode: 0o600 });
  return id;
};

const formatMegabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

const confirmLargeUpload = async (bytes: number): Promise<boolean> => {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Upload", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Sphinx Cloud Save",
    message: `Upload ${formatMegabytes(bytes)} MB of new save data to Google Drive?`,
    detail:
      "Only data that is not already on Google Drive is sent. You can raise or lower this threshold in Settings.",
  });
  return response === 0;
};

const chooseConflict = async (): Promise<GoogleDriveConflictChoice> => {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Keep cloud", "Keep local", "Keep both"],
    defaultId: 0,
    cancelId: 0,
    title: "Sphinx Cloud Save",
    message:
      "Two devices saved this game at the same time. Which cloud save should Sphinx keep?",
    detail:
      "Keep local and Keep both also keep a local backup of this device's save files.",
  });
  return response === 1 ? "local" : response === 2 ? "both" : "cloud";
};

const backupLocalFiles = async ({
  gameKey,
  sourceFiles,
}: {
  gameKey: string;
  sourceFiles: LocalGameSnapshotSourceFile[];
}): Promise<string> => {
  const root = path.join(
    SystemPath.getPath("userData"),
    BACKUP_DIRECTORY,
    gameKey,
    new Date().toISOString().replace(/[:.]/g, "-")
  );
  await fs.mkdir(root, { recursive: true });

  for (const source of sourceFiles) {
    const target = path.resolve(root, source.variantId, source.relativePath);
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source.absolutePath, target);
    } catch (error) {
      logger.warn("[Google Drive] Could not back up a conflicting save file", {
        path: source.absolutePath,
        error,
      });
    }
  }
  return root;
};

export const getGoogleDriveCloudSaveProvider =
  (): GoogleDriveCloudSaveProvider => {
    provider ??= new GoogleDriveCloudSaveProvider({
      client: getClient(),
      getDeviceId,
      getSettings: () => readGoogleDriveSettings(),
      confirmUpload: confirmLargeUpload,
      chooseConflict,
      backupLocalFiles,
    });
    return provider;
  };

export const resetGoogleDriveCaches = (): void => {
  provider?.clearCache();
  usageCache = null;
};

export const isGoogleDriveConfigured = (): boolean =>
  readGoogleDriveConfig().configured;

export const isGoogleDriveConnected = async (): Promise<boolean> => {
  if (!isGoogleDriveConfigured()) return false;
  try {
    return Boolean(await tokenStore.load());
  } catch {
    return false;
  }
};

export const getGoogleDriveTokenStorage = (): RefreshTokenStorage =>
  tokenStore.getStorage();

/** Cheap check used by the cloud save pipeline before it reads any file. */
export const assertGoogleDriveReady = async (): Promise<void> => {
  if (!isGoogleDriveConfigured()) {
    throw new GoogleDriveError(
      "google_drive_not_configured",
      "Google Drive is not configured in this build"
    );
  }
  if (!(await isGoogleDriveConnected())) {
    throw new GoogleDriveError(
      "google_drive_not_connected",
      "Connect Google Drive in Settings to sync cloud saves"
    );
  }
};

export const getGoogleDriveUsage = async (): Promise<GoogleDriveUsage> => {
  if (usageCache && Date.now() - usageCache.measuredAt < USAGE_CACHE_TTL_MS) {
    return usageCache.value;
  }

  const [quota, saves] = await Promise.all([
    getClient().about(),
    getGoogleDriveCloudSaveProvider().getCloudSaveUsage(),
  ]);
  const limit = quota.limit ? Number.parseInt(quota.limit, 10) : null;
  const usage = quota.usage ? Number.parseInt(quota.usage, 10) : 0;

  const value: GoogleDriveUsage = {
    usageBytes: Number.isFinite(usage) ? usage : 0,
    limitBytes: limit !== null && Number.isFinite(limit) ? limit : null,
    cloudSaveBytes: saves.bytes,
    cloudSaveFileCount: saves.fileCount,
    measuredAt: new Date().toISOString(),
  };
  usageCache = { measuredAt: Date.now(), value };
  return value;
};

const readSettings = (): Promise<GoogleDriveSettings> =>
  readGoogleDriveSettings();

export const getGoogleDriveState = async (
  options: { includeUsage?: boolean } = {}
): Promise<GoogleDriveState> => {
  const configured = isGoogleDriveConfigured();
  let connected = false;
  let error: string | null = null;

  if (configured) {
    try {
      connected = await isGoogleDriveConnected();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  let usage: GoogleDriveUsage | null = null;
  if (connected && options.includeUsage !== false) {
    try {
      usage = await getGoogleDriveUsage();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  return {
    configured,
    connected,
    tokenStorage: tokenStore.getStorage(),
    settings: await readSettings(),
    usage,
    error,
  };
};

export const updateGoogleDriveSettings = async (
  value: unknown
): Promise<GoogleDriveSettings> => {
  const settings = await writeGoogleDriveSettings(value);
  resetGoogleDriveCaches();
  return settings;
};

export const connectGoogleDrive = async (): Promise<GoogleDriveState> => {
  const config = readGoogleDriveConfig();
  if (!config.configured) {
    throw new GoogleDriveError(
      "google_drive_not_configured",
      "Google Drive is not configured in this build"
    );
  }

  const tokens = await requestGoogleDriveAuthorization(config, {
    fetch,
    openExternal: (url) => shell.openExternal(url),
  });
  const storage = await tokenStore.save(tokens.refreshToken);
  tokenManager.setTokens(tokens);
  resetGoogleDriveCaches();

  if (storage === "memory") {
    logger.warn(
      "[Google Drive] The OS keychain is unavailable; the connection lasts until Sphinx closes"
    );
  }

  return getGoogleDriveState();
};

export const disconnectGoogleDrive = async (
  deleteCloudData = false
): Promise<GoogleDriveDisconnectResult> => {
  const refreshToken = await tokenStore.load();
  let cloudDataDeleted = false;

  try {
    if (deleteCloudData && refreshToken) {
      // The data lives under the token being revoked, so it is deleted first.
      await getGoogleDriveCloudSaveProvider().deleteAllCloudSaveData();
      cloudDataDeleted = true;
    }
  } catch (error) {
    logger.warn("[Google Drive] Could not delete cloud save data", error);
  } finally {
    if (refreshToken) {
      await revokeGoogleDriveToken(refreshToken, { fetch }).catch((error) => {
        logger.warn("[Google Drive] Token revocation failed", error);
      });
    }
    await tokenStore.clear();
    tokenManager.clear();
    resetGoogleDriveCaches();
  }

  return { disconnected: true, cloudDataDeleted };
};
