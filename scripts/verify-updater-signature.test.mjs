/**
 * Tests for `verify-updater-signature.mjs`.
 *
 * Fixtures are generated at test time with an ephemeral Ed25519 keypair, so the
 * suite proves the minisign decoding and both signature paths without needing
 * the project's real private key.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, test } from "node:test";

import {
  formatKeyId,
  parsePublicKey,
  parseSignature,
  verifyManifest,
  verifyUpdaterSignature,
} from "./verify-updater-signature.mjs";

const PLATFORM = "windows-x86_64";
const KEY_ID = Buffer.from("431565D01CE4C596", "hex");
const TRUSTED_COMMENT =
  "timestamp:1795774964 file:test-setup.exe version:0.1.0";

/**
 * @param {object} [options]
 * @param {boolean} [options.prehashed]
 * @param {Buffer} [options.keyId]
 * @param {Buffer} [options.data]
 * @param {string} [options.trustedComment]
 */
const makeFixture = ({
  prehashed = true,
  keyId = KEY_ID,
  data = Buffer.from("sphinx signing smoke payload"),
  trustedComment = TRUSTED_COMMENT,
} = {}) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const algorithm = prehashed ? "ED" : "Ed";
  const publicKeyBlob = Buffer.concat([
    Buffer.from(algorithm, "latin1"),
    keyId,
    rawPublicKey,
  ]);
  const publicKeyText =
    `untrusted comment: minisign public key ${formatKeyId(keyId)}\n` +
    publicKeyBlob.toString("base64");

  const signedData = prehashed
    ? crypto.createHash("blake2b512").update(data).digest()
    : data;
  const signature = crypto.sign(null, signedData, privateKey);
  const globalSignature = crypto.sign(
    null,
    Buffer.concat([signature, Buffer.from(trustedComment, "utf8")]),
    privateKey
  );
  const signatureBlob = Buffer.concat([
    Buffer.from(algorithm, "latin1"),
    keyId,
    signature,
  ]);
  const signatureText =
    "untrusted comment: signature from minisign secret key\n" +
    `${signatureBlob.toString("base64")}\n` +
    `trusted comment: ${trustedComment}\n` +
    globalSignature.toString("base64");

  return {
    data,
    privateKey,
    keyId,
    publicKeyText,
    signatureText,
    // Tauri writes base64 of the whole minisign file; the tests cover both.
    wrappedPublicKey: Buffer.from(publicKeyText, "utf8").toString("base64"),
    wrappedSignature: Buffer.from(signatureText, "utf8").toString("base64"),
  };
};

describe("formatKeyId", () => {
  test("displays the minisign key ID in reversed byte order", () => {
    assert.equal(formatKeyId(KEY_ID), "96C5E41CD0651543");
  });
});

describe("parsePublicKey", () => {
  test("decodes a raw minisign public key", () => {
    const fixture = makeFixture();
    const parsed = parsePublicKey(fixture.publicKeyText);

    assert.equal(parsed.displayKeyId, "96C5E41CD0651543");
    assert.equal(parsed.key.length, 32);
    assert.equal(parsed.keyId.length, 8);
  });

  test("decodes the base64-wrapped form stored in tauri.conf.json", () => {
    const fixture = makeFixture();
    const parsed = parsePublicKey(fixture.wrappedPublicKey);

    assert.equal(parsed.displayKeyId, "96C5E41CD0651543");
  });

  test("rejects text that is not minisign text at all", () => {
    assert.throws(
      () => parsePublicKey(Buffer.from("not a key").toString("base64")),
      /not minisign text/
    );
  });

  test("rejects a minisign public key with the wrong blob length", () => {
    assert.throws(
      () => parsePublicKey("untrusted comment: truncated\nAAAA"),
      /42-byte blob/
    );
  });
});

describe("parseSignature", () => {
  test("decodes PEs and legacy signatures", () => {
    const prehashed = parseSignature(
      makeFixture({ prehashed: true }).signatureText
    );
    const legacy = parseSignature(
      makeFixture({ prehashed: false }).signatureText
    );

    assert.equal(prehashed.isPrehashed, true);
    assert.equal(legacy.isPrehashed, false);
    assert.equal(prehashed.signature.length, 64);
    assert.equal(prehashed.globalSignature.length, 64);
    assert.equal(prehashed.trustedComment, TRUSTED_COMMENT);
  });

  test("decodes the base64-wrapped .sig form the updater reads", () => {
    const fixture = makeFixture();
    const parsed = parseSignature(fixture.wrappedSignature);

    assert.equal(parsed.trustedComment, TRUSTED_COMMENT);
  });
});

describe("verifyUpdaterSignature", () => {
  test("accepts a prehashed signature from the configured key", () => {
    const fixture = makeFixture();
    const result = verifyUpdaterSignature({
      file: fixture.data,
      publicKey: parsePublicKey(fixture.publicKeyText),
      signature: parseSignature(fixture.signatureText),
      expectedKeyId: "96C5E41CD0651543",
    });

    assert.equal(result.signature_ok, true);
    assert.equal(result.global_signature_ok, true);
    assert.equal(result.key_id_ok, true);
    assert.equal(result.ok, true);
  });

  test("accepts a legacy raw signature when allow_legacy is in effect", () => {
    const fixture = makeFixture({ prehashed: false });
    const result = verifyUpdaterSignature({
      file: fixture.data,
      publicKey: parsePublicKey(fixture.publicKeyText),
      signature: parseSignature(fixture.signatureText),
    });

    assert.equal(result.algorithm, "legacy-raw");
    assert.equal(result.ok, true);
  });

  test("rejects a modified file", () => {
    const fixture = makeFixture();
    const result = verifyUpdaterSignature({
      file: Buffer.from("tampered payload"),
      publicKey: parsePublicKey(fixture.publicKeyText),
      signature: parseSignature(fixture.signatureText),
    });

    assert.equal(result.signature_ok, false);
    assert.equal(result.ok, false);
  });

  test("rejects a signature made by another key with the same key ID", () => {
    const fixture = makeFixture();
    const other = makeFixture();
    const result = verifyUpdaterSignature({
      file: fixture.data,
      publicKey: parsePublicKey(other.publicKeyText),
      signature: parseSignature(fixture.signatureText),
    });

    // Same display ID, different key material: the ID check alone is not enough.
    assert.equal(result.key_id_matches, true);
    assert.equal(result.signature_ok, false);
    assert.equal(result.global_signature_ok, false);
    assert.equal(result.ok, false);
  });

  test("rejects a signature that belongs to a different key ID", () => {
    const fixture = makeFixture();
    const other = makeFixture({
      keyId: Buffer.from("0011223344556677", "hex"),
    });
    const result = verifyUpdaterSignature({
      file: fixture.data,
      publicKey: parsePublicKey(other.publicKeyText),
      signature: parseSignature(fixture.signatureText),
    });

    assert.equal(result.key_id_matches, false);
    assert.equal(result.ok, false);
  });

  test("rejects a key ID that is not the expected one", () => {
    const fixture = makeFixture();
    const result = verifyUpdaterSignature({
      file: fixture.data,
      publicKey: parsePublicKey(fixture.publicKeyText),
      signature: parseSignature(fixture.signatureText),
      expectedKeyId: "0000000000000000",
    });

    assert.equal(result.key_id_ok, false);
    assert.equal(result.ok, false);
  });

  test("rejects a tampered trusted comment", () => {
    const fixture = makeFixture();
    const parsed = parseSignature(fixture.signatureText);
    const result = verifyUpdaterSignature({
      file: fixture.data,
      publicKey: parsePublicKey(fixture.publicKeyText),
      signature: { ...parsed, trustedComment: "timestamp:0 file:other.exe" },
    });

    assert.equal(result.global_signature_ok, false);
    assert.equal(result.ok, false);
  });
});

describe("verifyManifest", () => {
  const fixture = makeFixture();
  const basename = "sphinx-launcher_0.1.0_x64-setup.exe";
  const manifest = {
    version: "0.1.0",
    platforms: {
      [PLATFORM]: {
        signature: fixture.wrappedSignature,
        url: `https://github.com/Raka-Mahendra/sphinx/releases/download/v0.1.0/${basename}`,
      },
    },
  };

  test("accepts a manifest that matches the installer and signature", () => {
    const result = verifyManifest({
      manifest,
      fileBasename: basename,
      signatureText: `${fixture.wrappedSignature}\n`,
      expectedVersion: "0.1.0",
    });

    assert.equal(result.ok, true);
  });

  test("rejects a manifest whose signature differs from the .sig file", () => {
    const result = verifyManifest({
      manifest: {
        ...manifest,
        platforms: {
          [PLATFORM]: {
            ...manifest.platforms[PLATFORM],
            signature: "different",
          },
        },
      },
      fileBasename: basename,
      signatureText: fixture.wrappedSignature,
      expectedVersion: "0.1.0",
    });

    assert.equal(result.signature_matches_file, false);
    assert.equal(result.ok, false);
  });

  test("rejects a manifest whose URL names another file", () => {
    const result = verifyManifest({
      manifest: {
        ...manifest,
        platforms: {
          [PLATFORM]: {
            ...manifest.platforms[PLATFORM],
            url: "https://example.invalid/other-setup.exe",
          },
        },
      },
      fileBasename: basename,
      signatureText: fixture.wrappedSignature,
    });

    assert.equal(result.url_basename_matches, false);
    assert.equal(result.ok, false);
  });

  test("rejects a version mismatch", () => {
    const result = verifyManifest({
      manifest,
      fileBasename: basename,
      signatureText: fixture.wrappedSignature,
      expectedVersion: "0.2.0",
    });

    assert.equal(result.version_ok, false);
    assert.equal(result.ok, false);
  });
});
