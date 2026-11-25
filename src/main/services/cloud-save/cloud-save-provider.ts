import type {
  CloudSaveGameId,
  CloudSavePathContext,
  CloudSaveUploadProgress,
  LocalGameSnapshotSourceFile,
  RemoteGameSnapshot,
  RemoteSnapshotSummary,
  RestoreDownloadUrlFile,
  RestoreManifestResponse,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import { getGoogleDriveCloudSaveProvider } from "../google-drive/connection.js";

/**
 * Remote layer boundary for the v2 snapshot pipeline.
 *
 * Everything local — hashing, variants, `baseVersion`, manifests, restore
 * planning, temp verification — stays in the pipeline. A provider only decides
 * where the immutable manifest and content-addressed blobs live.
 */
export interface CloudSaveProviderUploadInput {
  shop: CloudSaveGameId["shop"];
  objectId: string;
  platform: CloudSavePathContext["platform"];
  hostname?: string;
  baseVersion: number;
  aggregateHash: string;
  variants: SnapshotVariant[];
  files: SnapshotFile[];
  customPathRawPaths: string[];
  sourceFiles: LocalGameSnapshotSourceFile[];
  retroArchFormatVersion?: 2;
}

export type CloudSaveProviderUploadResult =
  | { kind: "committed"; snapshot: RemoteGameSnapshot }
  /**
   * The provider dropped this upload because the remote copy won a conflict
   * the user resolved. Callers must not update their sync anchor.
   */
  | { kind: "remote-won"; snapshot: RemoteGameSnapshot };

export interface CloudSaveSnapshotRef {
  id: string;
  version: number;
}

export interface CloudSaveProvider {
  readonly id: "google-drive";
  listSnapshots(game: CloudSaveGameId): Promise<RemoteSnapshotSummary[]>;
  uploadSnapshot(
    input: CloudSaveProviderUploadInput,
    onProgress?: (progress: CloudSaveUploadProgress) => void
  ): Promise<CloudSaveProviderUploadResult>;
  getRestoreManifest(
    snapshot: CloudSaveSnapshotRef
  ): Promise<RestoreManifestResponse>;
  getDownloadUrls(
    snapshot: CloudSaveSnapshotRef
  ): Promise<RestoreDownloadUrlFile[]>;
  downloadBlobToTemp(input: {
    tempSnapshotId: string;
    hash: string;
    sizeBytes: number;
    downloadUrl: string;
    tempRoot: string;
  }): Promise<string>;
  deleteSnapshots(game: CloudSaveGameId): Promise<void>;
}

export const getCloudSaveProvider = (): CloudSaveProvider => ({
  id: "google-drive",
  listSnapshots: (game) =>
    getGoogleDriveCloudSaveProvider().listSnapshots(game),
  uploadSnapshot: (input, onProgress) =>
    getGoogleDriveCloudSaveProvider().uploadSnapshot(input, onProgress),
  getRestoreManifest: (snapshot) =>
    getGoogleDriveCloudSaveProvider().getRestoreManifest(snapshot),
  getDownloadUrls: (snapshot) =>
    getGoogleDriveCloudSaveProvider().getDownloadUrls(snapshot),
  downloadBlobToTemp: (input) =>
    getGoogleDriveCloudSaveProvider().downloadBlobToTemp(input),
  deleteSnapshots: (game) =>
    getGoogleDriveCloudSaveProvider().deleteSnapshots(game),
});
