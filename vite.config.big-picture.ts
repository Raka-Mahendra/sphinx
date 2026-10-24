import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import { scopeBigPictureCss } from "./src/big-picture/vite-scope-big-picture-css";

/**
 * Big Picture as its own Vite app (second entry, separate dev server).
 *
 * Same aliases and plugins as the old `bigPicture` block of
 * `electron.vite.config.ts`, including the CSS scoping plugin so Big Picture
 * styles cannot leak into the main window stylesheet and vice versa.
 *
 * Port 5174 keeps it apart from the renderer on 5173; Tauri's `devUrl` points at
 * the renderer, and the Big Picture window is created in Rust with an explicit
 * URL (see `src-tauri/src/lib.rs`).
 */
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: resolve("src/big-picture"),
  base: "./",
  envPrefix: ["VITE_", "RENDERER_VITE_", "TAURI_ENV_*"],
  build: {
    outDir: resolve("out/big-picture"),
    emptyOutDir: true,
    target:
      process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari15",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      input: resolve("src/big-picture/index.html"),
    },
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
      // Same bridge aliases as the renderer: Big Picture installs the identical
      // `window.electron` surface from the reused preload.
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
    port: 5174,
    strictPort: true,
    host: host || false,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  clearScreen: false,
});
