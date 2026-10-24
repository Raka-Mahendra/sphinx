/**
 * Wire protocol between the Rust shell (`src-tauri`) and the Node sidecar.
 *
 * The transport is JSON Lines over the sidecar's stdin/stdout: one JSON object
 * per line, no framing header, no length prefix. stderr is reserved for the
 * sidecar's own diagnostics and is never parsed by Rust.
 *
 * The protocol is **bidirectional**. Rust drives the request/response pairs the
 * renderer started (`invoke`, `send`), and the sidecar drives its own
 * request/response pairs for the things only the shell can do (`rpc`): dialogs,
 * opening URLs, the OS keychain, resolved system paths, and the updater. Every
 * message therefore carries an `id` that is unique per direction; the two id
 * spaces are independent and are never compared across directions.
 *
 * `PROTOCOL_VERSION` is checked by both ends on `ready`. A mismatch is fatal on
 * the Rust side: the shell refuses to talk to a sidecar it does not understand
 * instead of silently mis-parsing results.
 */

export const PROTOCOL_VERSION = 1;

/**
 * Stable error codes. These cross the renderer boundary as `error.code` on the
 * rejected `Error`, so they are part of the public contract and must not be
 * renamed without updating `src/tauri-bridge`.
 */
export type SidecarErrorCode =
  /** The channel is not in the generated allowlist. */
  | "channel_not_allowed"
  /** The channel is allowed but nothing registered a handler for it. */
  | "handler_missing"
  /** The handler threw. `message`/`stack` come from the original error. */
  | "handler_error"
  /** The line Rust sent could not be parsed or had an unknown `type`. */
  | "invalid_message"
  /** The sidecar asked the shell for a method it does not implement. */
  | "rpc_method_not_allowed"
  /** The request was still in flight when the sidecar process died. */
  | "sidecar_restarted"
  /** The request arrived after the graceful shutdown started. */
  | "shutting_down";

export interface WireError {
  code: SidecarErrorCode;
  message: string;
  stack?: string;
  /** Original error class name, so the renderer keeps `TypeError` etc. */
  name?: string;
}

/** Renderer → shell → sidecar. Mirrors `ipcRenderer.invoke`. */
export interface InvokeMessage {
  type: "invoke";
  id: string;
  channel: string;
  args: unknown[];
  /** Label of the Tauri window that originated the call, for `event.sender`. */
  windowLabel: string | null;
}

/** Renderer → shell → sidecar. Mirrors `ipcRenderer.send`. */
export interface SendMessage {
  type: "send";
  id: string;
  channel: string;
  args: unknown[];
  windowLabel: string | null;
}

/** Shell → sidecar: the answer to a sidecar-initiated `rpc` request. */
export interface RpcResultMessage {
  type: "rpc-result";
  id: string;
  result?: unknown;
  error?: WireError;
}

/** Shell → sidecar: lifecycle and window bookkeeping, never renderer-driven. */
export type ControlMessage =
  | { type: "control"; action: "ping"; seq: number }
  | { type: "control"; action: "shutdown"; timeoutMs: number }
  | {
      type: "control";
      action: "window-attached";
      label: string;
      windowId: number;
      url: string;
    }
  | { type: "control"; action: "window-detached"; label: string }
  | { type: "control"; action: "window-ready"; label: string }
  | { type: "control"; action: "deep-link"; url: string }
  | {
      type: "control";
      action: "second-instance";
      url?: string;
      forceBigPicture?: boolean;
    }
  | { type: "control"; action: "tray-click"; label: string }
  | { type: "control"; action: "tray-event"; label: string }
  | {
      type: "control";
      action: "update-progress";
      seq: number;
      timeoutMs?: number;
    };

export type HostMessage =
  | InvokeMessage
  | SendMessage
  | RpcResultMessage
  | ControlMessage;

/** Sidecar → shell, first line on stdout. Rust waits for this before use. */
export interface ReadyMessage {
  type: "ready";
  protocolVersion: number;
  pid: number;
  /** Wall-clock milliseconds spent booting, for the shell's startup log. */
  bootMs: number;
}

/** Sidecar → shell: successful `invoke`. */
export interface ResultMessage {
  type: "result";
  id: string;
  result: unknown;
}

/** Sidecar → shell: failed `invoke`, or a `send` that could not be delivered. */
export interface ErrorMessage {
  type: "error";
  id: string;
  error: WireError;
}

/** Sidecar → shell: `webContents.send` replacement. Broadcast to all windows. */
export interface EventMessage {
  type: "event";
  channel: string;
  payload: unknown;
}

/** Sidecar → shell: a request only the shell can serve. */
export interface RpcRequestMessage {
  type: "rpc";
  id: string;
  method: string;
  params: unknown;
}

/** Sidecar → shell: liveness proof for the supervisor's watchdog. */
export interface HeartbeatMessage {
  type: "heartbeat";
  seq: number;
}

/** Sidecar → shell: graceful shutdown finished; the process exits right after. */
export interface ShutdownCompleteMessage {
  type: "shutdown-complete";
  reason: string;
  /** Shutdown steps that failed, so the shell can log them instead of hiding them. */
  failures: string[];
}

export type SidecarMessage =
  | ReadyMessage
  | ResultMessage
  | ErrorMessage
  | EventMessage
  | RpcRequestMessage
  | HeartbeatMessage
  | ShutdownCompleteMessage;

/**
 * RPC methods the sidecar may call. The Rust side rejects anything not listed
 * here with `rpc_method_not_allowed`; the list is duplicated on purpose so a
 * compromised sidecar cannot reach a command that was added for another reason.
 */
export const HOST_RPC_METHODS = [
  "app.quit",
  "app.version",
  "clipboard.writeText",
  "dialog.showOpenDialog",
  "dialog.showSaveDialog",
  "dialog.showMessageBox",
  "dialog.showErrorBox",
  "keychain.delete",
  "keychain.get",
  "keychain.set",
  "path.get",
  "path.resources",
  "shell.openExternal",
  "shell.openPath",
  "shell.showItemInFolder",
  "updater.check",
  "window.call",
  "window.create",
] as const;

export type HostRpcMethod = (typeof HOST_RPC_METHODS)[number];

const HOST_RPC_METHOD_SET: ReadonlySet<string> = new Set(HOST_RPC_METHODS);

export const isHostRpcMethod = (value: string): value is HostRpcMethod =>
  HOST_RPC_METHOD_SET.has(value);

/** Builds the `WireError` for a thrown value without leaking non-strings. */
export const toWireError = (
  error: unknown,
  code: SidecarErrorCode = "handler_error"
): WireError => {
  if (error instanceof Error) {
    return {
      code,
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return { code, message: error };
  }

  try {
    return { code, message: JSON.stringify(error) };
  } catch {
    return { code, message: String(error) };
  }
};

/** Thrown inside the shim when the sidecar needs an Electron API it lacks. */
export class NotImplementedInShim extends Error {
  public readonly api: string;

  constructor(api: string) {
    super(`NotImplementedInShim: ${api}`);
    this.name = "NotImplementedInShim";
    this.api = api;
  }
}
