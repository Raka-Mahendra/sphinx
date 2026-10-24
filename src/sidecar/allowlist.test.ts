import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  allowlistCounts,
  isEventChannelAllowed,
  isInvokeChannelAllowed,
  isSendChannelAllowed,
  matchesDynamicEventChannel,
} from "./allowlist.ts";

/**
 * The allowlist has two jobs: be complete, and be strict.
 *
 * Completeness is proven by regenerating from source and diffing — if a channel
 * was added to `src/main` without regenerating, this test fails with the list of
 * stale files. Strictness is proven by the matcher tests below.
 */

const root = process.cwd();

describe("generated allowlist", () => {
  it("is up to date with src/main", () => {
    // `--check` exits non-zero and prints the stale file names when the
    // committed output no longer matches the source scan.
    execFileSync(
      process.execPath,
      [path.join(root, "scripts", "generate-ipc-allowlist.mjs"), "--check"],
      { cwd: root, stdio: "pipe" }
    );
  });

  it("covers the channels the renderer actually calls", () => {
    // A small, stable sample across the event folders. If the scan ever stops
    // seeing `registerEvent`, these disappear and the test says so.
    for (const channel of [
      "ping",
      "getVersion",
      "getDefaultDownloadsPath",
      "openBigPictureWindow",
      "minimizeMainWindow",
      "showOpenDialog",
      "openExternal",
      "clipboardWriteText",
    ]) {
      assert.equal(isInvokeChannelAllowed(channel), true, channel);
    }
  });

  it("has no ipcMain.on channels in the baseline", () => {
    // The Fase 0 audit found zero `ipcMain.on` registrations; if one appears,
    // this fails so the send path gets reviewed instead of silently shipped.
    assert.equal(allowlistCounts().send, 0);
  });

  it("does not allow arbitrary channels", () => {
    assert.equal(isInvokeChannelAllowed("execute-anything"), false);
    assert.equal(isSendChannelAllowed("execute-anything"), false);
    assert.equal(isEventChannelAllowed("on-not-real"), false);
  });
});

describe("dynamic event channels", () => {
  it("accepts the prefixes the baseline emits", () => {
    assert.equal(
      isEventChannelAllowed("on-update-achievements-12345-steam"),
      true
    );
    assert.equal(isEventChannelAllowed("on-upload-complete-99-custom"), true);
    assert.equal(
      isEventChannelAllowed("on-ps2-memcard-scan-progress-abc-123"),
      true
    );
    assert.equal(
      isEventChannelAllowed("on-backup-download-progress-1-launchbox"),
      true
    );
  });

  it("rejects a prefix with no id", () => {
    assert.equal(matchesDynamicEventChannel("on-update-achievements-"), false);
  });

  it("rejects characters that could smuggle a different channel", () => {
    assert.equal(
      isEventChannelAllowed("on-update-achievements-../../etc/passwd"),
      false
    );
    assert.equal(
      isEventChannelAllowed("on-update-achievements-1 steam"),
      false
    );
    assert.equal(
      isEventChannelAllowed('on-update-achievements-1"steam'),
      false
    );
    assert.equal(
      isEventChannelAllowed("on-update-achievements-1\nsteam"),
      false
    );
  });

  it("rejects a prefix that is not at the start", () => {
    assert.equal(isEventChannelAllowed("x-on-update-achievements-1"), false);
  });

  it("rejects an over-long suffix", () => {
    assert.equal(
      isEventChannelAllowed(`on-update-achievements-${"a".repeat(201)}`),
      false
    );
  });
});
