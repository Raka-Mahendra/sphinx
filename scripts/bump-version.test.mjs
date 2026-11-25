/**
 * Tests for `bump-version.mjs`.
 *
 * Run with `yarn test` (`node --import ./scripts/register-ts-node.mjs --test "scripts/*.test.mjs"`).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeVersion } from "./bump-version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = path.join(ROOT, "scripts", "bump-version.mjs");

describe("normalizeVersion", () => {
  test("accepts plain X.Y.Z with or without leading v", () => {
    assert.equal(normalizeVersion("0.2.0"), "0.2.0");
    assert.equal(normalizeVersion("v0.2.0"), "0.2.0");
    assert.equal(normalizeVersion("v10.20.30"), "10.20.30");
  });

  test("rejects pre-release and build metadata suffixes", () => {
    assert.throws(() => normalizeVersion("0.2.0-beta.1"), /plain X\.Y\.Z/);
    assert.throws(() => normalizeVersion("v0.2.0-rc.1"), /plain X\.Y\.Z/);
    assert.throws(() => normalizeVersion("0.2.0+build.5"), /plain X\.Y\.Z/);
  });

  test("rejects incomplete or non-numeric versions", () => {
    assert.throws(() => normalizeVersion("v0.2"), /plain X\.Y\.Z/);
    assert.throws(() => normalizeVersion("latest"), /plain X\.Y\.Z/);
    assert.throws(() => normalizeVersion("vv0.2.0"), /plain X\.Y\.Z/);
  });
});

describe("bump-version CLI --check", () => {
  test("exits 0 when all three version sources match the tag", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
    );
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--check", `v${pkg.version}`],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(`all version sources are ${pkg.version}`)
    );
  });

  test("exits 1 when the tag disagrees with the repository files", () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--check", "v99.99.99"],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /version drift: expected 99\.99\.99/);
  });

  test("exits 2 on a pre-release tag", () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--check", "v0.1.0-beta.1"],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /not a plain X\.Y\.Z version/);
  });
});
