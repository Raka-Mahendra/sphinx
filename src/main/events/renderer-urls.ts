/**
 * Where Tauri serves the bundled renderer.
 *
 * Electron loaded `file://…/index.html`; Tauri serves the same bundle from a
 * custom protocol: `tauri://localhost` on Linux/macOS, and the wry workaround
 * `http://tauri.localhost` (or `https://` with `useHttpsScheme`) on Windows.
 * `src/main`'s trusted-sender checks compare against these, so a packaged build
 * is not rejected for not being a `file:` URL.
 *
 * Source: `tauri::manager::AppManager::get_app_url` / `protocol::origin`.
 */
export const TAURI_APP_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
] as const;

/**
 * Full URLs a packaged renderer can report: the bundle root, or an explicit
 * `index.html` if a route is loaded that way.
 */
export function bundledRendererUrls(): string[] {
  return TAURI_APP_ORIGINS.flatMap((origin) => [
    `${origin}/`,
    `${origin}/index.html`,
  ]);
}
