/**
 * Resolves the URL a window was created with into an absolute URL.
 *
 * Windows created by the sidecar are given a bundle-relative path
 * (`index.html#/big-picture`), because the shell, not the sidecar, owns the
 * asset protocol. `src/main` still reads `webContents.getURL()` for its
 * trusted-sender checks, and a relative path makes `new URL()` throw — so the
 * path is resolved against the renderer base, which is the URL the shell
 * reported for the adopted `main` window.
 */
export function resolveRegisteredUrl(
  registered: string | null,
  base: string | null
): string {
  if (!registered) return "";

  try {
    return new URL(registered).href;
  } catch {
    // Not absolute: a bundle-relative route. Resolve it against the base below.
  }

  if (!base) return registered;

  try {
    return new URL(registered, base).href;
  } catch {
    return registered;
  }
}
