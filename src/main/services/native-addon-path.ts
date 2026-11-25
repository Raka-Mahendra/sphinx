import path from "node:path";

/**
 * Where `hydra-native.node` lives, and therefore where the prebuilt torrent
 * bridge (`hydra_torrent_bridge.dll` / `libhydra_torrent_bridge.so`) sits too:
 * the addon loads it from its own directory (on Linux `LD_LIBRARY_PATH` is set
 * to that directory in `native-addon.ts`).
 *
 * The folder name is Hydra's and is deliberately not renamed (PRD §4.C).
 *
 * | Build       | Directory                                               |
 * | ----------- | ------------------------------------------------------- |
 * | development | `<repo>/hydra-native` (`app.getAppPath()`, as Hydra)    |
 * | packaged    | `<resources>/hydra-native` (`bundle.resources` mapping) |
 *
 * A packaged build normally receives the directory from Rust as
 * `SPHINX_HYDRA_NATIVE_DIR` (derived from `SPHINX_RESOURCES_DIR`), so the
 * sidecar never has to infer the installer layout. The `isPackaged` branch is
 * the fallback for a hand-assembled bundle and for tests.
 */
export const NATIVE_ADDON_DIR = "hydra-native";
export const NATIVE_ADDON_FILE = "hydra-native.node";

export interface NativeAddonLocation {
  /** `app.isPackaged` — in the sidecar, `SPHINX_IS_PACKAGED`. */
  isPackaged: boolean;
  /** Directory of the bundled resources (Electron's `process.resourcesPath`). */
  resourcesPath: string;
  /** Application directory (Electron's `app.getAppPath()`). */
  appPath: string;
  /**
   * `SPHINX_HYDRA_NATIVE_DIR` from the Rust shell. Absolute and preferred when
   * present.
   */
  hydraNativeDir?: string | null;
  /**
   * `SPHINX_TEST_NATIVE_ADDON` — a full path to a module that stands in for the
   * N-API addon. Only `src/sidecar/torrent-engine.test.ts` sets it; it exists
   * because the real addon needs a Rust/MSVC build, and the lifecycle
   * assertions (single engine, ordered shutdown) must still be tested.
   */
  addonModule?: string | null;
}

const present = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

export const resolveNativeAddonPath = (
  location: NativeAddonLocation
): string => {
  if (present(location.addonModule)) return path.resolve(location.addonModule);

  if (present(location.hydraNativeDir)) {
    return path.join(location.hydraNativeDir, NATIVE_ADDON_FILE);
  }

  const base = location.isPackaged ? location.resourcesPath : location.appPath;

  return path.join(base, NATIVE_ADDON_DIR, NATIVE_ADDON_FILE);
};
