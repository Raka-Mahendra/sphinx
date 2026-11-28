#!/usr/bin/env node
/**
 * Creates the empty bundle inputs that `tauri-build` validates while compiling.
 *
 * `src-tauri/tauri.conf.json` points `bundle.resources` at artefacts that only
 * exist after a full build (`out/sidecar`, `hydra-native`, `ludusavi`) and
 * `bundle.frontendDist` at `out/renderer`. `tauri-build` refuses to generate the
 * app manifest when any of them is missing, so a clean checkout cannot even run
 * `cargo clippy`.
 *
 * This is for the lint/typecheck CI job only. The release workflow builds the
 * real sidecar, native addon, ludusavi download and renderer before it packages
 * anything, so nothing here ever reaches a shipped bundle.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLACEHOLDER_RENDERER = "<!doctype html><title>sphinx ci</title>\n";

const ensureDirectory = (relative) => {
  fs.mkdirSync(path.join(ROOT, relative), { recursive: true });
};

const ensureFile = (relative, contents = "") => {
  const target = path.join(ROOT, relative);

  if (fs.existsSync(target)) return;

  fs.writeFileSync(target, contents);
};

ensureDirectory("out/sidecar");
ensureDirectory("out/renderer");
ensureDirectory("hydra-native");
ensureFile("ludusavi");
ensureFile("out/renderer/index.html", PLACEHOLDER_RENDERER);

process.stdout.write("staged the placeholder bundle inputs\n");
