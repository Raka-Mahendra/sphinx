import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type {
  GoogleDriveSettings,
  LocalGameSnapshotSourceFile,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  GoogleDriveError,
  type DriveClientLike,
  type DriveFile,
  type DriveFileList,
  type DrivePathUploadInput,
  type DriveUploadInput,
} from "./drive-client.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import {
  GoogleDriveCloudSaveProvider,
  DRIVE_GC_GRACE_MS,
} from "./google-drive-provider.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { toDriveGameKey } from "./drive-paths.ts";

const GAME_KEY = toDriveGameKey({ shop: "steam", objectId: "730" });

const FOLDER_MIME = "application/vnd.google-apps.folder";
const hash = (label: string) =>
  createHash("sha256").update(label).digest("hex");
const variant: SnapshotVariant = {
  variantId: hash("variant"),
  kind: "default",
};
const selectedVariant: SnapshotVariant = {
  variantId: hash("steam-variant"),
  kind: "steam-account",
  steamId64: "76561198000000000",
};

interface FakeEntry {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  content: Buffer;
  createdTime: string;
  modifiedTime: string;
}

const toDriveFile = (entry: FakeEntry): DriveFile => ({
  id: entry.id,
  name: entry.name,
  mimeType: entry.mimeType,
  size: String(entry.content.length),
  createdTime: entry.createdTime,
  modifiedTime: entry.modifiedTime,
  appProperties: { ...entry.appProperties },
  parents: [...entry.parents],
});

class FakeDrive implements DriveClientLike {
  readonly entries = new Map<string, FakeEntry>();
  private nextId = 1;
  now = Date.parse("2026-01-01T00:00:00.000Z");
  manifestUploadHook: ((entry: FakeEntry) => void) | null = null;

  private stamp() {
    return new Date(this.now).toISOString();
  }

  private matches(entry: FakeEntry, query: string) {
    const parent = /'([^']+)' in parents/.exec(query)?.[1];
    if (parent && !entry.parents.includes(parent)) return false;

    const name = /name = '([^']+)'/.exec(query)?.[1];
    if (name && entry.name !== name) return false;

    const kind = /value='(manifest|blob|folder)'/.exec(query)?.[1];
    if (kind && entry.appProperties.kind !== kind) return false;

    if (
      query.includes(`mimeType = '${FOLDER_MIME}'`) &&
      entry.mimeType !== FOLDER_MIME
    )
      return false;

    if (
      query.includes("key='app' and value='sphinx'") &&
      entry.appProperties.app !== "sphinx"
    )
      return false;

    return true;
  }

  async listFiles(params: {
    q: string;
    fields: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<DriveFileList> {
    return {
      files: [...this.entries.values()]
        .filter((entry) => this.matches(entry, params.q))
        .map(toDriveFile),
    };
  }

  async listAllFiles(query: string): Promise<DriveFile[]> {
    return [...this.entries.values()]
      .filter((entry) => this.matches(entry, query))
      .map(toDriveFile);
  }

  async createFolder(name: string, parentId: string): Promise<DriveFile> {
    const entry: FakeEntry = {
      id: `folder-${this.nextId++}`,
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
      appProperties: { app: "sphinx", schema: "1", kind: "folder" },
      content: Buffer.alloc(0),
      createdTime: this.stamp(),
      modifiedTime: this.stamp(),
    };
    this.entries.set(entry.id, entry);
    return toDriveFile(entry);
  }

  private create(input: {
    name: string;
    parents: string[];
    appProperties?: Record<string, string>;
    mimeType: string;
    content: Buffer;
  }): DriveFile {
    const entry: FakeEntry = {
      id: `file-${this.nextId++}`,
      name: input.name,
      mimeType: input.mimeType,
      parents: [...input.parents],
      appProperties: { ...(input.appProperties ?? {}) },
      content: input.content,
      createdTime: this.stamp(),
      modifiedTime: this.stamp(),
    };
    this.entries.set(entry.id, entry);
    if (entry.appProperties.kind === "manifest") {
      this.manifestUploadHook?.(entry);
    }
    return toDriveFile(entry);
  }

  async uploadFile(input: DriveUploadInput): Promise<DriveFile> {
    return this.create({ ...input, content: input.body });
  }

  async uploadFileFromPath(input: DrivePathUploadInput): Promise<DriveFile> {
    return this.create({
      ...input,
      content: await fs.readFile(input.path),
    });
  }

  async getTextFile(fileId: string): Promise<string> {
    const entry = this.entries.get(fileId);
    if (!entry) {
      throw new GoogleDriveError("google_drive_not_found", "missing", 404);
    }
    return entry.content.toString("utf8");
  }

  async getMediaResponse(fileId: string): Promise<Response> {
    const entry = this.entries.get(fileId);
    if (!entry) {
      throw new GoogleDriveError("google_drive_not_found", "missing", 404);
    }
    return new Response(entry.content as unknown as BodyInit, {
      status: 200,
      headers: { "content-length": String(entry.content.length) },
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    this.entries.delete(fileId);
  }

  async about() {
    return { limit: "1000000", usage: "1000" };
  }

  manifests(gameKey: string) {
    return [...this.entries.values()].filter(
      (entry) =>
        entry.appProperties.kind === "manifest" &&
        entry.appProperties.gameKey === gameKey
    );
  }

  blobs() {
    return [...this.entries.values()].filter(
      (entry) => entry.appProperties.kind === "blob"
    );
  }
}

const baseSettings: GoogleDriveSettings = {
  retentionVersions: 3,
  confirmUploadBytes: 100 * 1024 * 1024,
};

let tempRoot = "";

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sphinx-drive-test-"));
});

after(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

interface FixtureOptions {
  baseVersion?: number;
  labels?: string[];
  variants?: SnapshotVariant[];
  aggregate?: string;
  settings?: GoogleDriveSettings;
  confirmUpload?: (bytes: number) => Promise<boolean>;
  chooseConflict?: () => Promise<"cloud" | "local" | "both">;
  backupLocalFiles?: (input: unknown) => Promise<string>;
}

const buildSnapshot = async (labels: string[], variants: SnapshotVariant[]) => {
  const files: SnapshotFile[] = [];
  const sourceFiles: LocalGameSnapshotSourceFile[] = [];

  for (const [index, label] of labels.entries()) {
    const content = Buffer.from(`payload-${label}`);
    const absolutePath = path.join(tempRoot, `${label}.sav`);
    await fs.writeFile(absolutePath, content);
    const fileHash = hash(label);
    const relativePath = `save-${index}.sav`;
    files.push({
      variantId: variants[index % variants.length].variantId,
      rawPath: "<winAppData>/Game",
      relativePath,
      hash: fileHash,
      sizeBytes: content.length,
      lastModifiedAt: "2026-01-01T00:00:00.000Z",
    });
    sourceFiles.push({
      variantId: variants[index % variants.length].variantId,
      rawPath: "<winAppData>/Game",
      relativePath,
      hash: fileHash,
      sizeBytes: content.length,
      lastModifiedAt: "2026-01-01T00:00:00.000Z",
      ruleId: "rule",
      absolutePath,
      confidence: "exact",
      provenance: ["test"],
      localBindings: {
        environmentId: "env",
        rootId: "root",
        concreteUserSegment: "user",
        concretePath: path.dirname(absolutePath),
      },
    });
  }

  return { files, sourceFiles };
};

const createFixture = async (options: FixtureOptions = {}) => {
  const drive = new FakeDrive();
  const settings = options.settings ?? baseSettings;
  const labels = options.labels ?? ["save-one"];
  const variants = options.variants ?? [variant];
  const { files, sourceFiles } = await buildSnapshot(labels, variants);

  const provider = new GoogleDriveCloudSaveProvider({
    client: drive,
    getDeviceId: async () => "device-1",
    getSettings: async () => settings,
    confirmUpload: options.confirmUpload,
    chooseConflict: options.chooseConflict,
    backupLocalFiles: options.backupLocalFiles,
    now: () => drive.now,
    listCacheTtlMs: 0,
  });

  const makeInput = async (
    versionLabels: string[],
    baseVersion: number,
    aggregate = hash(versionLabels.join("|"))
  ) => {
    const snapshot = await buildSnapshot(versionLabels, variants);
    return {
      shop: "steam" as const,
      objectId: "730",
      platform: "windows" as const,
      baseVersion,
      aggregateHash: aggregate,
      variants,
      files: snapshot.files,
      customPathRawPaths: [],
      sourceFiles: snapshot.sourceFiles,
    };
  };

  return {
    drive,
    provider,
    settings,
    makeInput,
    input: {
      shop: "steam" as const,
      objectId: "730",
      platform: "windows" as const,
      baseVersion: options.baseVersion ?? 0,
      aggregateHash: options.aggregate ?? hash(labels.join("|")),
      variants,
      files,
      customPathRawPaths: [],
      sourceFiles,
    },
  };
};

describe("Google Drive cloud save provider", () => {
  it("writes content-addressed blobs and an immutable manifest", async () => {
    const { drive, provider, input } = await createFixture();
    const result = await provider.uploadSnapshot(input);

    assert.equal(result.kind, "committed");
    if (result.kind !== "committed") return;
    assert.equal(result.snapshot.version, 1);
    assert.equal(result.snapshot.fileCount, 1);

    const [manifest] = drive.manifests(GAME_KEY);
    assert.equal(drive.manifests(GAME_KEY).length, 1);
    assert.equal(drive.blobs().length, 1);
    assert.ok(manifest);
    assert.equal(manifest.appProperties.hash, input.aggregateHash);
    assert.equal(manifest.appProperties.version, "1");
    assert.equal(manifest.appProperties.parent, "0");
    assert.equal(manifest.appProperties.deviceId, "device-1");

    const snapshots = await provider.listSnapshots({
      shop: "steam",
      objectId: "730",
    });
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].version, 1);
    assert.equal(snapshots[0].aggregateHash, input.aggregateHash);
  });

  it("reuses identical blobs and skips a commit when the head matches", async () => {
    const { drive, provider, input } = await createFixture({ baseVersion: 0 });
    await provider.uploadSnapshot(input);

    const again = await provider.uploadSnapshot({ ...input, baseVersion: 1 });
    assert.equal(again.kind, "committed");
    if (again.kind === "committed") assert.equal(again.snapshot.version, 1);
    assert.equal(drive.blobs().length, 1);
    assert.equal(drive.manifests(GAME_KEY).length, 1);
  });

  it("uploads one blob for two identities with the same content", async () => {
    const { drive, provider, input } = await createFixture({
      labels: ["shared", "shared"],
    });
    // Both files point at the same hash but different relative paths.
    const result = await provider.uploadSnapshot(input);
    assert.equal(result.kind, "committed");
    assert.equal(drive.blobs().length, 1);
    if (result.kind === "committed") assert.equal(result.snapshot.fileCount, 2);
  });

  it("refuses to write when the remote head moved past baseVersion", async () => {
    const { provider, input } = await createFixture();
    await provider.uploadSnapshot(input);

    await assert.rejects(
      provider.uploadSnapshot({ ...input, aggregateHash: hash("new") }),
      (error: unknown) => {
        assert.ok(error instanceof GoogleDriveError);
        assert.equal(error.code, "cloud_save_drive_version_conflict");
        return true;
      }
    );
  });

  it("asks for confirmation based on new bytes after dedupe", async () => {
    let asked = 0;
    const { drive, provider, input } = await createFixture({
      settings: { ...baseSettings, confirmUploadBytes: 1 },
      confirmUpload: async () => {
        asked += 1;
        return false;
      },
    });

    await assert.rejects(
      provider.uploadSnapshot(input),
      (error: unknown) =>
        (error as { code?: string }).code === "google_drive_upload_cancelled"
    );
    assert.equal(asked, 1);
    assert.equal(drive.blobs().length, 0);
  });

  it("keeps both manifests at the next version when a twin appears", async () => {
    let backupPath = "";
    let choiceAsked = 0;
    const fixture = await createFixture({
      chooseConflict: async () => {
        choiceAsked += 1;
        return "both";
      },
      backupLocalFiles: async () => {
        backupPath = "backup-dir";
        return backupPath;
      },
    });

    fixture.drive.manifestUploadHook = (entry) => {
      fixture.drive.manifestUploadHook = null;
      fixture.drive.entries.set("twin", {
        id: "twin",
        name: entry.name,
        mimeType: entry.mimeType,
        parents: [...entry.parents],
        appProperties: {
          ...entry.appProperties,
          hash: hash("other-device"),
        },
        content: entry.content,
        createdTime: new Date(fixture.drive.now + 1000).toISOString(),
        modifiedTime: new Date(fixture.drive.now + 1000).toISOString(),
      });
    };

    const result = await fixture.provider.uploadSnapshot(fixture.input);
    assert.equal(choiceAsked, 1);
    assert.equal(backupPath, "backup-dir");
    assert.equal(result.kind, "committed");
    if (result.kind === "committed") {
      assert.equal(result.snapshot.version, 2);
      assert.equal(result.snapshot.aggregateHash, fixture.input.aggregateHash);
    }
  });

  it("drops the local manifest when the user keeps the cloud copy", async () => {
    const fixture = await createFixture({
      chooseConflict: async () => "cloud",
    });
    fixture.drive.manifestUploadHook = (entry) => {
      fixture.drive.manifestUploadHook = null;
      fixture.drive.entries.set("twin", {
        id: "twin",
        name: entry.name,
        mimeType: entry.mimeType,
        parents: [...entry.parents],
        appProperties: { ...entry.appProperties, hash: hash("other-device") },
        content: entry.content,
        createdTime: new Date(fixture.drive.now + 1000).toISOString(),
        modifiedTime: new Date(fixture.drive.now + 1000).toISOString(),
      });
    };

    const result = await fixture.provider.uploadSnapshot(fixture.input);
    assert.equal(result.kind, "remote-won");
    const manifests = [...fixture.drive.entries.values()].filter(
      (entry) => entry.appProperties.kind === "manifest"
    );
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0].id, "twin");
  });

  it("prunes manifests by version count and sweeps only old unreferenced blobs", async () => {
    const fixture = await createFixture({
      settings: { ...baseSettings, retentionVersions: 2 },
    });

    for (const version of [1, 2, 3]) {
      await fixture.provider.uploadSnapshot(
        await fixture.makeInput([`save-${version}`], version - 1)
      );
    }

    const manifests = [...fixture.drive.entries.values()].filter(
      (entry) => entry.appProperties.kind === "manifest"
    );
    assert.equal(manifests.length, 2);

    // The first blob is now unreferenced but young: the sweep must not touch it.
    const collectedYoung = await fixture.provider.collectGarbage(GAME_KEY);
    assert.deepEqual(collectedYoung, []);
    const oldBlob = fixture.drive
      .blobs()
      .find((entry) => entry.appProperties.hash === hash("save-1"));
    assert.ok(oldBlob);

    fixture.drive.now += DRIVE_GC_GRACE_MS + 1000;
    const collectedOld = await fixture.provider.collectGarbage(GAME_KEY);
    assert.deepEqual(collectedOld, [hash("save-1")]);
    assert.equal(
      fixture.drive.blobs().some((entry) => entry.id === oldBlob.id),
      false
    );
  });

  it("preserves Steam account variants through upload and restore", async () => {
    const { provider, input } = await createFixture({
      variants: [variant, selectedVariant],
      labels: ["one", "two"],
    });
    const uploaded = await provider.uploadSnapshot(input);
    assert.equal(uploaded.kind, "committed");
    if (uploaded.kind !== "committed") return;

    const manifest = await provider.getRestoreManifest({
      id: uploaded.snapshot.id,
      version: uploaded.snapshot.version,
    });
    assert.deepEqual(
      manifest.variants.map((entry) => entry.variantId).sort(),
      [variant.variantId, selectedVariant.variantId].sort()
    );
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.snapshot.objectId, "730");

    const downloadUrls = await provider.getDownloadUrls({
      id: uploaded.snapshot.id,
      version: uploaded.snapshot.version,
    });
    assert.equal(downloadUrls.length, 2);
    assert.match(
      downloadUrls[0].downloadUrl,
      /^https:\/\/www\.googleapis\.com\//
    );

    const tempPath = await provider.downloadBlobToTemp({
      tempSnapshotId: "snapshot-1",
      hash: downloadUrls[0].hash,
      sizeBytes: downloadUrls[0].sizeBytes,
      downloadUrl: downloadUrls[0].downloadUrl,
      tempRoot,
    });
    const content = await fs.readFile(tempPath);
    assert.equal(content.length, downloadUrls[0].sizeBytes);
  });

  it("deletes every file of a game on explicit removal", async () => {
    const { drive, provider, input } = await createFixture();
    await provider.uploadSnapshot(input);
    assert.ok(drive.blobs().length > 0);

    await provider.deleteSnapshots({ shop: "steam", objectId: "730" });
    assert.equal(drive.blobs().length, 0);
    assert.equal(drive.manifests(GAME_KEY).length, 0);
    const snapshots = await provider.listSnapshots({
      shop: "steam",
      objectId: "730",
    });
    assert.deepEqual(snapshots, []);
  });
});
