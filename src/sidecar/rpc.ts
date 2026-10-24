import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

import {
  PROTOCOL_VERSION,
  type ControlMessage,
  type HostMessage,
  type RpcResultMessage,
  type SidecarMessage,
  type WireError,
  toWireError,
} from "./protocol.js";

/**
 * JSON Lines transport.
 *
 * One JSON object per line. The reader tolerates `\r\n` (the Windows default
 * when a pipe is opened in text mode) and drops blank lines. The writer
 * serialises every line through a queue so a multi-megabyte payload — image
 * data URLs travel this way — cannot interleave with the next message.
 */
export class JsonLineTransport {
  private buffer = "";
  private readonly queue: string[] = [];
  private draining = false;
  private closed = false;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable
  ) {}

  /** Feeds every complete line to `onLine`; the remainder stays buffered. */
  public read(onLine: (line: string) => void): void {
    this.input.setEncoding("utf8");
    this.input.on("data", (chunk: string) => {
      this.buffer += chunk;

      let index = this.buffer.indexOf("\n");
      while (index !== -1) {
        const line = this.buffer.slice(0, index).replace(/\r$/, "");
        this.buffer = this.buffer.slice(index + 1);
        if (line.trim().length > 0) onLine(line);
        index = this.buffer.indexOf("\n");
      }
    });
  }

  public write(message: SidecarMessage): void {
    if (this.closed) return;
    this.queue.push(`${JSON.stringify(message)}\n`);
    this.flush();
  }

  /** Drops anything still queued. Called once the process is about to exit. */
  public close(): void {
    this.closed = true;
    this.queue.length = 0;
  }

  /** Resolves once every queued line has been handed to the OS. */
  public async flushAndWait(): Promise<void> {
    if (this.queue.length === 0) return;
    await new Promise<void>((resolve) => {
      this.output.write("", () => resolve());
    });
  }

  private flush(): void {
    if (this.draining) return;

    while (this.queue.length > 0) {
      const line = this.queue.shift() as string;
      const accepted = this.output.write(line);
      if (!accepted) {
        this.draining = true;
        this.output.once("drain", () => {
          this.draining = false;
          this.flush();
        });
        return;
      }
    }
  }
}

export interface InvokeContext {
  channel: string;
  /** Label of the originating Tauri window, or null when the shell had none. */
  windowLabel: string | null;
}

export type InvokeHandler = (
  channel: string,
  args: unknown[],
  context: InvokeContext
) => Promise<unknown>;

export type ChannelKind = "invoke" | "send" | "event";

export type ChannelGuard = (channel: string, kind: ChannelKind) => boolean;

export interface ShutdownHook {
  name: string;
  /** Milliseconds this step may take before the supervisor's timeout wins. */
  timeoutMs: number;
  run: () => Promise<void> | void;
}

export interface SidecarRpcOptions {
  input: Readable;
  output: Writable;
  /** Allowlist check. A rejected channel never reaches the handler. */
  isChannelAllowed: ChannelGuard;
  /** Wall-clock budget for the whole graceful shutdown, from the shell. */
  defaultShutdownTimeoutMs?: number;
}

interface PendingRpc {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * The sidecar half of the protocol.
 *
 * It owns three things and nothing else: framing, request correlation in both
 * directions, and the ordered shutdown. Channel policy, window bookkeeping and
 * service wiring live in `entry.ts` so this file stays testable without booting
 * LevelDB or the torrent engine.
 */
export class SidecarRpc extends EventEmitter {
  private readonly transport: JsonLineTransport;
  private readonly pendingRpc = new Map<string, PendingRpc>();
  private readonly shutdownHooks: ShutdownHook[] = [];
  private invokeHandler: InvokeHandler | null = null;
  private sendHandler: InvokeHandler | null = null;
  private nextRpcId = 1;
  private shuttingDown = false;
  private readonly createdAt = Date.now();
  private controlHandler: ((message: ControlMessage) => void) | null = null;

  constructor(private readonly options: SidecarRpcOptions) {
    super();
    this.transport = new JsonLineTransport(options.input, options.output);
  }

  /** Receives every `control` message except `ping`, which is answered here. */
  public setControlHandler(handler: (message: ControlMessage) => void): void {
    this.controlHandler = handler;
  }

  public get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Number of sidecar→shell requests still waiting for an answer. */
  public get pendingRpcCount(): number {
    return this.pendingRpc.size;
  }

  public onInvoke(handler: InvokeHandler): void {
    this.invokeHandler = handler;
  }

  public onSend(handler: InvokeHandler): void {
    this.sendHandler = handler;
  }

  public addShutdownHook(hook: ShutdownHook): void {
    this.shutdownHooks.push(hook);
  }

  /** Writes the `ready` line. Rust does not route traffic before it arrives. */
  public announceReady(): void {
    this.transport.write({
      type: "ready",
      protocolVersion: PROTOCOL_VERSION,
      pid: process.pid,
      bootMs: Date.now() - this.createdAt,
    });
  }

  public start(): void {
    this.transport.read((line) => this.handleLine(line));
    this.options.input.on("end", () =>
      this.rejectAllPending("sidecar_restarted")
    );
  }

  /** `webContents.send` replacement: fire and forget, broadcast by the shell. */
  public emitEvent(channel: string, payload: unknown): void {
    if (!this.options.isChannelAllowed(channel, "event")) {
      // A channel missing from the generated allowlist would otherwise reach
      // the renderer and be dropped by Rust, which is much harder to debug.
      process.stderr.write(
        `[sidecar] dropped event on non-allowlisted channel: ${channel}\n`
      );
      return;
    }

    this.transport.write({ type: "event", channel, payload });
  }

  /** Asks the shell to do something only the shell can do. */
  public request<T = unknown>(
    method: string,
    params: unknown = {}
  ): Promise<T> {
    if (this.shuttingDown) {
      return Promise.reject(
        Object.assign(new Error("Sidecar is shutting down"), {
          code: "shutting_down",
        })
      );
    }

    const id = String(this.nextRpcId++);

    return new Promise<T>((resolve, reject) => {
      this.pendingRpc.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.transport.write({ type: "rpc", id, method, params });
    });
  }

  /**
   * Runs the shutdown hooks in registration order, then reports the outcome.
   *
   * A hook that throws or exceeds its own budget is recorded in `failures` and
   * does not stop the remaining hooks: a stuck torrent flush must not prevent
   * LevelDB from closing. The caller is responsible for exiting the process.
   */
  public async shutdown(
    reason: string,
    timeoutMs = this.options.defaultShutdownTimeoutMs ?? 5_000
  ): Promise<string[]> {
    if (this.shuttingDown) return [];
    this.shuttingDown = true;

    const deadline = Date.now() + timeoutMs;
    const failures: string[] = [];

    for (const hook of this.shutdownHooks) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        failures.push(`${hook.name}: skipped, shutdown budget exhausted`);
        continue;
      }

      try {
        await withTimeout(
          Promise.resolve(hook.run()),
          Math.min(hook.timeoutMs, remaining),
          hook.name
        );
      } catch (error) {
        failures.push(
          `${hook.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    this.rejectAllPending("shutting_down");
    this.transport.write({ type: "shutdown-complete", reason, failures });
    await this.transport.flushAndWait();

    return failures;
  }

  private handleLine(line: string): void {
    let message: HostMessage;

    try {
      message = JSON.parse(line) as HostMessage;
    } catch (error) {
      this.transport.write({
        type: "error",
        id: "0",
        error: toWireError(error, "invalid_message"),
      });
      return;
    }

    switch (message.type) {
      case "invoke":
        void this.dispatch(message.id, message.channel, message.args, {
          channel: message.channel,
          windowLabel: message.windowLabel,
        });
        return;
      case "send":
        void this.dispatchSend(message.id, message.channel, message.args, {
          channel: message.channel,
          windowLabel: message.windowLabel,
        });
        return;
      case "rpc-result":
        this.resolveRpc(message);
        return;
      case "control":
        this.handleControl(message);
        return;
      default:
        this.transport.write({
          type: "error",
          id: "0",
          error: {
            code: "invalid_message",
            message: `Unknown message type: ${String(
              (message as { type?: unknown }).type
            )}`,
          },
        });
    }
  }

  private handleControl(message: ControlMessage): void {
    if (message.action === "ping") {
      this.transport.write({ type: "heartbeat", seq: message.seq });
      return;
    }

    this.controlHandler?.(message);
  }

  private resolveRpc(message: RpcResultMessage): void {
    const pending = this.pendingRpc.get(message.id);
    if (!pending) return;
    this.pendingRpc.delete(message.id);

    if (message.error) {
      pending.reject(wireErrorToError(message.error));
      return;
    }

    pending.resolve(message.result);
  }

  private async dispatch(
    id: string,
    channel: string,
    args: unknown[],
    context: InvokeContext
  ): Promise<void> {
    const failure = this.guard(channel, "invoke");
    if (failure) {
      this.transport.write({ type: "error", id, error: failure });
      return;
    }

    if (!this.invokeHandler) {
      this.transport.write({
        type: "error",
        id,
        error: {
          code: "handler_missing",
          message: `No invoke handler for ${channel}`,
        },
      });
      return;
    }

    try {
      const result = await this.invokeHandler(channel, args, context);
      this.transport.write({ type: "result", id, result: result ?? null });
    } catch (error) {
      this.transport.write({ type: "error", id, error: toWireError(error) });
    }
  }

  private async dispatchSend(
    id: string,
    channel: string,
    args: unknown[],
    context: InvokeContext
  ): Promise<void> {
    const failure = this.guard(channel, "send");
    if (failure) {
      this.transport.write({ type: "error", id, error: failure });
      return;
    }

    if (!this.sendHandler) return;

    try {
      await this.sendHandler(channel, args, context);
    } catch (error) {
      this.transport.write({ type: "error", id, error: toWireError(error) });
    }
  }

  private guard(channel: string, kind: ChannelKind): WireError | null {
    if (this.shuttingDown) {
      return {
        code: "shutting_down",
        message: `The background service is shutting down; ${channel} was not handled`,
      };
    }

    if (!this.options.isChannelAllowed(channel, kind)) {
      return {
        code: "channel_not_allowed",
        message: `channel_not_allowed: ${channel}`,
      };
    }

    return null;
  }

  private rejectAllPending(code: "sidecar_restarted" | "shutting_down"): void {
    for (const [id, pending] of this.pendingRpc) {
      this.pendingRpc.delete(id);
      pending.reject(
        Object.assign(
          new Error(
            code === "sidecar_restarted"
              ? `The background service restarted before ${pending.method} finished`
              : `The background service shut down before ${pending.method} finished`
          ),
          { code }
        )
      );
    }
  }
}

const wireErrorToError = (wire: WireError): Error => {
  const error = new Error(wire.message);
  error.name = wire.name ?? "Error";
  if (wire.stack) error.stack = wire.stack;
  return Object.assign(error, { code: wire.code });
};

const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    timer.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
