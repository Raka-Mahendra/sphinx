import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  reportBridgeFailure,
  reportBridgeSuccess,
  reportSidecarStatus,
} from "./reconnect-indicator";

/**
 * The `electron` module the reused preload sees.
 *
 * `src/preload/index.ts` is not rewritten for Tauri. It keeps importing
 * `contextBridge` and `ipcRenderer`, and Vite aliases `electron` to this file.
 * The surface it needs is small:
 *
 * - `contextBridge.exposeInMainWorld(key, api)` — assigns `globalThis[key]`.
 *   There is no isolated world in Tauri, so this is a plain assignment. The
 *   security boundary moves to the Rust allowlist; see docs/tauri-security.md.
 * - `ipcRenderer.invoke(channel, ...args)` — `ipc_invoke`.
 * - `ipcRenderer.send(channel, ...args)` — `ipc_send`.
 * - `ipcRenderer.on/once/removeListener` — one shared subscription to
 *   `sphinx:ipc-event`, dispatched per channel.
 */

export interface IpcRendererEvent {
  sender: unknown;
  senderFrame: unknown;
}

type RendererListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

/** One synthetic event object, reused like Electron's does. */
const IPC_EVENT: IpcRendererEvent = { sender: null, senderFrame: null };

const listeners = new Map<string, Set<RendererListener>>();
let subscription: Promise<UnlistenFn> | null = null;

interface IpcEventPayload {
  channel: string;
  /** `webContents.send(channel, ...args)` arguments, preserved in order. */
  payload: unknown[];
}

const dispatch = (payload: IpcEventPayload): void => {
  const set = listeners.get(payload.channel);
  if (!set || set.size === 0) return;

  // Copy first: a listener that unsubscribes itself must not skip the next one.
  for (const listener of [...set]) {
    try {
      listener(IPC_EVENT, ...(payload.payload ?? []));
    } catch (error) {
      console.error(
        `[tauri-bridge] listener for ${payload.channel} threw`,
        error
      );
    }
  }
};

/**
 * Subscribes once, lazily, and keeps the promise so concurrent callers share it.
 * If the subscription fails the promise is dropped so the next `on()` retries.
 */
export const ensureSubscription = (): Promise<UnlistenFn> => {
  if (subscription) return subscription;

  subscription = listen<IpcEventPayload>("sphinx:ipc-event", (event) =>
    dispatch(event.payload)
  ).catch((error: unknown) => {
    subscription = null;
    console.error("[tauri-bridge] cannot subscribe to sphinx:ipc-event", error);
    throw error;
  });

  return subscription;
};

let statusSubscription: Promise<UnlistenFn> | null = null;

/**
 * Subscribes to the shell's supervisor status. Separate from `sphinx:ipc-event`
 * because it is not a sidecar channel: it comes from Rust and is not part of the
 * generated allowlist.
 */
export const ensureStatusSubscription = (): Promise<UnlistenFn> => {
  if (statusSubscription) return statusSubscription;

  statusSubscription = listen<{ status?: string }>(
    "sphinx:sidecar-status",
    (event) => reportSidecarStatus(event.payload?.status)
  ).catch((error: unknown) => {
    statusSubscription = null;
    console.error(
      "[tauri-bridge] cannot subscribe to sphinx:sidecar-status",
      error
    );
    throw error;
  });

  return statusSubscription;
};

/** Kicks the subscription off at import time; `on()` also awaits it. */
export const whenEventStreamReady = (): Promise<UnlistenFn> =>
  ensureSubscription();

export const whenStatusStreamReady = (): Promise<UnlistenFn> =>
  ensureStatusSubscription();

interface WireFailure {
  code?: string;
  message?: string;
  name?: string;
  stack?: string;
}

const isWireFailure = (value: unknown): value is WireFailure =>
  typeof value === "object" && value !== null && "message" in value;

/**
 * Rebuilds the rejection the renderer expects.
 *
 * Electron rejects `invoke` with `Error: Error invoking remote method '<channel>':
 * <Name>: <message>`, and several call sites surface that string directly. The
 * prefix is kept identical so user-visible text does not change; the structured
 * `code` is attached on top for the reconnect handling.
 */
const toRendererError = (channel: string, raw: unknown): Error => {
  const failure: WireFailure = isWireFailure(raw)
    ? raw
    : { message: typeof raw === "string" ? raw : JSON.stringify(raw) };

  const name = failure.name ?? "Error";
  const error = new Error(
    `Error invoking remote method '${channel}': ${name}: ${
      failure.message ?? "Unknown error"
    }`
  );

  if (failure.stack) error.stack = failure.stack;
  if (failure.code) Object.assign(error, { code: failure.code });

  return error;
};

export const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    try {
      const result = await invoke<unknown>("ipc_invoke", { channel, args });
      reportBridgeSuccess();
      return result;
    } catch (error) {
      const failure = error as WireFailure;
      // A transport failure is worth showing; a handler error is the app's own
      // problem and must not be dressed up as a reconnect.
      reportBridgeFailure(
        typeof failure?.code === "string" ? failure.code : undefined
      );
      throw toRendererError(channel, error);
    }
  },

  send(channel: string, ...args: unknown[]): void {
    // Fire and forget, like Electron. The promise is kept only so a rejected
    // send is reported instead of becoming an unhandled rejection.
    void invoke("ipc_send", { channel, args }).catch((error: unknown) => {
      console.error(
        `[tauri-bridge] send to ${channel} failed: ${
          isWireFailure(error) ? error.message : String(error)
        }`
      );
    });
  },

  on(channel: string, listener: RendererListener): void {
    const set = listeners.get(channel) ?? new Set<RendererListener>();
    set.add(listener);
    listeners.set(channel, set);
    void ensureSubscription().catch(() => undefined);
  },

  once(channel: string, listener: RendererListener): void {
    const wrapped: RendererListener = (event, ...args) => {
      ipcRenderer.removeListener(channel, wrapped);
      listener(event, ...args);
    };

    ipcRenderer.on(channel, wrapped);
  },

  removeListener(channel: string, listener: RendererListener): void {
    listeners.get(channel)?.delete(listener);
  },

  /**
   * Alias of `removeListener`, as in Electron.
   *
   * The preload uses `ipcRenderer.off` in `off: (channel, listener) => ...`
   * (`src/preload/index.ts:2310`), and the renderer calls that for every
   * subscription it tears down. Without the alias, unmounting a screen that
   * subscribed to a channel throws `ipcRenderer.off is not a function` — which
   * is exactly what the game details page did.
   */
  off(channel: string, listener: RendererListener): void {
    ipcRenderer.removeListener(channel, listener);
  },

  removeAllListeners(channel?: string): void {
    if (channel) {
      listeners.delete(channel);
      return;
    }

    listeners.clear();
  },

  listenerCount(channel: string): number {
    return listeners.get(channel)?.size ?? 0;
  },
};

export const contextBridge = {
  /**
   * Tauri has no isolated world, so this is an assignment to the page's global.
   * The PRD accepts that trade (§4.A.2) and replaces the boundary with the Rust
   * allowlist plus a strict CSP.
   */
  exposeInMainWorld(key: string, api: unknown): void {
    (globalThis as Record<string, unknown>)[key] = api;
  },

  exposeInIsolatedWorld(): never {
    throw new Error(
      "NotImplementedInShim: contextBridge.exposeInIsolatedWorld"
    );
  },
};

/** Test hook: number of channels with at least one listener. */
export const activeChannelCount = (): number =>
  [...listeners.values()].filter((set) => set.size > 0).length;
