import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  NATIVE_ADDON_FILE,
  resolveNativeAddonPath,
} from "./native-addon-path.ts";

/**
 * Path resolution the torrent engine depends on (Fase 6, PRD §4.C).
 *
 * Three layouts have to keep working, and they are the whole reason this is a
 * pure function: development must stay Hydra's (`<repo>/hydra-native`), a
 * packaged build must read the file the installer shipped, and the Rust shell's
 * `SPHINX_HYDRA_NATIVE_DIR` wins over both because it is the only one that
 * knows the actual installer layout.
 */

const ROOT = path.resolve(path.sep, "project");
const RESOURCES = path.resolve(path.sep, "installed", "resources");

describe("resolveNativeAddonPath", () => {
  it("reads <appPath>/hydra-native in development, exactly like Hydra", () => {
    assert.equal(
      resolveNativeAddonPath({
        isPackaged: false,
        resourcesPath: RESOURCES,
        appPath: ROOT,
      }),
      path.join(ROOT, "hydra-native", NATIVE_ADDON_FILE)
    );
  });

  it("reads <resourcesPath>/hydra-native from an installed app", () => {
    assert.equal(
      resolveNativeAddonPath({
        isPackaged: true,
        resourcesPath: RESOURCES,
        appPath: path.resolve(path.sep, "installed"),
      }),
      path.join(RESOURCES, "hydra-native", NATIVE_ADDON_FILE)
    );
  });

  it("prefers the directory Rust passes in SPHINX_HYDRA_NATIVE_DIR", () => {
    const fromShell = path.join(path.sep, "custom", "engine");

    assert.equal(
      resolveNativeAddonPath({
        isPackaged: true,
        resourcesPath: RESOURCES,
        appPath: ROOT,
        hydraNativeDir: fromShell,
      }),
      path.join(fromShell, NATIVE_ADDON_FILE)
    );

    assert.equal(
      resolveNativeAddonPath({
        isPackaged: false,
        resourcesPath: RESOURCES,
        appPath: ROOT,
        hydraNativeDir: fromShell,
      }),
      path.join(fromShell, NATIVE_ADDON_FILE)
    );
  });

  it("ignores an empty SPHINX_HYDRA_NATIVE_DIR", () => {
    assert.equal(
      resolveNativeAddonPath({
        isPackaged: false,
        resourcesPath: RESOURCES,
        appPath: ROOT,
        hydraNativeDir: "",
      }),
      path.join(ROOT, "hydra-native", NATIVE_ADDON_FILE)
    );
  });

  it("lets a test substitute the module, ahead of every other rule", () => {
    const standIn = path.resolve(ROOT, "fixtures", "fake-torrent-engine.cjs");

    assert.equal(
      resolveNativeAddonPath({
        isPackaged: true,
        resourcesPath: RESOURCES,
        appPath: ROOT,
        hydraNativeDir: path.join(ROOT, "hydra-native"),
        addonModule: standIn,
      }),
      standIn
    );
  });
});
