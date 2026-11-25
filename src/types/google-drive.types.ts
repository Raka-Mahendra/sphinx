export interface GoogleDriveSettings {
  /** How many snapshot manifests are kept per game (PRD §4.F: 1-10, default 3). */
  retentionVersions: number;
  /** New bytes (after dedupe) that require an explicit confirmation. */
  confirmUploadBytes: number;
}

export type GoogleDriveTokenStorage = "keychain" | "memory" | "none";

export interface GoogleDriveUsage {
  /** Total bytes used by the whole Google account, from `about.get`. */
  usageBytes: number;
  /** Account storage limit in bytes; null when the account has no fixed limit. */
  limitBytes: number | null;
  /** Bytes used by Sphinx cloud saves inside `appDataFolder`. */
  cloudSaveBytes: number;
  cloudSaveFileCount: number;
  measuredAt: string;
}

export interface GoogleDriveState {
  configured: boolean;
  connected: boolean;
  tokenStorage: GoogleDriveTokenStorage;
  settings: GoogleDriveSettings;
  usage: GoogleDriveUsage | null;
  /** Non-fatal problem worth showing next to the connection status. */
  error: string | null;
}

export interface GoogleDriveDisconnectResult {
  disconnected: true;
  cloudDataDeleted: boolean;
}
