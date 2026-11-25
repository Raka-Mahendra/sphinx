import type { GameShop, SnapshotFile, SnapshotVariant } from "@types";

import {
  CLOUD_SAVE_HASH_PATTERN,
  isNonEmptyString,
  validateCustomPathRawPaths,
  validateSnapshotFiles,
  validateSnapshotVariants,
} from "../cloud-save/cloud-save-contract.js";

/**
 * The immutable manifest stored as `<gameKey>/snapshots/<version>.json`.
 *
 * It carries everything restore needs, so a snapshot never depends on a
 * mutable index: the newest manifest is the head, and an older manifest stays
 * a valid restore target until retention removes it.
 */
export interface GoogleDriveManifest {
  schema: 1;
  app: "sphinx";
  gameKey: string;
  shop: GameShop;
  objectId: string;
  version: number;
  parentVersion: number;
  deviceId: string;
  createdAt: string;
  aggregateHash: string;
  fileCount: number;
  totalSizeBytes: number;
  customPathRawPaths: string[];
  variants: SnapshotVariant[];
  files: SnapshotFile[];
}

export const DRIVE_MANIFEST_SCHEMA = 1;
export const DRIVE_APP_TAG = "sphinx";

const MANIFEST_KEYS = [
  "schema",
  "app",
  "gameKey",
  "shop",
  "objectId",
  "version",
  "parentVersion",
  "deviceId",
  "createdAt",
  "aggregateHash",
  "fileCount",
  "totalSizeBytes",
  "customPathRawPaths",
  "variants",
  "files",
] as const;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const serializeDriveManifest = (manifest: GoogleDriveManifest): Buffer =>
  Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");

export const parseDriveManifest = (value: unknown): GoogleDriveManifest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Google Drive cloud save manifest");
  }
  const manifest = value as Record<string, unknown>;
  if (
    Object.keys(manifest).some(
      (key) => !(MANIFEST_KEYS as readonly string[]).includes(key)
    ) ||
    !MANIFEST_KEYS.every((key) => key in manifest) ||
    manifest.schema !== DRIVE_MANIFEST_SCHEMA ||
    manifest.app !== DRIVE_APP_TAG ||
    !isNonEmptyString(manifest.gameKey) ||
    manifest.gameKey.length > 255 ||
    (manifest.shop !== "steam" &&
      manifest.shop !== "epic" &&
      manifest.shop !== "launchbox") ||
    !isNonEmptyString(manifest.objectId) ||
    !isPositiveInteger(manifest.version) ||
    !isNonNegativeInteger(manifest.parentVersion) ||
    manifest.parentVersion >= manifest.version ||
    !isNonEmptyString(manifest.deviceId) ||
    !isNonEmptyString(manifest.createdAt) ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !isNonEmptyString(manifest.aggregateHash) ||
    !CLOUD_SAVE_HASH_PATTERN.test(manifest.aggregateHash)
  ) {
    throw new Error("Invalid Google Drive cloud save manifest");
  }

  const shop = manifest.shop as GameShop;
  const variants = validateSnapshotVariants(manifest.variants, shop);
  const files = validateSnapshotFiles(manifest.files, variants);
  const customPathRawPaths = validateCustomPathRawPaths(
    manifest.customPathRawPaths
  );
  const activeCustomPaths = new Set(customPathRawPaths);
  if (
    files.some(
      (file) =>
        file.rawPath.startsWith("<custom>") &&
        !activeCustomPaths.has(file.rawPath)
    )
  ) {
    throw new Error("Google Drive manifest file references an inactive path");
  }
  if (
    manifest.fileCount !== files.length ||
    manifest.totalSizeBytes !==
      files.reduce((total, file) => total + file.sizeBytes, 0)
  ) {
    throw new Error("Google Drive manifest totals do not match its files");
  }

  return {
    schema: DRIVE_MANIFEST_SCHEMA,
    app: DRIVE_APP_TAG,
    gameKey: manifest.gameKey,
    shop,
    objectId: manifest.objectId,
    version: manifest.version,
    parentVersion: manifest.parentVersion,
    deviceId: manifest.deviceId,
    createdAt: manifest.createdAt,
    aggregateHash: manifest.aggregateHash,
    fileCount: manifest.fileCount,
    totalSizeBytes: manifest.totalSizeBytes,
    customPathRawPaths,
    variants,
    files,
  };
};
