/**
 * Rewrites `local:` artwork URLs into something the webview can load.
 *
 * The baseline addressed library artwork as `local:<absolute path>` and served it
 * with Electron's `protocol.handle("local", ...)`
 * (`src/main/index.ts:93-95`). The stored form is kept — it is in LevelDB, and
 * dozens of files compare against `startsWith("local:")` — but Tauri cannot
 * expose a custom scheme under its own name: on Windows it is served as
 * `http://local.localhost/<path>`, on Linux/macOS as `local://localhost/<path>`.
 *
 * So the rewrite happens once, at the DOM boundary, instead of at ~32 call
 * sites. `convertFileSrc` is the documented API for exactly this
 * (<https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc>);
 * the Rust half is `register_uri_scheme_protocol("local", ...)`.
 */
import { convertFileSrc } from "@tauri-apps/api/core";

/** The prefix the sidecar stores in `iconUrl`, `heroImageUrl`, … */
const LOCAL_PREFIX = "local:";

/** True when a URL needs converting. */
export const isLocalAsset = (url: string): boolean =>
  typeof url === "string" && url.startsWith(LOCAL_PREFIX);

/**
 * Converts one URL. Anything that is not a `local:` asset is returned untouched,
 * so callers can pass every image URL through it.
 */
export const toDisplayUrl = (url: string): string => {
  if (!isLocalAsset(url)) return url;

  const filePath = url.slice(LOCAL_PREFIX.length);

  try {
    return convertFileSrc(filePath, "local");
  } catch (error) {
    // No Tauri runtime (a plain `vite dev` in a browser). The raw URL at least
    // shows *which* file failed in the console.
    console.error("[tauri-bridge] cannot convert a local asset URL", error);
    return url;
  }
};

/**
 * Installs the rewrite on `HTMLImageElement.prototype.src` and `setAttribute`.
 *
 * React sets `src` as a property for `<img>`, which is why the setter is
 * patched; the `setAttribute` patch covers libraries that build `<img>`
 * elements imperatively. Both are narrow: only values that start with `local:`
 * are rewritten, so nothing else changes behaviour.
 */
export const installAssetUrlRewrite = (): void => {
  if (typeof HTMLImageElement === "undefined") return;

  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src"
  );

  if (descriptor?.set && descriptor.get) {
    const originalSet = descriptor.set;
    const originalGet = descriptor.get;

    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: descriptor.enumerable,
      set(this: HTMLImageElement, value: string) {
        originalSet.call(this, toDisplayUrl(value));
      },
      get(this: HTMLImageElement) {
        return originalGet.call(this) as string;
      },
    });
  }

  const originalSetAttribute = Element.prototype.setAttribute;

  Element.prototype.setAttribute = function patchedSetAttribute(
    this: Element,
    name: string,
    value: string
  ): void {
    if (name.toLowerCase() === "src" && isLocalAsset(value)) {
      originalSetAttribute.call(this, name, toDisplayUrl(value));
      return;
    }

    originalSetAttribute.call(this, name, value);
  };
};
