/**
 * Tests for `make-update-manifest.mjs`.
 *
 * Run with the project's test script: `yarn test` (which expands to
 * `node --import ./scripts/register-ts-node.mjs --test "scripts/*.test.mjs"`).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { buildManifest, PLATFORM, sha256File } from "./make-update-manifest.mjs";

describe("buildManifest", () => {
  test("strips the leading v from the tag for version", () => {
    const manifest = buildManifest({
      tag: "v0.1.0",
      signature: "sig-content",
      bundleBasename: "sphinx-launcher-0.1.0-setup.exe",
      pubDate: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(manifest.version, "0.1.0");
  });

  test("builds the github release url from tag and bundle name", () => {
    const manifest = buildManifest({
      tag: "v0.1.0",
      signature: "sig-content",
      bundleBasename: "sphinx-launcher-0.1.0-setup.exe",
      pubDate: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(
      manifest.platforms[PLATFORM].url,
      "https://github.com/Raka-Mahendra/sphinx/releases/download/v0.1.0/sphinx-launcher-0.1.0-setup.exe"
    );
  });

  test("embeds the verbatim signature content, not a path", () => {
    const manifest = buildManifest({
      tag: "v0.1.0",
      signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
      bundleBasename: "sphinx-launcher-0.1.0-setup.exe",
      pubDate: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(
      manifest.platforms[PLATFORM].signature,
      "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ=="
    );
  });

  test("passes notes through and defaults to null when omitted", () => {
    const withNotes = buildManifest({
      tag: "v0.1.0",
      signature: "sig",
      bundleBasename: "b.exe",
      notes: "What's new",
      pubDate: "2026-01-01T00:00:00.000Z",
    });
    const withoutNotes = buildManifest({
      tag: "v0.1.0",
      signature: "sig",
      bundleBasename: "b.exe",
      pubDate: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(withNotes.notes, "What's new");
    assert.equal(withoutNotes.notes, null);
  });

  test("uses the provided pubDate unchanged", () => {
    const manifest = buildManifest({
      tag: "v0.1.0",
      signature: "sig",
      bundleBasename: "b.exe",
      pubDate: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(manifest.pub_date, "2026-01-01T00:00:00.000Z");
  });
});

describe("sha256File", () => {
  test("matches an independently computed hash for a fixed fixture", async () => {
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const crypto = await import("node:crypto");
    const dir = await mkdtemp(path.join(os.tmpdir(), "sphinx-manifest-test-"));
    const file = path.join(dir, "blob.bin");
    await writeFile(file, Buffer.from("hello sphinx"));

    const expected = crypto
      .createHash("sha256")
      .update("hello sphinx")
      .digest("hex");

    try {
      const digest = await sha256File(file);
      assert.equal(digest, expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
