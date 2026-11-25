import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type {
  CloudSaveGameId,
  CloudSaveUploadProgress,
  GoogleDriveSettings,
  LocalGameSnapshotSourceFile,
  RemoteGameSnapshot,
  RemoteSnapshotSummary,
  RestoreManifestResponse,
  RestoreDownloadUrlFile,
  SnapshotFile,
} from "@types";

import {
  DRIVE_BLOB_FILE,
  DRIVE_MANIFEST_FILE,
  DRIVE_SNAPSHOTS_FOLDER,
  toDriveGameKey,
} from "./drive-paths.js";
import {
  DRIVE_APP_TAG,
  DRIVE_MANIFEST_SCHEMA,
  parseDriveManifest,
  serializeDriveManifest,
  type GoogleDriveManifest,
} from "./drive-manifest.js";
import {
  GoogleDriveError,
  type DriveClientLike,
  type DriveFile,
} from "./drive-client.js";
import { GOOGLE_DRIVE_API_BASE } from "./config.js";
import type {
  CloudSaveProviderUploadInput,
  CloudSaveProviderUploadResult,
} from "../cloud-save/cloud-save-provider.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const MANIFEST_MIME = "application/json";
const BLOB_MIME = "application/octet-stream";
const MAX_CONCURRENT_UPLOADS = 3;
const LIST_CACHE_TTL_MS = 5 * 60 * 1000;
/** Blobs are deleted only after this much time unreferenced (PRD §4.F). */
export const DRIVE_GC_GRACE_MS = 24 * 60 * 60 * 1000;

export type GoogleDriveConflictChoice = "cloud" | "local" | "both";

export interface GoogleDriveConflictBackupInput {
  gameKey: string;
  sourceFiles: LocalGameSnapshotSourceFile[];
}

export interface GoogleDriveProviderOptions {
  client: DriveClientLike;
  getDeviceId: () => Promise<string>;
  getSettings: () => Promise<GoogleDriveSettings>;
  /** Asked only when the new bytes exceed the configured threshold. */
  confirmUpload?: (bytes: number) => Promise<boolean>;
  /** Asked when a second manifest appeared at the same version. */
  chooseConflict?: (input: {
    gameKey: string;
    version: number;
    backupPath: string;
  }) => Promise<GoogleDriveConflictChoice>;
  /** Local backup performed before the conflict dialog (PRD §4.F). */
  backupLocalFiles?: (input: GoogleDriveConflictBackupInput) => Promise<string>;
  now?: () => number;
  listCacheTtlMs?: number;
}

export interface DriveManifestRecord {
  file: DriveFile;
  manifest: GoogleDriveManifest;
}

export interface DriveFolders {
  gameFolderId: string;
  snapshotsFolderId: string;
}

const summaryOf = (record: DriveManifestRecord): RemoteSnapshotSummary => ({
  id: record.file.id,
  version: record.manifest.version,
  createdAt: record.manifest.createdAt,
  updatedAt: record.file.modifiedTime ?? record.manifest.createdAt,
  fileCount: record.manifest.fileCount,
  totalSizeBytes: record.manifest.totalSizeBytes,
  aggregateHash: record.manifest.aggregateHash,
});

const hashOf = (file: Pick<SnapshotFile, "hash">) => file.hash;

const samePaths = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export class GoogleDriveCloudSaveProvider {
  private readonly now: () => number;
  private readonly listCacheTtlMs: number;
  private readonly manifestCache = new Map<
    string,
    { measuredAt: number; records: DriveManifestRecord[] }
  >();

  constructor(private readonly options: GoogleDriveProviderOptions) {
    this.now = options.now ?? Date.now;
    this.listCacheTtlMs = options.listCacheTtlMs ?? LIST_CACHE_TTL_MS;
  }

  clearCache(): void {
    this.manifestCache.clear();
  }

  private async findFolder(
    name: string,
    parentId: string,
    extraQuery = ""
  ): Promise<DriveFile | null> {
    const escaped = name.replace(/'/g, "\\'");
    const files = await this.options.client.listAllFiles(
      `name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false ` +
        `and '${parentId}' in parents${extraQuery}`,
      "id,name,mimeType"
    );
    return files[0] ?? null;
  }

  async findFolders(gameKey: string): Promise<DriveFolders | null> {
    const gameFolder = await this.findFolder(
      gameKey,
      "appDataFolder",
      " and appProperties has { key='kind' and value='folder' }"
    );
    if (!gameFolder) return null;
    const snapshotsFolder = await this.findFolder(
      DRIVE_SNAPSHOTS_FOLDER,
      gameFolder.id,
      " and appProperties has { key='kind' and value='folder' }"
    );
    if (!snapshotsFolder) return null;
    return {
      gameFolderId: gameFolder.id,
      snapshotsFolderId: snapshotsFolder.id,
    };
  }

  private async ensureFolders(gameKey: string): Promise<DriveFolders> {
    const existing = await this.findFolders(gameKey);
    if (existing) return existing;

    const gameFolder =
      (await this.findFolder(
        gameKey,
        "appDataFolder",
        " and appProperties has { key='kind' and value='folder' }"
      )) ?? (await this.options.client.createFolder(gameKey, "appDataFolder"));

    const snapshotsFolder =
      (await this.findFolder(
        DRIVE_SNAPSHOTS_FOLDER,
        gameFolder.id,
        " and appProperties has { key='kind' and value='folder' }"
      )) ??
      (await this.options.client.createFolder(
        DRIVE_SNAPSHOTS_FOLDER,
        gameFolder.id
      ));

    return {
      gameFolderId: gameFolder.id,
      snapshotsFolderId: snapshotsFolder.id,
    };
  }

  private async readManifestRecord(
    file: DriveFile
  ): Promise<DriveManifestRecord> {
    const text = await this.options.client.getTextFile(file.id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GoogleDriveError(
        "google_drive_manifest_corrupt",
        `Cloud save manifest ${file.name} is not valid JSON`
      );
    }
    return { file, manifest: parseDriveManifest(parsed) };
  }

  /**
   * Lists manifests newest first.
   *
   * The result is cached for five minutes so opening a game page does not spend
   * quota on every render. The commit path always bypasses the cache: a stale
   * head is exactly what creates a conflicted snapshot.
   */
  async listManifestRecords(
    gameKey: string,
    options: { fresh?: boolean } = {}
  ): Promise<DriveManifestRecord[]> {
    const cached = this.manifestCache.get(gameKey);
    if (
      !options.fresh &&
      cached &&
      this.now() - cached.measuredAt < this.listCacheTtlMs
    ) {
      return cached.records;
    }

    const folders = await this.findFolders(gameKey);
    if (!folders) {
      this.manifestCache.set(gameKey, { measuredAt: this.now(), records: [] });
      return [];
    }

    const files = await this.options.client.listAllFiles(
      `'${folders.snapshotsFolderId}' in parents and trashed = false ` +
        `and appProperties has { key='kind' and value='manifest' }`,
      "id,name,mimeType,size,createdTime,modifiedTime,appProperties,parents"
    );
    const records = await Promise.all(
      files.map((file) => this.readManifestRecord(file))
    );
    records.sort((left, right) => {
      if (right.manifest.version !== left.manifest.version) {
        return right.manifest.version - left.manifest.version;
      }
      return (right.file.createdTime ?? "").localeCompare(
        left.file.createdTime ?? ""
      );
    });

    this.manifestCache.set(gameKey, { measuredAt: this.now(), records });
    return records;
  }

  async listSnapshots(game: CloudSaveGameId): Promise<RemoteSnapshotSummary[]> {
    const records = await this.listManifestRecords(toDriveGameKey(game));
    return records.map(summaryOf);
  }

  private async listBlobFiles(gameFolderId: string): Promise<DriveFile[]> {
    return this.options.client.listAllFiles(
      `'${gameFolderId}' in parents and trashed = false ` +
        `and appProperties has { key='kind' and value='blob' }`,
      "id,name,mimeType,size,createdTime,modifiedTime,appProperties,parents"
    );
  }

  /**
   * Reads one manifest straight from Drive by file id.
   *
   * A manifest is self-describing (it carries its game, version and files), so
   * restore does not need to know the game before it starts and cannot be
   * pointed at another game's folder by a stale caller.
   */
  private async getRecordById(
    snapshotId: string
  ): Promise<DriveManifestRecord> {
    const text = await this.options.client
      .getTextFile(snapshotId)
      .catch((error: unknown) => {
        if (error instanceof GoogleDriveError && error.status === 404) {
          throw new GoogleDriveError(
            "cloud_save_restore_snapshot_not_found",
            "That cloud save version no longer exists on Google Drive"
          );
        }
        throw error;
      });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GoogleDriveError(
        "google_drive_manifest_corrupt",
        "The cloud save manifest on Google Drive is not valid JSON"
      );
    }
    const manifest = parseDriveManifest(parsed);
    return {
      file: { id: snapshotId, name: DRIVE_MANIFEST_FILE(manifest.version) },
      manifest,
    };
  }

  private async requireDeviceId(): Promise<string> {
    const deviceId = (await this.options.getDeviceId()).trim();
    if (!deviceId) {
      throw new GoogleDriveError(
        "google_drive_device_id_missing",
        "Sphinx could not identify this device"
      );
    }
    return deviceId;
  }

  private async uploadManifest(
    manifest: GoogleDriveManifest,
    folders: DriveFolders
  ): Promise<DriveFile> {
    return this.options.client.uploadFile({
      name: DRIVE_MANIFEST_FILE(manifest.version),
      parents: [folders.snapshotsFolderId],
      mimeType: MANIFEST_MIME,
      body: serializeDriveManifest(manifest),
      appProperties: {
        app: DRIVE_APP_TAG,
        schema: String(DRIVE_MANIFEST_SCHEMA),
        kind: "manifest",
        gameKey: manifest.gameKey,
        hash: manifest.aggregateHash,
        version: String(manifest.version),
        parent: String(manifest.parentVersion),
        deviceId: manifest.deviceId,
        createdAt: manifest.createdAt,
      },
    });
  }

  private async deleteManifestRecords(
    records: DriveManifestRecord[]
  ): Promise<void> {
    for (const record of records) {
      await this.options.client.deleteFile(record.file.id);
    }
    if (records.length > 0) this.clearCache();
  }

  /**
   * Uploads every blob that is not already content-addressed in the game
   * folder. Returns how many files were skipped and how many bytes are new.
   */
  private async uploadMissingBlobs(
    input: CloudSaveProviderUploadInput,
    gameKey: string,
    folders: DriveFolders,
    onProgress?: (progress: CloudSaveUploadProgress) => void
  ): Promise<{ newBytes: number; skippedFiles: number }> {
    const blobs = await this.listBlobFiles(folders.gameFolderId);
    const existingHashes = new Set(
      blobs.flatMap((file) => {
        const hash = file.appProperties?.hash;
        return hash ? [hash] : [];
      })
    );

    const sourcesByHash = new Map<string, LocalGameSnapshotSourceFile>();
    for (const source of input.sourceFiles) {
      if (!sourcesByHash.has(source.hash))
        sourcesByHash.set(source.hash, source);
    }
    const identitiesByHash = new Map<string, number>();
    for (const file of input.files) {
      identitiesByHash.set(
        hashOf(file),
        (identitiesByHash.get(hashOf(file)) ?? 0) + 1
      );
    }

    const missing = new Map<string, { hash: string; sizeBytes: number }>();
    let skippedFiles = 0;
    for (const file of input.files) {
      if (existingHashes.has(file.hash)) {
        skippedFiles += 1;
        continue;
      }
      missing.set(file.hash, { hash: file.hash, sizeBytes: file.sizeBytes });
    }

    const totalBytes = input.files.reduce(
      (total, file) => total + file.sizeBytes,
      0
    );
    let completedFiles = skippedFiles;
    let completedBytes = input.files
      .filter((file) => existingHashes.has(file.hash))
      .reduce((total, file) => total + file.sizeBytes, 0);
    const emit = (currentFile: string | null) =>
      onProgress?.({
        completedFiles,
        totalFiles: input.files.length,
        completedBytes,
        totalBytes,
        currentFile,
      });
    emit(null);

    const jobs = [...missing.values()];
    const newBytes = jobs.reduce((total, job) => total + job.sizeBytes, 0);

    if (newBytes > 0) {
      const shouldConfirm =
        newBytes > (await this.options.getSettings()).confirmUploadBytes;
      if (shouldConfirm && this.options.confirmUpload) {
        const confirmed = await this.options.confirmUpload(newBytes);
        if (!confirmed) {
          throw new GoogleDriveError(
            "google_drive_upload_cancelled",
            "Upload cancelled before sending save data to Google Drive"
          );
        }
      }
    }

    let nextIndex = 0;
    let failure: unknown = null;
    const runWorker = async () => {
      while (!failure) {
        const index = nextIndex;
        nextIndex += 1;
        const job = jobs[index];
        if (!job) return;
        const source = sourcesByHash.get(job.hash);
        if (!source) {
          failure = new GoogleDriveError(
            "google_drive_missing_local_source",
            `No local file for cloud save blob ${job.hash.slice(0, 12)}`
          );
          return;
        }

        emit(source.relativePath);
        try {
          await this.options.client.uploadFileFromPath({
            name: DRIVE_BLOB_FILE(job.hash),
            parents: [folders.gameFolderId],
            mimeType: BLOB_MIME,
            path: source.absolutePath,
            sizeBytes: job.sizeBytes,
            appProperties: {
              app: DRIVE_APP_TAG,
              schema: String(DRIVE_MANIFEST_SCHEMA),
              kind: "blob",
              gameKey,
              hash: job.hash,
              size: String(job.sizeBytes),
            },
          });
        } catch (error) {
          failure = error;
          return;
        }

        completedFiles += identitiesByHash.get(job.hash) ?? 1;
        completedBytes += job.sizeBytes;
        emit(null);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_UPLOADS, jobs.length) },
        () => runWorker()
      )
    );
    if (failure) throw failure;

    return { newBytes, skippedFiles };
  }

  async uploadSnapshot(
    input: CloudSaveProviderUploadInput,
    onProgress?: (progress: CloudSaveUploadProgress) => void
  ): Promise<CloudSaveProviderUploadResult> {
    const gameKey = toDriveGameKey(input);
    const settings = await this.options.getSettings();
    const folders = await this.ensureFolders(gameKey);
    const before = await this.listManifestRecords(gameKey, { fresh: true });
    const head = before[0] ?? null;
    const headVersion = head?.manifest.version ?? 0;

    // Optimistic check without relying on If-Match: Drive v3 documents no
    // ETag/`If-Match` precondition for files.create or files.update, so the
    // manifest version and the post-write re-list are the whole protocol.
    if (headVersion !== input.baseVersion) {
      throw new GoogleDriveError(
        "cloud_save_drive_version_conflict",
        `Google Drive is at version ${headVersion} but this upload expected ` +
          `version ${input.baseVersion}. Sync again to merge.`
      );
    }

    if (
      head &&
      head.manifest.aggregateHash === input.aggregateHash &&
      samePaths(head.manifest.customPathRawPaths, input.customPathRawPaths)
    ) {
      // Nothing changed: do not spend a manifest write or a version.
      return { kind: "committed", snapshot: summaryOf(head) };
    }

    await this.uploadMissingBlobs(input, gameKey, folders, onProgress);

    const deviceId = await this.requireDeviceId();
    const version = headVersion + 1;
    let manifest: GoogleDriveManifest = {
      schema: DRIVE_MANIFEST_SCHEMA,
      app: DRIVE_APP_TAG,
      gameKey,
      shop: input.shop,
      objectId: input.objectId,
      version,
      parentVersion: headVersion,
      deviceId,
      createdAt: new Date(this.now()).toISOString(),
      aggregateHash: input.aggregateHash,
      fileCount: input.files.length,
      totalSizeBytes: input.files.reduce(
        (total, file) => total + file.sizeBytes,
        0
      ),
      customPathRawPaths: [...input.customPathRawPaths],
      variants: input.variants,
      files: input.files,
    };
    let createdFile = await this.uploadManifest(manifest, folders);
    this.clearCache();

    // Re-list: another device may have written the same version between the
    // head check and this upload. Drive cannot stop it, so detect it here.
    let after = await this.listManifestRecords(gameKey, { fresh: true });
    let twins = after.filter(
      (record) =>
        record.manifest.version === manifest.version &&
        record.file.id !== createdFile.id
    );

    if (twins.length > 0) {
      const backupPath = await this.backupLocal(input, gameKey);
      const choice =
        (await this.options.chooseConflict?.({
          gameKey,
          version: manifest.version,
          backupPath,
        })) ?? "cloud";

      if (choice === "cloud") {
        await this.options.client.deleteFile(createdFile.id);
        this.clearCache();
        const remote = twins[0];
        return { kind: "remote-won", snapshot: summaryOf(remote) };
      }

      if (choice === "local") {
        await this.deleteManifestRecords(twins);
      } else {
        const nextVersion =
          Math.max(...after.map((record) => record.manifest.version)) + 1;
        manifest = {
          ...manifest,
          version: nextVersion,
          parentVersion: nextVersion - 1,
        };
        createdFile = await this.uploadManifest(manifest, folders);
        this.clearCache();
      }
      after = await this.listManifestRecords(gameKey, { fresh: true });
      twins = [];
    }

    const pruned = await this.pruneManifests(
      gameKey,
      settings.retentionVersions
    );
    if (pruned) {
      await this.collectGarbage(gameKey);
    }

    const committed = after.find(
      (record) => record.manifest.version === manifest.version
    );
    return {
      kind: "committed",
      snapshot: committed
        ? summaryOf(committed)
        : {
            id: createdFile.id,
            version: manifest.version,
            fileCount: manifest.fileCount,
            totalSizeBytes: manifest.totalSizeBytes,
            aggregateHash: manifest.aggregateHash,
          },
    };
  }

  private async backupLocal(
    input: CloudSaveProviderUploadInput,
    gameKey: string
  ): Promise<string> {
    if (!this.options.backupLocalFiles) return "";
    return this.options.backupLocalFiles({
      gameKey,
      sourceFiles: input.sourceFiles,
    });
  }

  /**
   * Retention counts manifests, not blobs. It runs only after a successful
   * commit, so the head is never pruned out from under a restore.
   */
  async pruneManifests(
    gameKey: string,
    retentionVersions: number
  ): Promise<boolean> {
    const keep = Math.min(10, Math.max(1, Math.trunc(retentionVersions) || 1));
    const records = await this.listManifestRecords(gameKey, { fresh: true });
    const excess = records.slice(keep);
    if (excess.length === 0) return false;
    await this.deleteManifestRecords(excess);
    return true;
  }

  /**
   * Mark-and-sweep over blobs. Only unreferenced blobs older than the grace
   * period are removed, so a blob uploaded by an in-flight snapshot whose
   * manifest is not written yet is never collected.
   */
  async collectGarbage(gameKey: string): Promise<string[]> {
    const folders = await this.findFolders(gameKey);
    if (!folders) return [];

    const records = await this.listManifestRecords(gameKey, { fresh: true });
    const referenced = new Set<string>();
    for (const record of records) {
      for (const file of record.manifest.files) referenced.add(file.hash);
    }

    const cutoff = this.now() - DRIVE_GC_GRACE_MS;
    const deleted: string[] = [];
    for (const blob of await this.listBlobFiles(folders.gameFolderId)) {
      const hash = blob.appProperties?.hash;
      if (!hash || referenced.has(hash)) continue;
      const modifiedAt = Date.parse(blob.modifiedTime ?? "");
      if (!Number.isFinite(modifiedAt) || modifiedAt > cutoff) continue;
      await this.options.client.deleteFile(blob.id);
      deleted.push(hash);
    }
    return deleted;
  }

  async getRestoreManifest(snapshot: {
    id: string;
    version: number;
  }): Promise<RestoreManifestResponse> {
    const record = await this.getRecordById(snapshot.id);
    if (record.manifest.version !== snapshot.version) {
      throw new GoogleDriveError(
        "google_drive_manifest_version_mismatch",
        "The cloud save manifest does not match the requested version"
      );
    }
    return {
      snapshot: {
        id: record.file.id,
        version: record.manifest.version,
        shop: record.manifest.shop,
        objectId: record.manifest.objectId,
      },
      customPathRawPaths: record.manifest.customPathRawPaths,
      variants: record.manifest.variants,
      files: record.manifest.files,
    };
  }

  async getDownloadUrls(snapshot: {
    id: string;
    version: number;
  }): Promise<RestoreDownloadUrlFile[]> {
    const record = await this.getRecordById(snapshot.id);
    const folders = await this.findFolders(record.manifest.gameKey);
    if (!folders) {
      throw new GoogleDriveError(
        "google_drive_manifest_not_found",
        "The cloud save folder no longer exists on Google Drive"
      );
    }
    const blobs = await this.listBlobFiles(folders.gameFolderId);
    const idByHash = new Map(
      blobs.flatMap((blob) => {
        const hash = blob.appProperties?.hash;
        return hash ? [[hash, blob.id] as const] : [];
      })
    );

    return record.manifest.files.map((file) => {
      const fileId = idByHash.get(file.hash);
      if (!fileId) {
        throw new GoogleDriveError(
          "google_drive_blob_missing",
          `Cloud save data for ${file.relativePath} is missing on Google Drive`
        );
      }
      return {
        ...file,
        downloadUrl: `${GOOGLE_DRIVE_API_BASE}/drive/v3/files/${encodeURIComponent(
          fileId
        )}?alt=media`,
      };
    });
  }

  /**
   * Downloads one blob to `<tempRoot>/hydra-cloud-saves/<snapshot>/<hash>.blob`.
   *
   * The layout matches the Hydra native downloader so the existing cleanup
   * hook removes these files too. Integrity is checked afterwards by
   * `NativeAddon.verifyDownloadedRestoreFile`, not here.
   */
  async downloadBlobToTemp(input: {
    tempSnapshotId: string;
    hash: string;
    sizeBytes: number;
    downloadUrl: string;
    tempRoot: string;
  }): Promise<string> {
    const match = /\/files\/([^/?]+)/.exec(input.downloadUrl);
    if (!match) {
      throw new GoogleDriveError(
        "google_drive_invalid_download_url",
        "The cloud save download URL is not a Drive file"
      );
    }

    const directory = path.join(
      input.tempRoot,
      "hydra-cloud-saves",
      input.tempSnapshotId
    );
    const finalPath = path.join(directory, `${input.hash}.blob`);
    const partialPath = `${finalPath}.part`;
    await fs.mkdir(directory, { recursive: true });
    await fs.unlink(partialPath).catch(() => undefined);

    const response = await this.options.client.getMediaResponse(
      decodeURIComponent(match[1])
    );
    const declaredLength = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10
    );
    if (Number.isFinite(declaredLength) && declaredLength !== input.sizeBytes) {
      throw new GoogleDriveError(
        "google_drive_download_size_mismatch",
        "Google Drive returned a different size than the manifest records"
      );
    }
    if (!response.body) {
      throw new GoogleDriveError(
        "google_drive_download_empty",
        "Google Drive returned an empty response"
      );
    }

    let downloaded = 0;
    try {
      const source = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream
      );
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          downloaded += chunk.length;
          if (downloaded > input.sizeBytes) {
            callback(new Error("google_drive_download_size_mismatch"));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(source, counter, createWriteStream(partialPath));
      if (downloaded !== input.sizeBytes) {
        throw new Error("google_drive_download_size_mismatch");
      }
      await fs.rename(partialPath, finalPath);
      return finalPath;
    } catch (error) {
      await fs.unlink(partialPath).catch(() => undefined);
      throw error instanceof GoogleDriveError
        ? error
        : new GoogleDriveError(
            "google_drive_download_failed",
            error instanceof Error ? error.message : String(error)
          );
    }
  }

  async deleteSnapshots(game: CloudSaveGameId): Promise<void> {
    const gameKey = toDriveGameKey(game);
    const folders = await this.findFolders(gameKey);
    if (!folders) {
      this.clearCache();
      return;
    }

    for (const file of await this.listBlobFiles(folders.gameFolderId)) {
      await this.options.client.deleteFile(file.id);
    }
    for (const record of await this.listManifestRecords(gameKey, {
      fresh: true,
    })) {
      await this.options.client.deleteFile(record.file.id);
    }
    await this.options.client
      .deleteFile(folders.snapshotsFolderId)
      .catch(() => undefined);
    await this.options.client
      .deleteFile(folders.gameFolderId)
      .catch(() => undefined);
    this.clearCache();
  }

  /** Used by "Disconnect and delete cloud data" (PRD §4.F). */
  async deleteAllCloudSaveData(): Promise<number> {
    const files = await this.options.client.listAllFiles(
      "appProperties has { key='app' and value='sphinx' }",
      "id,name,mimeType,size,appProperties"
    );
    let deleted = 0;
    for (const file of files) {
      await this.options.client.deleteFile(file.id);
      deleted += 1;
    }
    this.clearCache();
    return deleted;
  }

  async getCloudSaveUsage(): Promise<{
    bytes: number;
    fileCount: number;
  }> {
    const files = await this.options.client.listAllFiles(
      "appProperties has { key='app' and value='sphinx' }",
      "id,size"
    );
    return {
      fileCount: files.length,
      bytes: files.reduce((total, file) => {
        const size = Number.parseInt(file.size ?? "0", 10);
        return total + (Number.isFinite(size) ? size : 0);
      }, 0),
    };
  }

  /** Stable identifier for the device id store; also handy in tests. */
  static gameKeyFor = toDriveGameKey;

  /** Content hash of a manifest, used only for diagnostics. */
  static fingerprint(manifest: GoogleDriveManifest): string {
    return createHash("sha256")
      .update(JSON.stringify(manifest.files))
      .digest("hex");
  }
}

export const newDeviceId = () => randomUUID();

export type { RemoteGameSnapshot };
