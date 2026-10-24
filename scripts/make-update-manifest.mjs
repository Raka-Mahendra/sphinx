/**
 * Builds the `latest.json` the updater reads, and `SHA256SUMS`.
 *
 * `tauri-action` can generate `latest.json` itself, but only when it uploads to
 * a release. This project releases in two steps (build everything, then publish
 * one draft), so the manifest is produced by a script that can be read and
 * reviewed instead of by an action internals.
 *
 * What the updater validates, from
 * <https://v2.tauri.app/plugin/updater/>:
 *
 * - `version` is compared against the running app's version;
 * - `platforms` is keyed `<os>-<arch>`;
 * - `signature` must be **the content** of the `.sig` file — "A path or URL does
 *   not work!";
 * - Tauri validates the whole JSON file before it looks at `version`, so a
 *   platform entry must be complete or the file is rejected outright.
 *
 * Usage:
 *   node scripts/make-update-manifest.mjs \
 *     --tag v0.1.0 \
 *     --bundle sphinx-launcher-0.1.0-setup.exe \
 *     --sig ./sphinx-launcher-0.1.0-setup.exe.sig \
 *     --out latest.json \
 *     --sha256-out SHA256SUMS
 *
 * The pure parts (`buildManifest`, `sha256File`) are exported so
 * `scripts/make-update-manifest.test.mjs` can exercise them without touching
 * the filesystem or the network.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO = "Raka-Mahendra/sphinx";
const RELEASE_BASE = `https://github.com/${REPO}/releases/download`;

/** Only Windows ships for now; Linux follows in Fase 9. */
export const PLATFORM = "windows-x86_64";

/**
 * Builds the manifest object. Pure: no filesystem, no clock side effects beyond
 * `pub_date` (override with `pubDate` in tests for deterministic output).
 *
 * @param {object} input
 * @param {string} input.tag          Release tag, e.g. `v0.1.0`.
 * @param {string} input.signature     Verbatim contents of the `.sig` file.
 * @param {string} input.bundleBasename File name only of the installer, as it
 *                                      appears under the release tag.
 * @param {string|null} [input.notes]  Release notes; `null` is valid JSON.
 * @param {string} [input.pubDate]     ISO timestamp; defaults to now.
 * @returns {object} The manifest object the updater consumes.
 */
export const buildManifest = ({ tag, signature, bundleBasename, notes = null, pubDate }) => {
  const version = tag.replace(/^v/, "");

  return {
    version,
    // `null` is valid JSON for "no notes".
    notes,
    pub_date: pubDate ?? new Date().toISOString(),
    platforms: {
      [PLATFORM]: {
        signature,
        url: `${RELEASE_BASE}/${tag}/${bundleBasename}`,
      },
    },
  };
};

/** SHA-256 of a file, as a hex string. */
export const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("close", () => resolve(hash.digest("hex")));
  });

const parseArgs = (argv) => {
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    const value = argv[index + 1];

    if (!key || value === undefined) {
      process.stderr.write(`usage error near ${argv[index]}\n`);
      process.exit(2);
    }

    options[key] = value;
  }

  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const { tag, bundle, sig, out } = options;
  const sha256Out = options["sha256-out"];

  for (const [name, value] of Object.entries({ tag, bundle, sig })) {
    if (!value) {
      process.stderr.write(`missing --${name}\n`);
      process.exit(2);
    }
  }

  const signature = fs.readFileSync(sig, "utf8").trim();
  const manifest = buildManifest({
    tag,
    signature,
    bundleBasename: path.basename(bundle),
  });

  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    process.stdout.write(`wrote ${out} (${PLATFORM} ${manifest.version})\n`);
  } else {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  }

  if (sha256Out) {
    const digest = await sha256File(bundle);
    const lines = [`${digest}  ${path.basename(bundle)}`];

    if (out && fs.existsSync(out)) {
      const manifestDigest = await sha256File(out);
      lines.push(`${manifestDigest}  ${path.basename(out)}`);
    }

    fs.writeFileSync(sha256Out, `${lines.join("\n")}\n`, "utf8");
    process.stdout.write(`wrote ${sha256Out}\n`);
  }
};

// Run only when executed as a script, never when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
