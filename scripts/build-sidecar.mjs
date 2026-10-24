#!/usr/bin/env node
/**
 * Bundles `src/sidecar` + `src/main` into the Node sidecar that Rust spawns.
 *
 * Design notes, because they are not obvious from the flags:
 *
 * - **`electron` is aliased to the shim.** That is the whole trick that lets
 *   `src/main` run unchanged outside Electron.
 * - **Every production dependency stays external.** The Electron build used
 *   `externalizeDepsPlugin` for the same reason: `classic-level`, `sharp` and
 *   `hydra-native` ship native binaries, and packages such as `jsdom` and
 *   `axios` resolve optional modules at runtime. Bundling them would change
 *   behaviour for no gain, so the sidecar ships with `node_modules` next to it.
 * - **`import.meta.env.MAIN_VITE_*` is replaced at build time.** Those are Vite
 *   env values that the baseline main process reads; without a define, the
 *   bundle would fail on `import.meta` in CJS output.
 * - **`?asset` imports resolve to an absolute path string.** The baseline uses
 *   them for tray/window icons, which the shim ignores.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "out", "sidecar");
const SHIM_DIR = path.join(ROOT, "src", "sidecar", "electron-shim");

const readEnvFile = () => {
  const file = path.join(ROOT, ".env");
  const values = {};

  if (!fs.existsSync(file)) return values;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }

  return values;
};

const env = readEnvFile();

const envDefines = Object.fromEntries(
  Object.entries(env).map(([key, value]) => [
    `import.meta.env.${key}`,
    JSON.stringify(value),
  ])
);

const packageJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
);

/**
 * Native or dynamic-require packages that must never be bundled. Everything
 * else in `dependencies` is external too; the list exists so a future
 * `--bundle-deps` experiment cannot accidentally inline a native module.
 */
const NATIVE_DEPENDENCIES = new Set([
  "classic-level",
  "hydra-native",
  "sharp",
  "node-7z",
  "winreg",
  "detect-drives",
  "auto-launch",
  "sound-play",
  "sudo-prompt",
  "create-desktop-shortcuts",
]);

const external = Object.keys(packageJson.dependencies ?? {}).filter(
  (name) => !name.startsWith("@electron-toolkit/") && name !== "electron-log"
);

/** Resolves `@resources/foo.png?asset` to an absolute path string. */
const assetPlugin = {
  name: "sphinx-asset-paths",
  setup(build) {
    build.onResolve({ filter: /\?asset$/ }, (args) => {
      const specifier = args.path.replace(/\?asset$/, "");
      const base = specifier.startsWith("@resources/")
        ? path.join(ROOT, "resources", specifier.slice("@resources/".length))
        : path.resolve(args.resolveDir, specifier);

      return { path: base, namespace: "sphinx-asset" };
    });

    build.onLoad({ filter: /.*/, namespace: "sphinx-asset" }, (args) => ({
      contents: `export default ${JSON.stringify(args.path)};`,
      loader: "js",
    }));
  },
};

const aliasPlugin = {
  name: "sphinx-aliases",
  setup(build) {
    const aliases = {
      electron: path.join(SHIM_DIR, "index.ts"),
      "electron-log": path.join(SHIM_DIR, "logger.ts"),
      "auto-launch": path.join(SHIM_DIR, "auto-launch.ts"),
      "@electron-toolkit/utils": path.join(SHIM_DIR, "electron-toolkit.ts"),
      "@main": path.join(ROOT, "src", "main"),
      // `src/main` may call the shell, but only through this client; see
      // src/main/services/shell-rpc.ts.
      "@sidecar": path.join(ROOT, "src", "sidecar"),
      "@shared": path.join(ROOT, "src", "shared"),
      "@types": path.join(ROOT, "src", "types", "index.ts"),
      "@locales": path.join(ROOT, "src", "locales", "index.ts"),
      "@resources": path.join(ROOT, "resources"),
    };

    build.onResolve({ filter: /.*/ }, (args) => {
      for (const [name, target] of Object.entries(aliases)) {
        if (args.path === name) {
          return { path: resolveTarget(target, args.resolveDir) };
        }

        if (args.path.startsWith(`${name}/`)) {
          const rest = args.path.slice(name.length + 1);
          return {
            path: resolveTarget(path.join(target, rest), args.resolveDir),
          };
        }
      }

      return null;
    });
  },
};

const resolveTarget = (candidate, resolveDir) => {
  const bases = path.isAbsolute(candidate)
    ? [candidate]
    : [path.resolve(resolveDir, candidate), path.resolve(ROOT, candidate)];

  for (const base of bases) {
    for (const suffix of ["", ".ts", ".tsx", ".js", ".mjs", ".json"]) {
      const file = `${base}${suffix}`;
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }

    for (const index of ["index.ts", "index.tsx", "index.js"]) {
      const file = path.join(base, index);
      if (fs.existsSync(file)) return file;
    }
  }

  return candidate;
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const watch = process.argv.includes("--watch");

  const context = await esbuild.context({
    entryPoints: [path.join(ROOT, "src", "sidecar", "entry.ts")],
    outfile: path.join(OUT_DIR, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    // ESM, not CJS. The baseline main process is ESM (electron-vite built it
    // that way), and CJS output would also lose `import.meta.env`.
    format: "esm",
    sourcemap: true,
    // A sidecar that dies on a missing optional dependency is worse than one
    // that reports it at call time, so the build keeps going and the log shows
    // the missing module.
    logLevel: "info",
    metafile: true,
    external,
    plugins: [assetPlugin, aliasPlugin],
    define: {
      ...envDefines,
      "import.meta.env": JSON.stringify({
        MODE: "production",
        DEV: false,
        PROD: true,
        ...env,
      }),
    },
    // ESM has no `__dirname`/`require`. `src/main/constants.ts` resolves sound
    // files through `__dirname`, and some dependencies still reach for
    // `require`, so both are restored from `import.meta.url`.
    banner: {
      js: [
        "// Generated by scripts/build-sidecar.mjs — do not edit.",
        'import { createRequire as __sphinxCreateRequire } from "node:module";',
        'import { fileURLToPath as __sphinxFileURLToPath } from "node:url";',
        'import { dirname as __sphinxDirname } from "node:path";',
        "const __filename = __sphinxFileURLToPath(import.meta.url);",
        "const __dirname = __sphinxDirname(__filename);",
        "const require = __sphinxCreateRequire(import.meta.url);",
      ].join("\n"),
    },
  });

  if (watch) {
    await context.watch();
    process.stdout.write("sidecar: watching\n");
    return;
  }

  const result = await context.rebuild();
  await context.dispose();

  const output = path.join(OUT_DIR, "index.mjs");
  const size = fs.statSync(output).size;
  const modules = Object.keys(result.metafile?.inputs ?? {}).length;

  process.stdout.write(
    `sidecar: ${path.relative(ROOT, output)} (${(size / 1024).toFixed(0)} KB, ${modules} modules, ${external.length} external)\n`
  );

  const nativeMissing = [...NATIVE_DEPENDENCIES].filter(
    (name) => !fs.existsSync(path.join(ROOT, "node_modules", name))
  );

  if (nativeMissing.length > 0) {
    process.stderr.write(
      `sidecar: warning — native dependency not installed: ${nativeMissing.join(", ")}\n`
    );
  }
};

await main();
