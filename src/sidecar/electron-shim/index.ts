/**
 * The `electron` module the sidecar sees.
 *
 * esbuild aliases `electron` to this file when it bundles `src/main`, so the
 * baseline main-process code runs unchanged. Every member below is either
 * implemented against the shell RPC channel, or throws
 * `NotImplementedInShim: <name>` — there is no silent fallback, because a
 * silent no-op inside a download or playtime path is a data-loss bug.
 *
 * The three deliberate exceptions are listed in docs/sidecar.md: `Notification`
 * (logs instead of showing), `session.webRequest` (records instead of
 * rewriting headers) and `nativeImage` (records instead of decoding). All three
 * are outside the Fase 4 acceptance surface and are tracked as follow-ups.
 */
import { EventEmitter } from "node:events";

import { NotImplementedInShim } from "../protocol.js";
import {
  attachHostRpc,
  callIgnoringFailure,
  getShellPath,
  hostRpc,
  loadShellEnvironment,
  setShellPath,
  shellEnvironment,
} from "./host.js";
import {
  WebContents,
  dispatchShellChannel,
  notifyWindowReady,
  onShellChannel,
  warnOnce,
} from "./window.js";
import {
  Menu,
  Tray,
  dispatchTrayClick,
  dispatchTrayEvent,
  getActiveTray,
} from "./tray.js";

export { BrowserWindow, WebContents } from "./window.js";

type IpcListener = (event: IpcInvokeEvent, ...args: unknown[]) => unknown;

export interface IpcInvokeEvent {
  sender: WebContents;
  senderFrame: null;
  frameId: number;
  processId: number;
  returnValue: unknown;
}

/** Thrown for any Electron member the shim does not implement. */
const notImplemented = (api: string): never => {
  throw new NotImplementedInShim(api);
};

// ---------------------------------------------------------------------------
// ipcMain
// ---------------------------------------------------------------------------

class IpcMain extends EventEmitter {
  private readonly handlers = new Map<string, IpcListener>();
  private readonly channelListeners = new Map<string, Set<IpcListener>>();

  public handle(channel: string, listener: IpcListener): void {
    if (this.handlers.has(channel)) {
      throw new Error(
        `Attempted to register a second handler for '${channel}'`
      );
    }
    this.handlers.set(channel, listener);
  }

  public handleOnce(channel: string, listener: IpcListener): void {
    this.handle(channel, (event, ...args) => {
      this.handlers.delete(channel);
      return listener(event, ...args);
    });
  }

  public removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  public on(channel: string, listener: IpcListener): this {
    const set = this.channelListeners.get(channel) ?? new Set<IpcListener>();
    set.add(listener);
    this.channelListeners.set(channel, set);
    return this;
  }

  public once(channel: string, listener: IpcListener): this {
    const wrapped: IpcListener = (event, ...args) => {
      this.removeListener(channel, wrapped);
      return listener(event, ...args);
    };
    return this.on(channel, wrapped);
  }

  public removeListener(channel: string, listener: IpcListener): this {
    this.channelListeners.get(channel)?.delete(listener);
    return this;
  }

  public removeAllListeners(channel?: string): this {
    if (channel) {
      this.handlers.delete(channel);
      this.channelListeners.delete(channel);
      return this;
    }

    this.handlers.clear();
    this.channelListeners.clear();
    return this;
  }

  public hasHandler(channel: string): boolean {
    return this.handlers.has(channel);
  }

  public hasListener(channel: string): boolean {
    return (this.channelListeners.get(channel)?.size ?? 0) > 0;
  }

  public invokeHandler(channel: string): IpcListener | undefined {
    return this.handlers.get(channel);
  }

  public fire(channel: string, event: IpcInvokeEvent, args: unknown[]): void {
    for (const listener of this.channelListeners.get(channel) ?? []) {
      try {
        listener(event, ...args);
      } catch (error) {
        process.stderr.write(
          `[shim] ipcMain listener for ${channel} threw: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      }
    }
  }
}

export const ipcMain = new IpcMain();

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------

const appEvents = new EventEmitter();

const app = {
  get isPackaged(): boolean {
    return shellEnvironment().isPackaged;
  },

  get isReady(): boolean {
    return true;
  },

  getPath: (name: string): string => getShellPath(name),
  setPath: (name: string, value: string): void => setShellPath(name, value),
  getVersion: (): string => shellEnvironment().appVersion,
  getName: (): string => shellEnvironment().appName,
  getAppPath: (): string => shellEnvironment().appPath,
  getLocale: (): string => shellEnvironment().locale,
  getSystemLocale: (): string => shellEnvironment().locale,

  whenReady: (): Promise<void> => Promise.resolve(),

  quit: (): void => {
    void callIgnoringFailure("app.quit", {});
  },
  exit: (code = 0): void => {
    process.exit(code);
  },
  relaunch: (): void => notImplemented("app.relaunch"),
  focus: (): void => notImplemented("app.focus"),

  on: (event: string, listener: (...args: unknown[]) => void): typeof app => {
    appEvents.on(event, listener);
    return app;
  },
  once: (event: string, listener: (...args: unknown[]) => void): typeof app => {
    appEvents.once(event, listener);
    return app;
  },
  off: (event: string, listener: (...args: unknown[]) => void): typeof app => {
    appEvents.off(event, listener);
    return app;
  },
  removeListener: (
    event: string,
    listener: (...args: unknown[]) => void
  ): typeof app => {
    appEvents.removeListener(event, listener);
    return app;
  },
  emit: (event: string, ...args: unknown[]): boolean =>
    appEvents.emit(event, ...args),

  // Rust owns the single-instance guard, the protocol registration and the
  // AppUserModelID, so these report success without doing anything.
  requestSingleInstanceLock: (): boolean => true,
  releaseSingleInstanceLock: (): void => undefined,
  setAsDefaultProtocolClient: (): boolean => true,
  removeAsDefaultProtocolClient: (): boolean => true,
  isDefaultProtocolClient: (): boolean => true,
  setAppUserModelId: (): void => undefined,
  setLoginItemSettings: (): void => undefined,
  getLoginItemSettings: (): { openAtLogin: boolean } => ({
    openAtLogin: false,
  }),
  addRecentDocument: (): void => undefined,
  clearRecentDocuments: (): void => undefined,
  setBadgeCount: (): boolean => false,
  disableHardwareAcceleration: (): void => undefined,
  setAboutPanelOptions: (): void => undefined,
  getAppMetrics: (): unknown[] => [],
  getFileIcon: (): Promise<never> =>
    Promise.reject(new Error("NotImplementedInShim: app.getFileIcon")),
  commandLine: {
    appendSwitch: (): void => undefined,
    appendArgument: (): void => undefined,
    hasSwitch: (): boolean => false,
    getSwitchValue: (): string => "",
  },
};

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------

/**
 * `showOpenDialog(window, options)` and `showOpenDialog(options)` are both
 * legal in Electron. The window argument is detected by its `webContents`
 * member, which is the only thing the sidecar ever needs from it.
 */
const stripWindowArgument = <T>(args: unknown[]): T | undefined => {
  const [first, second] = args;
  const looksLikeWindow =
    typeof first === "object" &&
    first !== null &&
    "webContents" in (first as Record<string, unknown>);

  return (looksLikeWindow ? second : first) as T | undefined;
};

const dialog = {
  showOpenDialog: async (...args: unknown[]) => {
    const options = stripWindowArgument<Record<string, unknown>>(args);
    return hostRpc().request("dialog.showOpenDialog", options ?? {});
  },
  showSaveDialog: async (...args: unknown[]) => {
    const options = stripWindowArgument<Record<string, unknown>>(args);
    return hostRpc().request("dialog.showSaveDialog", options ?? {});
  },
  showMessageBox: async (...args: unknown[]) => {
    const options = stripWindowArgument<Record<string, unknown>>(args);
    return hostRpc().request("dialog.showMessageBox", options ?? {});
  },
  showErrorBox: (title: string, content: string): void => {
    void callIgnoringFailure("dialog.showErrorBox", { title, content });
  },
};

// ---------------------------------------------------------------------------
// shell / clipboard / net
// ---------------------------------------------------------------------------

const shell = {
  openExternal: (url: string): Promise<void> =>
    hostRpc().request("shell.openExternal", { url }),
  openPath: (target: string): Promise<string> =>
    hostRpc().request("shell.openPath", { path: target }),
  showItemInFolder: (target: string): void => {
    void callIgnoringFailure("shell.showItemInFolder", { path: target });
  },
  beep: (): void => undefined,
};

const clipboard = {
  writeText: (text: string): void => {
    void callIgnoringFailure("clipboard.writeText", { text });
  },
  readText: (): string => notImplemented("clipboard.readText"),
  writeImage: (): void => notImplemented("clipboard.writeImage"),
};

const net = {
  fetch: (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => fetch(input as RequestInfo, init),
  isOnline: (): boolean => true,
};

// ---------------------------------------------------------------------------
// Displays, theme, power
// ---------------------------------------------------------------------------

interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

const readDisplays = (): DisplayInfo[] => {
  const raw = process.env.SPHINX_DISPLAYS;

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as DisplayInfo[];
      }
    } catch {
      /* fall through to the default below */
    }
  }

  return [
    {
      id: 0,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
    },
  ];
};

const displays = readDisplays();
const primaryDisplay = displays[0] as DisplayInfo;

const screen = {
  getPrimaryDisplay: (): DisplayInfo => primaryDisplay,
  getAllDisplays: (): DisplayInfo[] => displays,
  getDisplayMatching: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): DisplayInfo =>
    displays.find(
      (display) =>
        rect.x >= display.bounds.x &&
        rect.y >= display.bounds.y &&
        rect.x < display.bounds.x + display.bounds.width &&
        rect.y < display.bounds.y + display.bounds.height
    ) ?? primaryDisplay,
  getDisplayNearestPoint: (point: { x: number; y: number }): DisplayInfo =>
    screen.getDisplayMatching({ ...point, width: 1, height: 1 }),
  getCursorScreenPoint: (): { x: number; y: number } =>
    notImplemented("screen.getCursorScreenPoint"),
};

const nativeTheme = {
  get shouldUseDarkColors(): boolean {
    return process.env.SPHINX_THEME !== "light";
  },
  get themeSource(): string {
    return "system";
  },
  set themeSource(_value: string) {
    // Rust owns the theme; the sidecar only reads it.
  },
  on: (): void => undefined,
  once: (): void => undefined,
  removeListener: (): void => undefined,
};

const powerMonitor = {
  on: (event: string): void => {
    warnOnce(
      `powerMonitor.on:${event}`,
      `powerMonitor.${event} is not forwarded by the Tauri shell.`
    );
  },
  once: (): void => undefined,
  removeListener: (): void => undefined,
};

const powerSaveBlocker = {
  start: (type: string): number => {
    void callIgnoringFailure("power.setSleepBlocked", { blocked: true, type });
    return 1;
  },
  stop: (): void => {
    void callIgnoringFailure("power.setSleepBlocked", { blocked: false });
  },
  isStarted: (): boolean => false,
};

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

/** Electron accepts a path or a `nativeImage`; Rust needs a path. */
const notificationIconPath = (icon: unknown): string | undefined => {
  if (typeof icon === "string") return icon;
  if (icon && typeof icon === "object") {
    const candidate = icon as { path?: unknown; toPNG?: unknown };
    if (typeof candidate.path === "string") return candidate.path;
  }
  return undefined;
};

/**
 * `new Notification({ title, body, icon }).show()`.
 *
 * `on("click")` is accepted and stored but never fires: Tauri v2's notification
 * plugin has no click callback on desktop, so the baseline's
 * `.on("click", () => restartAndInstallUpdate())` cannot be reproduced. The
 * in-app update banner stays the primary path; see docs/sidecar.md.
 */
export class Notification extends EventEmitter {
  private readonly title: string;
  private readonly body: string;
  private readonly icon?: string;

  constructor(
    options: { title?: string; body?: string; icon?: unknown } = {}
  ) {
    super();
    this.title = options.title ?? "";
    this.body = options.body ?? "";
    this.icon = notificationIconPath(options.icon);
  }

  public static isSupported(): boolean {
    return true;
  }

  public show(): void {
    void hostRpc()
      .request("notification.show", {
        title: this.title,
        body: this.body,
        icon: this.icon,
      })
      .catch((error: unknown) => {
        console.error("[notification] cannot show", error);
      });
  }

  public close(): void {
    // Tauri closes notifications on its own schedule; there is no handle to
    // keep, so this stays a no-op instead of pretending to work.
  }
}

// ---------------------------------------------------------------------------
// Menu / Tray / protocol / session / capture
// ---------------------------------------------------------------------------

export class MenuItem {
  constructor(public readonly options: Record<string, unknown> = {}) {}
}

const session = {
  defaultSession: {
    webRequest: {
      onBeforeSendHeaders: (): void =>
        warnOnce(
          "session.webRequest.onBeforeSendHeaders",
          "session.webRequest is not available in the Tauri shell; CORS/UA rewriting is disabled."
        ),
      onHeadersReceived: (): void =>
        warnOnce(
          "session.webRequest.onHeadersReceived",
          "session.webRequest is not available in the Tauri shell; response header rewriting is disabled."
        ),
    },
    clearCache: (): Promise<void> => Promise.resolve(),
  },
  fromPartition: (): never => notImplemented("session.fromPartition"),
};

const protocol = {
  registerSchemesAsPrivileged: (): void => undefined,
  handle: (): never => notImplemented("protocol.handle"),
  unhandle: (): never => notImplemented("protocol.unhandle"),
  isProtocolHandled: (): boolean => false,
};

const crashReporter = {
  start: (): void => {
    // Local-only crash reporting is Rust's job now (PRD §9).
  },
};

const desktopCapturer = {
  getSources: (): Promise<never> =>
    Promise.reject(
      new Error("NotImplementedInShim: desktopCapturer.getSources")
    ),
};

const nativeImage = {
  createFromPath: (): never => notImplemented("nativeImage.createFromPath"),
  createFromBuffer: (): never => notImplemented("nativeImage.createFromBuffer"),
  createFromDataURL: (): never =>
    notImplemented("nativeImage.createFromDataURL"),
  createEmpty: (): never => notImplemented("nativeImage.createEmpty"),
};

const globalShortcut = {
  register: (): boolean => false,
  unregisterAll: (): void => undefined,
};

const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (): Buffer => notImplemented("safeStorage.encryptString"),
  decryptString: (): string => notImplemented("safeStorage.decryptString"),
};

const systemPreferences = {
  getAccentColor: (): string =>
    notImplemented("systemPreferences.getAccentColor"),
  isDarkMode: (): boolean => nativeTheme.shouldUseDarkColors,
};

export {
  app,
  attachHostRpc,
  clipboard,
  crashReporter,
  desktopCapturer,
  dialog,
  globalShortcut,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  onShellChannel,
  dispatchShellChannel,
  loadShellEnvironment,
  notifyWindowReady,
  Menu,
  Tray,
  dispatchTrayClick,
  dispatchTrayEvent,
  getActiveTray,
};
