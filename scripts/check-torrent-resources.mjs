#!/usr/bin/env node
/**
 * Verifies that the torrent engine is packageable before an installer is built.
 *
 * `hydra-native/` is a build artifact (`/hydra-native/` is in `.gitignore`), so
 * nothing stops a release from being assembled without it. That build would
 * install, open, and silently never download anything: `native-addon.ts` logs
 * `Sphinx native addon not found`, `loadState` degrades, and the torrent button
 * fails at click time. This script turns that into a build failure.
 *
 * Checks, in order:
 *
 * 1. `hydra-native.node` and the prebuilt libtorrent bridge are both present.
 * 2. Every non-system DLL the addon and the bridge import is either bundled in
 *    the same directory or ships with Windows. The Visual C++ runtime is the
 *    case that matters: it is a *build machine* dependency, so a build that
 *    relies on files from `C:\Windows\System32` works here and fails on a clean
 *    machine. Bundling is therefore required, which is exactly what
 *    `scripts/build-native-addon.cjs` does with the vswhere redist directory.
 * 3. `src-tauri/tauri.conf.json` still copies the folder to `hydra-native/` in
 *    the resources, which is where `src-tauri/src/sidecar/config.rs` points
 *    `SPHINX_HYDRA_NATIVE_DIR`.
 *
 * Usage:
 *   node scripts/check-torrent-resources.mjs            # package build: fail
 *   node scripts/check-torrent-resources.mjs --allow-missing   # dev: warn only
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOW_MISSING = process.argv.includes("--allow-missing");

const BRIDGE_BY_PLATFORM = {
  win32: "hydra_torrent_bridge.dll",
  linux: "libhydra_torrent_bridge.so",
  darwin: "libhydra_torrent_bridge.dylib",
};

/**
 * DLLs that Windows itself provides (API set contracts and the system CRT).
 * A clean machine without the Visual C++ redistributable has these.
 */
const WINDOWS_SYSTEM_DLLS = new Set([
  "advapi32.dll",
  "bcrypt.dll",
  "cfgmgr32.dll",
  "combase.dll",
  "crypt32.dll",
  "dbghelp.dll",
  "dnsapi.dll",
  "dwmapi.dll",
  "gdi32.dll",
  "imagehlp.dll",
  "iphlpapi.dll",
  "kernel32.dll",
  "mfplat.dll",
  "mswsock.dll",
  "msvcrt.dll",
  "ncrypt.dll",
  "netapi32.dll",
  "normaliz.dll",
  "ntdll.dll",
  "ole32.dll",
  "oleacc.dll",
  "oleaut32.dll",
  "powrprof.dll",
  "psapi.dll",
  "rpcrt4.dll",
  "sechost.dll",
  "secur32.dll",
  "setupapi.dll",
  "shell32.dll",
  "shlwapi.dll",
  "ucrtbase.dll",
  "user32.dll",
  "userenv.dll",
  "version.dll",
  "winhttp.dll",
  "wininet.dll",
  "winmm.dll",
  "wldap32.dll",
  "ws2_32.dll",
  "wsock32.dll",
  "wtsapi32.dll",
]);

/** The runtime the Visual C++ redistributable installs; must be bundled. */
const VC_RUNTIME_DLL =
  /^(?:vcruntime\d+(?:_\d+)?|msvcp\d+(?:_\d+)?|concrt\d+|vcomp\d+|vccorlib\d+)\.dll$/i;

const isSystemDll = (name) =>
  WINDOWS_SYSTEM_DLLS.has(name) ||
  name.startsWith("api-ms-win-") ||
  name.startsWith("ext-ms-");

/**
 * Reads the import table of a PE file, without a dependency.
 *
 * Returns `null` when the file is not a PE image (a `.node` that is actually an
 * ELF/Mach-O file on the wrong platform), which the caller reports instead of
 * pretending the imports were verified.
 */
const readPeImports = (file) => {
  const buffer = fs.readFileSync(file);

  if (buffer.length < 0x40 || buffer.toString("ascii", 0, 2) !== "MZ") {
    return null;
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length) return null;
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0")
    return null;

  const coff = peOffset + 4;
  const numberOfSections = buffer.readUInt16LE(coff + 2);
  const sizeOfOptionalHeader = buffer.readUInt16LE(coff + 16);
  const optional = coff + 20;

  if (optional + 2 > buffer.length) return null;

  const magic = buffer.readUInt16LE(optional);
  const isPe32Plus = magic === 0x20b;
  const dataDirectory = optional + (isPe32Plus ? 112 : 96);

  // Data directory entry 1 is the import table.
  if (dataDirectory + 16 > buffer.length) return null;
  const importRva = buffer.readUInt32LE(dataDirectory + 8);
  if (importRva === 0) return [];

  const sectionTable = optional + sizeOfOptionalHeader;
  const sections = [];
  for (let index = 0; index < numberOfSections; index += 1) {
    const entry = sectionTable + index * 40;
    if (entry + 40 > buffer.length) break;
    sections.push({
      virtualSize: buffer.readUInt32LE(entry + 8),
      virtualAddress: buffer.readUInt32LE(entry + 12),
      rawSize: buffer.readUInt32LE(entry + 16),
      rawPointer: buffer.readUInt32LE(entry + 20),
    });
  }

  const toOffset = (rva) => {
    for (const section of sections) {
      const size = Math.max(section.virtualSize, section.rawSize);
      if (
        rva >= section.virtualAddress &&
        rva < section.virtualAddress + size
      ) {
        return rva - section.virtualAddress + section.rawPointer;
      }
    }
    return null;
  };

  const names = [];
  let descriptor = toOffset(importRva);

  while (descriptor !== null && descriptor + 20 <= buffer.length) {
    const nameRva = buffer.readUInt32LE(descriptor + 12);
    if (nameRva === 0) break;

    const nameOffset = toOffset(nameRva);
    if (nameOffset === null) break;

    const end = buffer.indexOf(0, nameOffset);
    if (end === -1) break;

    names.push(buffer.toString("ascii", nameOffset, end).toLowerCase());
    descriptor += 20;
  }

  return names;
};

const readResourceMapping = () => {
  const configPath = path.join(ROOT, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const resources = config?.bundle?.resources ?? {};

  return Object.entries(resources).find(
    ([source, target]) =>
      target === "hydra-native" &&
      path.posix.basename(source.replaceAll("\\", "/")) === "hydra-native"
  );
};

const main = () => {
  const problems = [];
  const warnings = [];

  const directory = path.join(ROOT, "hydra-native");
  const addon = path.join(directory, "hydra-native.node");
  const bridgeName = BRIDGE_BY_PLATFORM[process.platform];
  const bridge = bridgeName ? path.join(directory, bridgeName) : null;

  const missing = [];
  if (!fs.existsSync(addon)) missing.push(addon);
  if (!bridgeName) {
    warnings.push(
      `no prebuilt torrent bridge is defined for ${process.platform}; the addon must be built from source there`
    );
  } else if (!fs.existsSync(bridge)) {
    missing.push(bridge);
  }

  for (const file of missing) {
    const message =
      `missing ${path.relative(ROOT, file)} — run \`yarn build:native\` on a machine ` +
      `with the Rust and MSVC toolchains before packaging`;
    if (ALLOW_MISSING) warnings.push(message);
    else problems.push(message);
  }

  const verified = [];

  const verifyImports = (file) => {
    if (!fs.existsSync(file)) return;

    const imports = readPeImports(file);
    if (imports === null) {
      warnings.push(
        `${path.relative(ROOT, file)} is not a Windows PE image, so its DLL imports were not checked`
      );
      return;
    }

    verified.push(
      `${path.basename(file)} imports ${imports.length} DLLs` +
        (imports.length > 0 ? ` (${imports.join(", ")})` : "")
    );

    for (const dll of imports) {
      if (fs.existsSync(path.join(directory, dll))) continue;

      if (VC_RUNTIME_DLL.test(dll)) {
        problems.push(
          `${path.basename(file)} imports ${dll}, which is not bundled in hydra-native/ — ` +
            `a machine without the Visual C++ redistributable cannot load the engine. ` +
            `Rebuild the addon so the VC++ runtime DLLs are copied next to it.`
        );
        continue;
      }

      if (!isSystemDll(dll)) {
        warnings.push(
          `${path.basename(file)} imports ${dll}, which is neither bundled nor a known Windows system DLL`
        );
      }
    }
  };

  verifyImports(addon);
  if (bridge) verifyImports(bridge);

  const mapping = readResourceMapping();
  if (!mapping) {
    problems.push(
      "src-tauri/tauri.conf.json no longer maps ../hydra-native to hydra-native in bundle.resources; " +
        "SPHINX_HYDRA_NATIVE_DIR would point at a folder the installer does not ship"
    );
  }

  for (const warning of warnings) {
    process.stderr.write(`torrent resources: warning — ${warning}\n`);
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      process.stderr.write(`torrent resources: ${problem}\n`);
    }
    process.exit(1);
  }

  const files = fs
    .readdirSync(directory)
    .filter((file) => fs.statSync(path.join(directory, file)).isFile())
    .sort();

  process.stdout.write(
    `torrent resources: ${path.relative(ROOT, directory)} ${ALLOW_MISSING && warnings.length > 0 ? "would be packageable once the artifacts exist" : "is packageable"} (${files.length} files: ${files.join(", ")})\n`
  );

  for (const line of verified) {
    process.stdout.write(`torrent resources: ${line}\n`);
  }
};

main();
