import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  DEFAULT_GOOGLE_DRIVE_SETTINGS,
  MAX_RETENTION_VERSIONS,
  MIN_RETENTION_VERSIONS,
  normalizeGoogleDriveSettings,
  readGoogleDriveSettings,
  writeGoogleDriveSettings,
} from "./drive-settings.ts";

let tempRoot = "";

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sphinx-drive-settings-"));
});

after(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("Google Drive settings", () => {
  it("defaults to three retained versions and a 100 MB confirmation", () => {
    assert.deepEqual(normalizeGoogleDriveSettings(undefined), {
      retentionVersions: 3,
      confirmUploadBytes: 100 * 1024 * 1024,
    });
  });

  it("clamps retention into 1..10 and truncates fractions", () => {
    assert.equal(
      normalizeGoogleDriveSettings({ retentionVersions: 0 }).retentionVersions,
      MIN_RETENTION_VERSIONS
    );
    assert.equal(
      normalizeGoogleDriveSettings({ retentionVersions: 99 }).retentionVersions,
      MAX_RETENTION_VERSIONS
    );
    assert.equal(
      normalizeGoogleDriveSettings({ retentionVersions: 4.9 })
        .retentionVersions,
      4
    );
  });

  it("falls back per field instead of failing on corrupt values", () => {
    assert.deepEqual(
      normalizeGoogleDriveSettings({
        retentionVersions: "many",
        confirmUploadBytes: 0,
      }),
      {
        retentionVersions: DEFAULT_GOOGLE_DRIVE_SETTINGS.retentionVersions,
        confirmUploadBytes: 1,
      }
    );
    assert.deepEqual(normalizeGoogleDriveSettings([1, 2, 3]), {
      ...DEFAULT_GOOGLE_DRIVE_SETTINGS,
    });
  });

  it("persists settings atomically and normalizes on write", async () => {
    const file = path.join(tempRoot, "nested", "google-drive-settings.json");
    const written = await writeGoogleDriveSettings(
      { retentionVersions: 7, confirmUploadBytes: 2048 },
      file
    );
    assert.deepEqual(written, {
      retentionVersions: 7,
      confirmUploadBytes: 2048,
    });
    assert.deepEqual(await readGoogleDriveSettings(file), written);
  });

  it("returns defaults when the file is missing or unreadable", async () => {
    assert.deepEqual(
      await readGoogleDriveSettings(path.join(tempRoot, "missing.json")),
      { ...DEFAULT_GOOGLE_DRIVE_SETTINGS }
    );

    const broken = path.join(tempRoot, "broken.json");
    await fs.writeFile(broken, "{not json");
    assert.deepEqual(await readGoogleDriveSettings(broken), {
      ...DEFAULT_GOOGLE_DRIVE_SETTINGS,
    });
  });
});
