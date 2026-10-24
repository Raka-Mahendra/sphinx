import { EventEmitter } from "node:events";

import { callIgnoringFailure, hostRpc } from "./host.js";

/**
 * A `BrowserWindow` that lives in the shell, not in the sidecar.
 *
 * In Tauri the window is a `WebviewWindow` owned by Rust. The sidecar keeps a
 * proxy so `src/main/services/window-manager.ts` keeps compiling and keeps its
 * semantics: the same method names, the same synchronous-looking `void`
 * returns, the same `webContents.send` for events.
 *
 * Creation is **deferred**. Electron creates the window when the constructor
 * runs, but a Tauri window needs its URL at creation time, and the URL only
 * arrives with the first `loadURL`/`loadFile` call. So the constructor records
 * the options and the first navigation triggers `window.create`. Until then
 * every other method is queued behind that promise.
 */
export interface WindowOptions {
  /**
   * Window label. In Tauri the label is the security boundary: capabilities
   * grant commands per label, so a window the sidecar creates must carry the
   * label the shell knows it by. Without it the shim generates
   * `sphinx-window-<n>`, which no capability grants, and every command in that
   * window is rejected.
   */
  label?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  x?: number;
  y?: number;
  title?: string;
  show?: boolean;
  frame?: boolean;
  transparent?: boolean;
  fullscreen?: boolean;
  resizable?: boolean;
  alwaysOnTop?: boolean;
  skipTaskbar?: boolean;
  focusable?: boolean;
  backgroundColor?: string;
  titleBarStyle?: string;
  trafficLightPosition?: { x: number; y: number };
  webPreferences?: Record<string, unknown>;
  icon?: unknown;
  opacity?: number;
  modal?: boolean;
  parent?: unknown;
  hasShadow?: boolean;
  roundedCorners?: boolean;
  thickFrame?: boolean;
  paintWhenInitiallyHidden?: boolean;
  [key: string]: unknown;
}

type WindowEventHandler = (...args: unknown[]) => void;

let nextWindowSequence = 1;

const listenersByChannel = new Map<string, Set<WindowEventHandler>>();

const warnOnceKeys = new Set<string>();

/** Logs an unmappable Electron API exactly once per process. */
export const warnOnce = (key: string, message: string): void => {
  if (warnOnceKeys.has(key)) return;
  warnOnceKeys.add(key);
  process.stderr.write(`[shim] ${message}\n`);
};

/**
 * `webContents`. Only the members `src/main` actually touches are implemented;
 * everything else throws so a future caller notices instead of silently doing
 * nothing.
 */
export class WebContents extends EventEmitter {
  public readonly id: number;
  public readonly session: {
    webRequest: {
      onBeforeSendHeaders: (listener: unknown) => void;
      onHeadersReceived: (listener: unknown) => void;
    };
  };

  constructor(
    public readonly windowLabel: string,
    id: number
  ) {
    super();
    this.id = id;

    // Electron rewrites CORS and cache headers here (`window-manager.ts:342`).
    // Tauri's WebView2 exposes no global response-header hook, so the sidecar
    // cannot honour it. Recording the listeners keeps window construction
    // working; the behaviour difference is documented in docs/sidecar.md.
    this.session = {
      webRequest: {
        onBeforeSendHeaders: () =>
          warnOnce(
            "session.webRequest.onBeforeSendHeaders",
            "session.webRequest is not available in the Tauri shell; CORS/UA rewriting is disabled."
          ),
        onHeadersReceived: () =>
          warnOnce(
            "session.webRequest.onHeadersReceived",
            "session.webRequest is not available in the Tauri shell; response header rewriting is disabled."
          ),
      },
    };
  }

  /** `webContents.send` → one `sphinx:ipc-event` emit, arguments preserved. */
  public send(channel: string, ...args: unknown[]): void {
    hostRpc().emitEvent(channel, args);
  }

  public setWindowOpenHandler(): void {
    // Tauri owns navigation policy (`window.open` is denied by the shell's
    // capability set), so the handler is not forwarded. See docs/sidecar.md.
    warnOnce(
      "webContents.setWindowOpenHandler",
      "setWindowOpenHandler is ignored: the Tauri shell denies new windows itself."
    );
  }

  public openDevTools(): void {
    void callIgnoringFailure("window.call", {
      label: this.windowLabel,
      method: "openDevTools",
    });
  }

  public closeDevTools(): void {
    void callIgnoringFailure("window.call", {
      label: this.windowLabel,
      method: "closeDevTools",
    });
  }

  public toggleDevTools(): void {
    void callIgnoringFailure("window.call", {
      label: this.windowLabel,
      method: "toggleDevTools",
    });
  }

  public isLoading(): boolean {
    return false;
  }

  public isDestroyed(): boolean {
    return !BrowserWindow.isLabelAlive(this.windowLabel);
  }

  public getURL(): string {
    return BrowserWindow.getRegisteredUrl(this.windowLabel) ?? "";
  }
}

export class BrowserWindow extends EventEmitter {
  private static readonly byWebContentsId = new Map<number, BrowserWindow>();
  private static readonly byLabel = new Map<string, BrowserWindow>();
  private static readonly urls = new Map<string, string>();
  private static aliveLabels = new Set<string>();
  private static nextWebContentsId = 1;

  public readonly webContents: WebContents;
  private readonly options: WindowOptions;
  private creation: Promise<void> | null = null;
  private destroyed = false;

  constructor(options: WindowOptions = {}) {
    super();
    this.options = options;
    this.label = `sphinx-window-${nextWindowSequence++}`;
    this.webContents = new WebContents(
      this.label,
      BrowserWindow.nextWebContentsId++
    );

    BrowserWindow.byWebContentsId.set(this.webContents.id, this);
    BrowserWindow.byLabel.set(this.label, this);
  }

  public label: string;

  public static fromWebContents(
    webContents: WebContents | null
  ): BrowserWindow | null {
    if (!webContents) return null;
    return BrowserWindow.byWebContentsId.get(webContents.id) ?? null;
  }

  public static getAllWindows(): BrowserWindow[] {
    return [...BrowserWindow.byLabel.values()].filter(
      (window) => !window.isDestroyed()
    );
  }

  public static getFocusedWindow(): BrowserWindow | null {
    return BrowserWindow.getAllWindows()[0] ?? null;
  }

  /**
   * Emits `ready-to-show` for a window the shell reported as painted.
   *
   * Static because the signal arrives on the RPC channel, not on a window
   * instance: `entry.ts` only has a label.
   */
  public static notifyReady(label: string): void {
    BrowserWindow.byLabel.get(label)?.emit("ready-to-show");
  }

  /** Adopts a window the shell created (main, big-picture) into the registry. */
  public static adopt(
    label: string,
    windowId: number,
    url: string
  ): BrowserWindow {
    const existing = BrowserWindow.byLabel.get(label);
    if (existing) {
      BrowserWindow.urls.set(label, url);
      BrowserWindow.aliveLabels.add(label);
      return existing;
    }

    const window = new BrowserWindow({});
    // The constructor registered a placeholder label; replace both indexes so
    // `getAllWindows()` never reports a window the shell does not have.
    BrowserWindow.byLabel.delete(window.label);
    BrowserWindow.byWebContentsId.delete(window.webContents.id);

    (window as { label: string }).label = label;
    (window.webContents as { windowLabel: string }).windowLabel = label;
    (window.webContents as { id: number }).id = windowId;

    BrowserWindow.byLabel.set(label, window);
    BrowserWindow.byWebContentsId.set(windowId, window);
    BrowserWindow.urls.set(label, url);
    BrowserWindow.aliveLabels.add(label);
    window.creation = Promise.resolve();

    return window;
  }

  public static release(label: string): void {
    BrowserWindow.aliveLabels.delete(label);
    BrowserWindow.urls.delete(label);
  }

  public static isLabelAlive(label: string): boolean {
    return BrowserWindow.aliveLabels.has(label);
  }

  public static getRegisteredUrl(label: string): string | null {
    return BrowserWindow.urls.get(label) ?? null;
  }

  /** Fires a window event that the shell reported (`closed`, `focus`, ...). */
  public static dispatchShellEvent(label: string, event: string): void {
    BrowserWindow.byLabel.get(label)?.emit(event);
  }

  public loadURL(url: string): Promise<void> {
    return this.ensureCreated(url);
  }

  public loadFile(filePath: string): Promise<void> {
    return this.ensureCreated(filePath);
  }

  public show(): void {
    void this.call("show");
  }

  public hide(): void {
    void this.call("hide");
  }

  public focus(): void {
    void this.call("focus");
  }

  public blur(): void {
    void this.call("blur");
  }

  public close(): void {
    void this.call("close");
  }

  public destroy(): void {
    this.destroyed = true;
    BrowserWindow.release(this.label);
    void this.call("close");
    this.emit("closed");
  }

  public minimize(): void {
    void this.call("minimize");
  }

  public maximize(): void {
    void this.call("maximize");
  }

  public unmaximize(): void {
    void this.call("unmaximize");
  }

  public restore(): void {
    void this.call("restore");
  }

  public setFullScreen(fullscreen: boolean): void {
    void this.call("setFullScreen", { fullscreen });
  }

  public setAlwaysOnTop(alwaysOnTop: boolean): void {
    void this.call("setAlwaysOnTop", { alwaysOnTop });
  }

  public setIgnoreMouseEvents(
    ignore: boolean,
    options?: { forward?: boolean }
  ): void {
    void this.call("setIgnoreMouseEvents", {
      ignore,
      forward: options?.forward ?? false,
    });
  }

  public setSkipTaskbar(skip: boolean): void {
    void this.call("setSkipTaskbar", { skip });
  }

  public setFocusable(focusable: boolean): void {
    void this.call("setFocusable", { focusable });
  }

  public setOpacity(opacity: number): void {
    void this.call("setOpacity", { opacity });
  }

  public setProgressBar(progress: number): void {
    void this.call("setProgressBar", { progress });
  }

  public setTitle(title: string): void {
    void this.call("setTitle", { title });
  }

  public setMenu(): void {
    // Tauri has no per-window application menu; the shell owns the menu bar.
  }

  public removeMenu(): void {
    // Same as setMenu.
  }

  public setBounds(bounds: Record<string, number>): void {
    void this.call("setBounds", bounds);
  }

  public getBounds(): { x: number; y: number; width: number; height: number } {
    // Synchronous in Electron; the shell cannot answer synchronously. The
    // cached value from the last known state is returned and refreshed on the
    // next `window-event`. `window-manager.ts` uses it only for save-on-close.
    return this.lastBounds;
  }

  public isDestroyed(): boolean {
    return this.destroyed || !BrowserWindow.isLabelAlive(this.label);
  }

  public isMinimized(): boolean {
    return this.lastState.minimized;
  }

  public isMaximized(): boolean {
    return this.lastState.maximized;
  }

  public isFullScreen(): boolean {
    return this.lastState.fullscreen;
  }

  public isVisible(): boolean {
    return this.lastState.visible;
  }

  public isFocused(): boolean {
    return this.lastState.focused;
  }

  /** Called by `entry.ts` when the shell reports new window state. */
  public applyShellState(state: Partial<WindowState>): void {
    Object.assign(this.lastState, state);
    if (state.bounds) Object.assign(this.lastBounds, state.bounds);
  }

  private lastBounds = { x: 0, y: 0, width: 0, height: 0 };
  private lastState: WindowState = {
    minimized: false,
    maximized: false,
    fullscreen: false,
    visible: false,
    focused: false,
  };

  private ensureCreated(url: string): Promise<void> {
    if (this.creation) return this.creation;

    // An explicit label wins: it is the capability boundary in Tauri. The
    // constructor already registered the generated label, so the map has to be
    // corrected here or `ready-to-show` and `getAllWindows()` would look under
    // the wrong name.
    if (this.options.label && this.options.label !== this.label) {
      BrowserWindow.byLabel.delete(this.label);
      this.label = this.options.label;
      BrowserWindow.byLabel.set(this.label, this);
    }

    this.creation = (async () => {
      const result = (await hostRpc().request("window.create", {
        label: this.label,
        url,
        options: this.options,
      })) as { windowId?: number } | undefined;

      if (typeof result?.windowId === "number") {
        BrowserWindow.byWebContentsId.set(result.windowId, this);
        (this.webContents as { id: number }).id = result.windowId;
      }

      BrowserWindow.aliveLabels.add(this.label);
      BrowserWindow.urls.set(this.label, url);
    })();

    return this.creation;
  }

  private async call(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.creation) {
      // No navigation yet: nothing exists in the shell, so there is nothing to
      // call. Matches Electron closely enough for the paths `src/main` uses.
      return;
    }

    await this.creation;
    await callIgnoringFailure("window.call", {
      label: this.label,
      method,
      params,
    });
  }
}

export interface WindowState {
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
  visible: boolean;
  focused: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

/** Registers a global (cross-window) listener for a shim-emitted event. */
export const onShellChannel = (
  channel: string,
  listener: WindowEventHandler
): (() => void) => {
  const set = listenersByChannel.get(channel) ?? new Set<WindowEventHandler>();
  set.add(listener);
  listenersByChannel.set(channel, set);

  return () => {
    set.delete(listener);
  };
};

/**
 * Emits Electron's `ready-to-show` for a window the shell created.
 *
 * `src/main/services/window-manager.ts` creates every auxiliary window with
 * `show: false` and shows it from `ready-to-show`. Electron fires that event
 * when the renderer painted its first frame; here the signal comes from Rust
 * (`PageLoadEvent::Finished`), because only the shell sees the webview paint.
 */
export const notifyWindowReady = (label: string): void => {
  BrowserWindow.notifyReady(label);
};

export const dispatchShellChannel = (
  channel: string,
  payload: unknown
): void => {
  for (const listener of listenersByChannel.get(channel) ?? []) {
    listener(payload);
  }
};
