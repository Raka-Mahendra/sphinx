/**
 * Builds the URL a window loads for a renderer route.
 *
 * Electron resolves `loadFile("index.html", { hash })` to `index.html#<hash>`.
 * The Tauri shim cannot carry a hash through `loadFile`, so the route is built
 * here and sent as the window URL instead. A relative path keeps the packaged
 * bundle (`tauri://localhost`) working, and the development server still gets
 * the same route when `SPHINX_RENDERER_URL` is set.
 */
export function rendererRouteUrl(hash: string, devUrl?: string): string {
  if (devUrl) return `${devUrl}#/${hash}`;
  return `index.html#/${hash}`;
}
