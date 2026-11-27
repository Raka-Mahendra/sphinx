/**
 * The Electron *type* surface the baseline main process still names.
 *
 * The Electron package is gone (PRD Fase 8): no Electron binary ships, and
 * `scripts/build-sidecar.mjs` aliases the `"electron"` module specifier to
 * `src/sidecar/electron-shim`. A few hundred handler signatures in `src/main`
 * are still annotated with `Electron.IpcMainInvokeEvent` and friends, so the
 * names have to exist for the compiler. Each one maps onto the shim type that
 * really runs, not onto an Electron API that is never loaded.
 *
 * `electron.d.ts` (removed with the package) also augmented `NodeJS.Process`
 * with `resourcesPath`; the sidecar defines that property itself in
 * `src/sidecar/entry.ts:73`, so the declaration is repeated here.
 */

declare namespace Electron {
  /** The shim's invoke handler event; see `src/sidecar/electron-shim/index.ts`. */
  type IpcMainInvokeEvent =
    import("../sidecar/electron-shim/index").IpcInvokeEvent;

  /** The preload's subscribe callback; see `src/tauri-bridge/electron.ts`. */
  type IpcRendererEvent = import("../tauri-bridge/electron").IpcRendererEvent;

  type BrowserWindow = import("../sidecar/electron-shim/index").BrowserWindow;
  type WebContents = import("../sidecar/electron-shim/index").WebContents;
  type BrowserWindowConstructorOptions =
    import("../sidecar/electron-shim/window").WindowOptions;

  /** Only the members `src/main` reads from a dialog result. */
  interface FileFilter {
    name: string;
    extensions: string[];
  }

  interface OpenDialogOptions {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
    filters?: FileFilter[];
    properties?: string[];
  }

  interface OpenDialogReturnValue {
    canceled: boolean;
    filePaths: string[];
  }

  /** `nativeImage` factories are not implemented by the shim; only the type is used. */
  interface NativeImage {
    isEmpty(): boolean;
    toPNG(): Buffer;
    toBitmap(): Buffer;
    toJPEG(quality?: number): Buffer;
    getSize(): { width: number; height: number };
    toDataURL(): string;
    resize(options: {
      width?: number;
      height?: number;
      quality?: string;
    }): NativeImage;
  }
}

declare namespace NodeJS {
  interface Process {
    /**
     * Tauri's resource directory, defined by `src/sidecar/entry.ts` before any
     * module reads it (`src/main/constants.ts` reads it at module load).
     */
    resourcesPath: string;

    /**
     * Set by Electron when the app runs from source. The packaged sidecar is
     * never a development entry point, so it reads as `undefined`; the property
     * exists so `shortcut-launch.ts` and `game-files-manager.ts` keep compiling.
     */
    defaultApp?: boolean;
  }
}
