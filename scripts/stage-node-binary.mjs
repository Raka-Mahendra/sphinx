/**
 * Stages the Node.js binary Tauri ships as an `externalBin`.
 *
 * `src-tauri/tauri.conf.json` declares `bundle.externalBin: ["binaries/node"]`,
 * and Tauri appends the Rust host triple to that path. The binary is ~80 MB, so
 * it is not committed; this script copies the Node that is running it into place
 * under the name the bundler expects.
 *
 * Usage:
 *   node scripts/stage-node-binary.mjs           # copy process.execPath
 *   node scripts/stage-node-binary.mjs --print   # only print the target path
 *
 * The sidecar bundle (`out/sidecar/index.mjs`) is not staged here: it is produced
 * by `scripts/build-sidecar.mjs` and copied by `beforeBuildCommand`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "src-tauri", "binaries");

/**
 * Host triple, asked from rustc rather than guessed.
 *
 * Tauri names external binaries `<name>-<triple><ext>` using the triple it is
 * building for, which is the host triple unless `--target` is passed.
 */
const hostTriple = () => {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const line = out.split("\n").find((entry) => entry.startsWith("host: "));
    if (line) return line.slice("host: ".length).trim();
  } catch {
    // rustc is not on PATH; fall through to the platform default.
  }

  return process.platform === "win32"
    ? `x86_64-pc-windows-${process.arch === "arm64" ? "msvc" : "msvc"}`
    : process.platform === "darwin"
      ? `aarch64-apple-darwin`
      : "x86_64-unknown-linux-gnu";
};

const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple();
const extension = process.platform === "win32" ? ".exe" : "";
const target = path.join(OUT_DIR, `node-${triple}${extension}`);

if (process.argv.includes("--print")) {
  process.stdout.write(`${target}\n`);
  process.exit(0);
}

if (!fs.existsSync(target)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(process.execPath, target);
  fs.chmodSync(target, 0o755);
  process.stdout.write(
    `staged ${path.relative(ROOT, target)} from ${process.execPath}\n`
  );
} else {
  process.stdout.write(`already staged: ${path.relative(ROOT, target)}\n`);
}
