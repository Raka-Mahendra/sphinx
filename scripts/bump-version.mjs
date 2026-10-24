/**
 * Aligns the three version sources with a tag.
 *
 * `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` each
 * carry a version, and the updater's `latest.json` is generated from the same
 * number, so a mismatch is not cosmetic: the built installer would report one
 * version, the bundle metadata another, and `bump-version` exists so there is
 * exactly one source of truth — the git tag.
 *
 * Usage:
 *   node scripts/bump-version.mjs 0.2.0      # from a tag, with the `v` stripped
 *   node scripts/bump-version.mjs v0.2.0     # same
 *   node scripts/bump-version.mjs --check v0.2.0
 *
 * `--check` writes nothing and exits 1 on a mismatch, which is what CI runs:
 * every tag build fails early if any of the three files disagrees with the tag.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
  { label: "package.json", path: path.join(ROOT, "package.json"), kind: "json" },
  {
    label: "src-tauri/Cargo.toml",
    path: path.join(ROOT, "src-tauri", "Cargo.toml"),
    kind: "toml",
  },
  {
    label: "src-tauri/tauri.conf.json",
    path: path.join(ROOT, "src-tauri", "tauri.conf.json"),
    kind: "json",
  },
];

/** Reads the version out of one of the three files. */
const readVersion = (file) => {
  const raw = fs.readFileSync(file.path, "utf8");

  if (file.kind === "json") {
    const parsed = JSON.parse(raw);
    return parsed.version;
  }

  const match = raw.match(/^version = "([^"]+)"/m);
  return match ? match[1] : undefined;
};

/** Writes a version back, leaving every other byte alone. */
const writeVersion = (file, version) => {
  const raw = fs.readFileSync(file.path, "utf8");

  if (file.kind === "json") {
    const parsed = JSON.parse(raw);
    parsed.version = version;
    fs.writeFileSync(
      file.path,
      `${JSON.stringify(parsed, null, 2)}\n`,
      "utf8"
    );
    return;
  }

  // Only the `[package]` version, and only the first occurrence: Cargo.toml has
  // other `version = "…"` lines inside dependency tables.
  const replaced = raw.replace(
    /^version = "[^"]*"/m,
    `version = "${version}"`
  );
  fs.writeFileSync(file.path, replaced, "utf8");
};

/**
 * Normalises a tag to a plain version.
 *
 * Tauri's updater accepts SemVer with or without a leading `v`, but the app
 * metadata is compared against `latest.json`'s `version` field, and the three
 * files store it without the `v`. Pre-release suffixes (`-beta.1`) are kept:
 * Tauri accepts them, but MSI/WiX does not — see docs/release.md.
 */
export const normalizeVersion = (tag) => {
  const bare = tag.replace(/^v/, "");

  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(bare)) {
    throw new Error(
      `"${tag}" is not a plain X.Y.Z version (got "${bare}"). Pre-release suffixes are not supported for release builds.`
    );
  }

  return bare;
};

const main = () => {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const tag = args.find((argument) => !argument.startsWith("--"));

  if (!tag) {
    process.stderr.write(
      "usage: node scripts/bump-version.mjs [--check] <version|tag>\n"
    );
    process.exit(2);
  }

  let version;
  try {
    version = normalizeVersion(tag);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(2);
  }

  const current = FILES.map((file) => ({
    ...file,
    version: readVersion(file),
  }));

  const drifted = current.filter((file) => file.version !== version);

  if (checkOnly) {
    if (drifted.length > 0) {
      process.stderr.write(
        `version drift: expected ${version} in every source\n${drifted
          .map((file) => `  ${file.label}: ${file.version ?? "missing"}`)
          .join("\n")}\n`
      );
      process.exit(1);
    }

    process.stdout.write(`all version sources are ${version}\n`);
    return;
  }

  for (const file of drifted) {
    writeVersion(file, version);
    process.stdout.write(
      `${file.label}: ${file.version ?? "missing"} -> ${version}\n`
    );
  }

  if (drifted.length === 0) {
    process.stdout.write(`already at ${version}\n`);
  }
};

main();
