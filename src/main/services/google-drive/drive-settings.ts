import path from "node:path";
import { promises as fs } from "node:fs";

import type { GoogleDriveSettings } from "@types";

export const DEFAULT_GOOGLE_DRIVE_SETTINGS: GoogleDriveSettings = {
  retentionVersions: 3,
  confirmUploadBytes: 100 * 1024 * 1024,
};

export const MIN_RETENTION_VERSIONS = 1;
export const MAX_RETENTION_VERSIONS = 10;

const SETTINGS_FILE = "google-drive-settings.json";

const clampInteger = (
  value: unknown,
  min: number,
  max: number,
  fallback: number
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

/**
 * Coerces whatever is on disk into a usable setting. A corrupted file must not
 * break cloud saves, so each field falls back independently.
 */
export const normalizeGoogleDriveSettings = (
  value: unknown
): GoogleDriveSettings => {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    retentionVersions: clampInteger(
      record.retentionVersions,
      MIN_RETENTION_VERSIONS,
      MAX_RETENTION_VERSIONS,
      DEFAULT_GOOGLE_DRIVE_SETTINGS.retentionVersions
    ),
    confirmUploadBytes: clampInteger(
      record.confirmUploadBytes,
      1,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_GOOGLE_DRIVE_SETTINGS.confirmUploadBytes
    ),
  };
};

const resolveDefaultSettingsPath = async (): Promise<string> => {
  const { SystemPath } = await import("../system-path.js");
  return path.join(SystemPath.getPath("userData"), SETTINGS_FILE);
};

export const readGoogleDriveSettings = async (
  filePath?: string
): Promise<GoogleDriveSettings> => {
  const target = filePath ?? (await resolveDefaultSettingsPath());
  try {
    const raw = await fs.readFile(target, "utf8");
    return normalizeGoogleDriveSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GOOGLE_DRIVE_SETTINGS };
  }
};

export const writeGoogleDriveSettings = async (
  value: unknown,
  filePath?: string
): Promise<GoogleDriveSettings> => {
  const settings = normalizeGoogleDriveSettings(value);
  const target = filePath ?? (await resolveDefaultSettingsPath());
  const temporaryPath = `${target}.${process.pid}.tmp`;

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporaryPath, target);
  return settings;
};
