#!/usr/bin/env node
/**
 * Copies the sidecar's runtime dependencies next to its bundle.
 *
 * `build-sidecar.mjs` keeps every production dependency external on purpose
 * (native binaries, optional requires), and its own header says the sidecar
 * "ships with `node_modules` next to it". Nothing did that step: `tauri dev`
 * resolves the packages from the repository root, so the gap only appeared in
 * an installed build, where the sidecar died with
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'classic-level'`.
 *
 * This walks the imports of the built bundle, resolves each package through the
 * real `node_modules`, and copies the package plus its own dependency closure
 * into `out/sidecar/node_modules`. Nested `node_modules` inside a package are
 * copied as they are, so a package with a pinned different version keeps it.
 *
 * `hydra-native` is skipped: it is not a Node package here. The addon is loaded
 * from `resources/hydra-native/hydra-native.node` by `native-addon-path.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "out", "sidecar", "index.mjs");
const TARGET = path.join(ROOT, "out", "sidecar", "node_modules");
const SKIP_PACKAGES = new Set(["hydra-native"]);
const BUILTINS = new Set(builtinModules);

if (!fs.existsSync(BUNDLE)) {
  process.stderr.write(
    `sidecar deps: ${path.relative(ROOT, BUNDLE)} is missing, run yarn build:sidecar first\n`
  );
  process.exit(1);
}

const source = fs.readFileSync(BUNDLE, "utf8");

/** Bare specifiers the bundle can reach: static imports, dynamic import(), require(). */
const findSpecifiers = () => {
  const found = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.add(match[1]);
    }
  }

  // The bundle carries library source as strings, so the patterns also match
  // text such as `require(fn)` or an HTML fragment. Keep only names that could
  // be a package.
  const packageShape = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(\/[^"'`\s]+)?$/i;

  return [...found].filter((specifier) => {
    if (!specifier || !packageShape.test(specifier)) return false;
    if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
    if (specifier.startsWith("node:")) return false;
    if (BUILTINS.has(specifier)) return false;
    // Resolved by the build aliases, not by node_modules.
    if (/^@(main|sidecar|shared|types|locales|resources)\//.test(specifier)) {
      return false;
    }
    return true;
  });
};

/** `@scope/pkg/sub/path` -> `@scope/pkg`, `pkg/sub` -> `pkg`. */
const packageNameOf = (specifier) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

/**
 * Finds a package directory the way Node does: `<dir>/node_modules/<name>` for
 * every ancestor of `fromDir`. `require.resolve` is not used because packages
 * such as `parse-torrent` are ESM-only (`exports: { import }`), which a CJS
 * resolve refuses, and because `exports` can hide `package.json`.
 */
const resolvePackage = (name, fromDir) => {
  const segments = name.split("/");
  let dir = fromDir;

  while (true) {
    const candidate = path.join(dir, "node_modules", ...segments);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const readManifest = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return {};
  }
};

/** real path of a copied package -> where it was written */
const copied = new Map();

const copyPackage = (name, fromDir, options = {}) => {
  const { optional = false, parentDestination = null } = options;
  const dir = resolvePackage(name, fromDir);

  if (!dir) {
    // Optional dependencies are platform specific on purpose: `sharp` lists a
    // binary for every OS and arch, and only one of them exists on this machine.
    if (!optional) {
      process.stderr.write(
        `sidecar deps: cannot resolve ${name} from ${fromDir}\n`
      );
      process.exitCode = 1;
    }
    return;
  }

  const real = fs.realpathSync(dir);
  if (copied.has(real)) return;

  // Hoist to the top when the name is free. A nested version of a package that
  // is already hoisted goes under its parent so both stay resolvable.
  let destination = path.join(TARGET, name);
  if (fs.existsSync(destination) && !copied.has(real)) {
    destination = path.join(parentDestination ?? TARGET, "node_modules", name);
  }

  copied.set(real, destination);

  fs.cpSync(dir, destination, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const base = path.basename(source);
      if (base === ".bin" || base === ".github") return false;
      if (base.endsWith(".map") || base.endsWith(".md")) return false;
      return true;
    },
  });

  const manifest = readManifest(dir);

  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (SKIP_PACKAGES.has(dependency)) continue;
    copyPackage(dependency, dir, { parentDestination: destination });
  }

  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    if (SKIP_PACKAGES.has(dependency)) continue;
    copyPackage(dependency, dir, { optional: true, parentDestination: destination });
  }
};

fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

const specifiers = findSpecifiers();
const rootPackages = new Set(
  specifiers.map(packageNameOf).filter((name) => !SKIP_PACKAGES.has(name))
);

for (const name of rootPackages) {
  copyPackage(name, ROOT);
}

const topLevel = fs
  .readdirSync(TARGET, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;

const totalBytes = (dir) => {
  let sum = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    sum += entry.isDirectory() ? totalBytes(full) : fs.statSync(full).size;
  }
  return sum;
};

process.stdout.write(
  `sidecar deps: ${topLevel} packages, ${(totalBytes(TARGET) / 1024 / 1024).toFixed(1)} MB -> ${path.relative(ROOT, TARGET)}\n`
);

for (const required of ["classic-level", "sharp"]) {
  if (!fs.existsSync(path.join(TARGET, required))) {
    process.stderr.write(`sidecar deps: ${required} is missing from the staged tree\n`);
    process.exitCode = 1;
  }
}