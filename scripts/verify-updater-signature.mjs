/**
 * Verifies a Tauri updater signature against the public key this application
 * trusts, without needing the private key and without publishing anything.
 *
 * The Tauri CLI has no `signer verify` subcommand, so this script mirrors what
 * `tauri-plugin-updater` does at runtime:
 *
 * <https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs>
 *
 * 1. `base64_to_string` the signature (the `.sig` file and `latest.json`'s
 *    `signature` field are base64 of the four-line minisign file);
 * 2. decode the public key and the signature with `minisign_verify`;
 * 3. check the key IDs match;
 * 4. verify Ed25519 over the BLAKE2b-512 prehash (`ED`) or, for legacy
 *    signatures, over the file itself (`Ed`) — Tauri calls
 *    `verify(data, signature, allow_legacy = true)`;
 * 5. verify the global signature over `signature || trusted_comment`, which is
 *    what makes the trusted comment trustworthy.
 *
 * Node's `crypto.verify(null, data, key, signature)` performs Ed25519. The raw
 * 32-byte key from the minisign blob is wrapped in a fixed SPKI header.
 *
 * Usage:
 *   node scripts/verify-updater-signature.mjs \
 *     --file path/to/sphinx-launcher_0.1.0_x64-setup.exe \
 *     --signature path/to/sphinx-launcher_0.1.0_x64-setup.exe.sig \
 *     --config src-tauri/tauri.conf.json \
 *     --expect-key-id 96C5E41CD0651543 \
 *     [--manifest path/to/latest.json] \
 *     [--expect-version 0.1.0] \
 *     [--json-out path/to/verification.json]
 *
 * Exit codes: 0 verified, 1 failed verification, 2 usage/parse error.
 *
 * Nothing here reads `TAURI_SIGNING_PRIVATE_KEY`; the public key and signature
 * are not secrets, but this script never prints key material either.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** `302a300506032b6570032100` is the DER prefix for an Ed25519 SPKI key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const TRUSTED_COMMENT_PREFIX = "trusted comment: ";
const PLATFORM = "windows-x86_64";

/**
 * minisign prints key IDs in reverse byte order, e.g. the bytes
 * `43 15 65 D0 1C E4 C5 96` display as `96C5E41CD0651543`.
 *
 * @param {Uint8Array} keyId
 * @returns {string}
 */
export const formatKeyId = (keyId) =>
  Buffer.from(keyId).reverse().toString("hex").toUpperCase();

/**
 * Accepts either the minisign text itself or the base64-wrapped form Tauri
 * writes (`.sig` files and the config's `pubkey` are both base64 of the text).
 *
 * @param {string} input
 * @param {string} label
 * @returns {string}
 */
const decodeMinisignText = (input, label) => {
  const trimmed = input.trim();

  if (trimmed.startsWith("untrusted comment:")) {
    return trimmed;
  }

  const decoded = Buffer.from(trimmed, "base64").toString("utf8");

  if (decoded.startsWith("untrusted comment:")) {
    return decoded.trim();
  }

  throw new Error(
    `${label}: not minisign text nor base64-wrapped minisign text`
  );
};

/**
 * @param {string} input minisign public key text, or its base64-wrapped form
 * @returns {{ keyId: Buffer, key: Buffer, displayKeyId: string, comment: string }}
 */
export const parsePublicKey = (input) => {
  const text = decodeMinisignText(input, "public key");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blob = Buffer.from(lines.at(-1) ?? "", "base64");

  if (blob.length !== 42) {
    throw new Error(`public key: expected a 42-byte blob, got ${blob.length}`);
  }

  const algorithm = blob.subarray(0, 2).toString("latin1");

  if (algorithm !== "Ed" && algorithm !== "ED") {
    throw new Error(
      `public key: unsupported algorithm ${JSON.stringify(algorithm)}`
    );
  }

  const keyId = blob.subarray(2, 10);
  const key = blob.subarray(10, 42);

  return {
    keyId,
    key,
    displayKeyId: formatKeyId(keyId),
    comment: lines[0] ?? "",
  };
};

/**
 * @param {string} input minisign signature text, or its base64-wrapped form
 * @returns {{
 *   isPrehashed: boolean,
 *   keyId: Buffer,
 *   signature: Buffer,
 *   trustedComment: string,
 *   globalSignature: Buffer,
 * }}
 */
export const parseSignature = (input) => {
  const text = decodeMinisignText(input, "signature");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const blob = Buffer.from((lines[1] ?? "").trim(), "base64");

  if (blob.length !== 74) {
    throw new Error(`signature: expected a 74-byte blob, got ${blob.length}`);
  }

  const trustedLine = lines.find((line) =>
    line.startsWith(TRUSTED_COMMENT_PREFIX)
  );

  if (!trustedLine) {
    throw new Error("signature: missing trusted comment");
  }

  const globalSignature = Buffer.from((lines.at(-1) ?? "").trim(), "base64");

  if (globalSignature.length !== 64) {
    throw new Error(
      `signature: expected a 64-byte global signature, got ${globalSignature.length}`
    );
  }

  const algorithm = blob.subarray(0, 2).toString("latin1");

  if (algorithm !== "Ed" && algorithm !== "ED") {
    throw new Error(
      `signature: unsupported algorithm ${JSON.stringify(algorithm)}`
    );
  }

  return {
    isPrehashed: algorithm === "ED",
    keyId: blob.subarray(2, 10),
    signature: blob.subarray(10, 74),
    trustedComment: trustedLine.slice(TRUSTED_COMMENT_PREFIX.length),
    globalSignature,
  };
};

/**
 * Extracts the configured public key from `src-tauri/tauri.conf.json`.
 *
 * @param {string} configPath
 * @returns {string}
 */
export const readPublicKeyFromConfig = (configPath) => {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const pubkey = config?.plugins?.updater?.pubkey;

  if (typeof pubkey !== "string" || pubkey.length === 0) {
    throw new Error(`${configPath}: plugins.updater.pubkey is missing`);
  }

  return pubkey;
};

/**
 * Pure verification. `file` is the installer bytes; no filesystem access.
 *
 * @param {object} input
 * @param {Buffer} input.file
 * @param {ReturnType<typeof parsePublicKey>} input.publicKey
 * @param {ReturnType<typeof parseSignature>} input.signature
 * @param {string} [input.expectedKeyId]
 * @returns {object}
 */
export const verifyUpdaterSignature = ({
  file,
  publicKey,
  signature,
  expectedKeyId,
}) => {
  const keyIdMatches = publicKey.keyId.equals(signature.keyId);
  const signedData = signature.isPrehashed
    ? crypto.createHash("blake2b512").update(file).digest()
    : file;
  const ed25519Key = crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.key]),
    format: "der",
    type: "spki",
  });

  // A mismatched key ID means the signature belongs to another key; Tauri
  // rejects it before doing any cryptography, so mirror that.
  const signatureOk =
    keyIdMatches &&
    crypto.verify(null, signedData, ed25519Key, signature.signature);
  const globalData = Buffer.concat([
    signature.signature,
    Buffer.from(signature.trustedComment, "utf8"),
  ]);
  const globalSignatureOk =
    keyIdMatches &&
    crypto.verify(null, globalData, ed25519Key, signature.globalSignature);

  const displayKeyId = formatKeyId(publicKey.keyId);
  const keyIdOk =
    expectedKeyId === undefined ||
    displayKeyId === expectedKeyId.replace(/^0x/i, "").toUpperCase();

  return {
    key_id: displayKeyId,
    signature_key_id: formatKeyId(signature.keyId),
    key_id_matches: keyIdMatches,
    expected_key_id: expectedKeyId ?? null,
    key_id_ok: keyIdOk,
    algorithm: signature.isPrehashed ? "blake2b512-prehashed" : "legacy-raw",
    signature_ok: signatureOk,
    global_signature_ok: globalSignatureOk,
    trusted_comment: signature.trustedComment,
    ok: signatureOk && globalSignatureOk && keyIdMatches && keyIdOk,
  };
};

/**
 * Checks the generated `latest.json` against the installer and `.sig` it
 * describes. Nothing is published here; this only proves the manifest pipeline
 * is internally consistent.
 *
 * @param {object} input
 * @param {object} input.manifest parsed `latest.json`
 * @param {string} input.fileBasename
 * @param {string} input.signatureText verbatim `.sig` content
 * @param {string} [input.expectedVersion]
 * @returns {object}
 */
export const verifyManifest = ({
  manifest,
  fileBasename,
  signatureText,
  expectedVersion,
}) => {
  const platform = manifest?.platforms?.[PLATFORM] ?? null;
  const url = platform?.url ?? "";
  const urlBasename = url.split("/").at(-1) ?? "";
  const versionOk =
    expectedVersion === undefined || manifest?.version === expectedVersion;

  return {
    platform: PLATFORM,
    version: manifest?.version ?? null,
    expected_version: expectedVersion ?? null,
    version_ok: versionOk,
    url: url || null,
    url_basename_matches: urlBasename === fileBasename,
    signature_matches_file:
      typeof platform?.signature === "string" &&
      platform.signature === signatureText.trim(),
    ok: Boolean(
      platform &&
        versionOk &&
        urlBasename === fileBasename &&
        platform.signature === signatureText.trim()
    ),
  };
};

const parseArgs = (argv) => {
  const options = {};
  const flags = new Set([
    "--file",
    "--signature",
    "--config",
    "--pubkey-file",
    "--expect-key-id",
    "--expect-version",
    "--manifest",
    "--json-out",
  ]);

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!flags.has(key) || value === undefined) {
      throw new Error(`usage error near ${JSON.stringify(argv[index])}`);
    }

    options[key.slice(2)] = value;
  }

  return options;
};

const run = () => {
  const options = parseArgs(process.argv.slice(2));
  const { file: filePath, signature: signaturePath } = options;

  if (!filePath || !signaturePath) {
    throw new Error("missing --file or --signature");
  }

  const configPath =
    options.config ?? path.join("src-tauri", "tauri.conf.json");
  const publicKeyText = options["pubkey-file"]
    ? fs.readFileSync(options["pubkey-file"], "utf8")
    : readPublicKeyFromConfig(configPath);
  const signatureText = fs.readFileSync(signaturePath, "utf8");
  const file = fs.readFileSync(filePath);
  const publicKey = parsePublicKey(publicKeyText);
  const signature = parseSignature(signatureText);
  const verification = verifyUpdaterSignature({
    file,
    publicKey,
    signature,
    expectedKeyId: options["expect-key-id"],
  });
  const result = {
    file: path.basename(filePath),
    file_bytes: file.length,
    file_sha256: crypto.createHash("sha256").update(file).digest("hex"),
    ...verification,
    manifest: null,
  };

  if (options.manifest) {
    const manifestText = fs.readFileSync(options.manifest, "utf8");
    result.manifest = {
      file: path.basename(options.manifest),
      ...verifyManifest({
        manifest: JSON.parse(manifestText),
        fileBasename: path.basename(filePath),
        signatureText,
        expectedVersion: options["expect-version"],
      }),
    };
    result.ok = result.ok && result.manifest.ok;
  }

  const json = `${JSON.stringify(result, null, 2)}\n`;

  if (options["json-out"]) {
    fs.writeFileSync(options["json-out"], json, "utf8");
  }

  process.stdout.write(json);
  process.exitCode = result.ok ? 0 : 1;
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    run();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
