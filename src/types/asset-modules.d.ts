/**
 * Vite's `?asset` imports.
 *
 * `src/main` reads tray/window icons and the game-capture page through
 * `@resources/...?asset`. The Electron build got these types from
 * `electron-vite/node`; the plain Vite renderer build does not, and Fase 8
 * deleted the Electron toolchain. The sidecar's esbuild plugin
 * (`scripts/build-sidecar.mjs`) already resolves each one to an absolute path
 * string at build time, so the module type is a string.
 */
declare module "*?asset" {
  const assetPath: string;
  export default assetPath;
}
