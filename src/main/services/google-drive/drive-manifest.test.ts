import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  parseDriveManifest,
  serializeDriveManifest,
  type GoogleDriveManifest,
} from "./drive-manifest.ts";

const variantId = "1".repeat(64);

const manifest: GoogleDriveManifest = {
  schema: 1,
  app: "sphinx",
  gameKey: "steam-730-2ee69e2d",
  shop: "steam",
  objectId: "730",
  version: 4,
  parentVersion: 3,
  deviceId: "device-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  aggregateHash: "a".repeat(64),
  fileCount: 1,
  totalSizeBytes: 12,
  customPathRawPaths: [],
  variants: [{ variantId, kind: "default" }],
  files: [
    {
      variantId,
      rawPath: "<winAppData>/Game",
      relativePath: "save.sav",
      hash: "b".repeat(64),
      sizeBytes: 12,
      lastModifiedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

describe("Google Drive manifest", () => {
  it("round-trips a complete manifest", () => {
    const parsed = parseDriveManifest(
      JSON.parse(serializeDriveManifest(manifest).toString("utf8"))
    );
    assert.deepEqual(parsed, manifest);
  });

  it("rejects totals that do not match the file list", () => {
    assert.throws(() =>
      parseDriveManifest({ ...manifest, totalSizeBytes: 13 })
    );
    assert.throws(() => parseDriveManifest({ ...manifest, fileCount: 2 }));
  });

  it("rejects unknown fields so schema drift is loud", () => {
    assert.throws(() =>
      parseDriveManifest({ ...manifest, index: { files: [] } })
    );
  });

  it("rejects a version that does not descend from its parent", () => {
    assert.throws(() =>
      parseDriveManifest({ ...manifest, parentVersion: manifest.version })
    );
  });

  it("rejects files of an unknown variant", () => {
    assert.throws(() =>
      parseDriveManifest({
        ...manifest,
        files: [{ ...manifest.files[0], variantId: "c".repeat(64) }],
      })
    );
  });

  it("rejects custom paths that the manifest does not declare", () => {
    assert.throws(() =>
      parseDriveManifest({
        ...manifest,
        files: [{ ...manifest.files[0], rawPath: "<custom>/saves" }],
      })
    );
  });

  it("rejects a non-Sphinx document", () => {
    assert.throws(() => parseDriveManifest({ ...manifest, app: "other" }));
    assert.throws(() => parseDriveManifest({ ...manifest, schema: 2 }));
  });
});
