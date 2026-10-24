import react from "@vitejs/plugin-react";
import { realpathSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import { scopeBigPictureCss } from "./src/big-picture/vite-scope-big-picture-css";

/**
 * Renderer app (main window) as a plain Vite app.
 *
 * Replaces the `renderer` block of the old `electron.vite.config.ts`. Aliases,
 * React/SVGR/SCSS plugins and the Big Picture CSS scoping are kept identical so
 * no UI component has to change.
 *
 * `envPrefix` keeps the `RENDERER_VITE_*` contract the renderer already uses
 * (`import.meta.env.RENDERER_VITE_*`) and adds Tauri's own prefix, as documented
 * for Vite frontends:
 * https://v2.tauri.app/start/frontend/vite/#example-configuration
 *
 * `build.target` follows the same guide (`chrome105` on Windows, WebKit
 * elsewhere). The non-Windows value is raised to `safari15` because the renderer
 * entry uses top-level await, which needs Chrome 89+ / Safari 15+; the guide's
 * `safari13` default would reject it at build time.
 */
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: resolve("src/renderer"),
  base: "./",
  envPrefix: ["VITE_", "RENDERER_VITE_", "TAURI_ENV_*"],
  build: {
    outDir: resolve("out/renderer"),
    emptyOutDir: true,
    target:
      process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari15",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  esbuild: {
    keepNames: true,
  },
  css: {
    postcss: {
      plugins: [scopeBigPictureCss()],
    },
    preprocessorOptions: {
      scss: {
        api: "modern",
      },
    },
  },
  resolve: {
    alias: [
      // The reused preload imports `electron` and `node:crypto`. Both are
      // redirected to the Tauri bridge so `src/preload/index.ts` stays
      // byte-identical to the Electron version.
      {
        find: /^electron$/,
        replacement: resolve("src/tauri-bridge/electron.ts"),
      },
      {
        find: /^node:crypto$/,
        replacement: resolve("src/tauri-bridge/crypto.ts"),
      },
      // `electron-log/renderer` posts to Electron's main process over IPC and
      // throws in a webview, taking the renderer entry down with it.
      {
        find: /^electron-log\/renderer$/,
        replacement: resolve("src/tauri-bridge/renderer-logger.ts"),
      },
      { find: "@preload", replacement: resolve("src/preload") },
      // `install.ts` is the side-effect entry the app entries import first, so
      // it needs its own alias: the bare `@tauri-bridge` alias resolves to the
      // directory's index, and `@tauri-bridge/install` would not.
      {
        find: "@tauri-bridge/install",
        replacement: resolve("src/tauri-bridge/install.ts"),
      },
      {
        find: "@tauri-bridge",
        replacement: resolve("src/tauri-bridge/index.ts"),
      },
      { find: "@renderer", replacement: resolve("src/renderer/src") },
      { find: "@locales", replacement: resolve("src/locales") },
      { find: "@shared", replacement: resolve("src/shared") },
    ],
  },
  plugins: [svgr(), react()],
  server: {
    // Allow serving files from the project root and `node_modules` even when
    // `tauri dev` runs from a build copy whose `node_modules` is a symlink back
    // to this tree (otherwise Vite rejects `@fontsource` assets with an
    // "outside of Vite serving allow list" error). `realpathSync` maps the
    // symlink to the path Vite actually checks.
    fs: {
      allow: [resolve(__dirname), realpathSync(resolve(__dirname, "node_modules"))],
    },
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  clearScreen: false,
});
