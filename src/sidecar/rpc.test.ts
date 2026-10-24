import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { afterEach, describe, it } from "node:test";

import { SidecarRpc, type InvokeContext } from "./rpc.ts";
import type { SidecarMessage } from "./protocol.ts";

/**
 * Tests for the protocol core, without LevelDB, the torrent engine or a shell.
 *
 * The transport is a pair of `PassThrough` streams standing in for
 * stdin/stdout, so every assertion is about the wire format the Rust supervisor
 * will actually parse.
 */

class Harness {
  public readonly hostToSidecar = new PassThrough();
  public readonly sidecarToHost = new PassThrough();
  public readonly received: SidecarMessage[] = [];
  public readonly rpc: SidecarRpc;
  private waiters: {
    predicate: (message: SidecarMessage) => boolean;
    resolve: (message: SidecarMessage) => void;
  }[] = [];
  private buffer = "";

  constructor(
    isChannelAllowed: (channel: string, kind: string) => boolean = () => true
  ) {
    this.sidecarToHost.setEncoding("utf8");
    this.sidecarToHost.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf("\n");

      while (index !== -1) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        index = this.buffer.indexOf("\n");

        if (!line.trim()) continue;

        const message = JSON.parse(line) as SidecarMessage;
        this.received.push(message);
        this.flushWaiters(message);
      }
    });

    this.rpc = new SidecarRpc({
      input: this.hostToSidecar,
      output: this.sidecarToHost,
      isChannelAllowed: isChannelAllowed as never,
      defaultShutdownTimeoutMs: 1_000,
    });
  }

  public send(message: unknown): void {
    this.hostToSidecar.write(`${JSON.stringify(message)}\n`);
  }

  public waitFor(
    predicate: (message: SidecarMessage) => boolean,
    timeoutMs = 2_000
  ): Promise<SidecarMessage> {
    const existing = this.received.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for a sidecar message"));
      }, timeoutMs);

      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  private flushWaiters(message: SidecarMessage): void {
    this.waiters = this.waiters.filter((waiter) => {
      if (!waiter.predicate(message)) return true;
      waiter.resolve(message);
      return false;
    });
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("SidecarRpc", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) {
      harness.hostToSidecar.end();
    }
  });

  const create = (allowed?: (channel: string, kind: string) => boolean) => {
    const harness = new Harness(allowed);
    harness.rpc.start();
    harnesses.push(harness);
    return harness;
  };

  it("answers invoke with a result", async () => {
    const harness = create();

    harness.rpc.onInvoke(async (channel, args, context: InvokeContext) => {
      assert.equal(channel, "ping");
      assert.deepEqual(args, ["a", 1]);
      assert.equal(context.windowLabel, "main");
      return "pong";
    });

    harness.send({
      type: "invoke",
      id: "7",
      channel: "ping",
      args: ["a", 1],
      windowLabel: "main",
    });

    const message = await harness.waitFor(
      (candidate) => candidate.type === "result"
    );
    assert.deepEqual(message, { type: "result", id: "7", result: "pong" });
  });

  it("turns a thrown handler into a handler_error with the original name", async () => {
    const harness = create();

    harness.rpc.onInvoke(async () => {
      throw new TypeError("nope");
    });

    harness.send({
      type: "invoke",
      id: "8",
      channel: "explode",
      args: [],
      windowLabel: null,
    });

    const message = await harness.waitFor(
      (candidate) => candidate.type === "error"
    );
    assert.equal(message.type, "error");
    if (message.type !== "error") return;

    assert.equal(message.id, "8");
    assert.equal(message.error.code, "handler_error");
    assert.equal(message.error.message, "nope");
    assert.equal(message.error.name, "TypeError");
  });

  it("refuses a channel the allowlist does not contain", async () => {
    const harness = create((channel) => channel === "allowed");

    let called = false;
    harness.rpc.onInvoke(async () => {
      called = true;
      return null;
    });

    harness.send({
      type: "invoke",
      id: "9",
      channel: "forbidden",
      args: [],
      windowLabel: null,
    });

    const message = await harness.waitFor(
      (candidate) => candidate.type === "error"
    );
    assert.equal(message.type, "error");
    if (message.type !== "error") return;

    assert.equal(message.error.code, "channel_not_allowed");
    assert.equal(
      called,
      false,
      "the handler must not run for a refused channel"
    );
  });

  it("reports a missing handler instead of answering null", async () => {
    const harness = create();

    harness.send({
      type: "invoke",
      id: "10",
      channel: "registered-but-unhandled",
      args: [],
      windowLabel: null,
    });

    const message = await harness.waitFor(
      (candidate) => candidate.type === "error"
    );
    assert.equal(message.type, "error");
    if (message.type !== "error") return;
    assert.equal(message.error.code, "handler_missing");
  });

  it("emits events with the argument array preserved", async () => {
    const harness = create();

    harness.rpc.emitEvent("on-download-progress", [{ id: 1 }, "second"]);

    const message = await harness.waitFor(
      (candidate) => candidate.type === "event"
    );
    assert.deepEqual(message, {
      type: "event",
      channel: "on-download-progress",
      payload: [{ id: 1 }, "second"],
    });
  });

  it("drops events on a channel the allowlist does not contain", async () => {
    const harness = create((_channel, kind) => kind !== "event");

    harness.rpc.emitEvent("on-not-allowed", []);

    await settle();
    assert.equal(
      harness.received.some((message) => message.type === "event"),
      false
    );
  });

  it("calls the shell and resolves with the shell's answer", async () => {
    const harness = create();

    const pending = harness.rpc.request<string>("dialog.showOpenDialog", {
      title: "pick",
    });

    const request = await harness.waitFor(
      (candidate) => candidate.type === "rpc"
    );
    assert.equal(request.type, "rpc");
    if (request.type !== "rpc") return;

    assert.equal(request.method, "dialog.showOpenDialog");
    assert.deepEqual(request.params, { title: "pick" });

    harness.send({
      type: "rpc-result",
      id: request.id,
      result: { canceled: false, filePaths: ["C:/games"] },
    });

    assert.deepEqual(await pending, {
      canceled: false,
      filePaths: ["C:/games"],
    });
  });

  it("rejects the shell request when the shell reports an error", async () => {
    const harness = create();

    const pending = harness.rpc.request("keychain.get", { account: "drive" });

    const request = await harness.waitFor(
      (candidate) => candidate.type === "rpc"
    );
    if (request.type !== "rpc") throw new Error("expected an rpc message");

    harness.send({
      type: "rpc-result",
      id: request.id,
      error: { code: "keychain_failed", message: "locked" },
    });

    await assert.rejects(pending, (error: Error & { code?: string }) => {
      assert.equal(error.message, "locked");
      assert.equal(error.code, "keychain_failed");
      return true;
    });
  });

  it("answers ping with a heartbeat", async () => {
    const harness = create();

    harness.send({ type: "control", action: "ping", seq: 4 });

    const message = await harness.waitFor(
      (candidate) => candidate.type === "heartbeat"
    );
    assert.deepEqual(message, { type: "heartbeat", seq: 4 });
  });

  it("runs shutdown hooks in order and reports failures without stopping", async () => {
    const harness = create();
    const order: string[] = [];

    harness.rpc.addShutdownHook({
      name: "first",
      timeoutMs: 500,
      run: () => {
        order.push("first");
      },
    });

    harness.rpc.addShutdownHook({
      name: "second",
      timeoutMs: 500,
      run: () => {
        order.push("second");
        throw new Error("boom");
      },
    });

    harness.rpc.addShutdownHook({
      name: "third",
      timeoutMs: 500,
      run: () => {
        order.push("third");
      },
    });

    const failures = await harness.rpc.shutdown("test", 5_000);

    assert.deepEqual(order, ["first", "second", "third"]);
    assert.equal(failures.length, 1);
    assert.match(failures[0] ?? "", /^second: boom$/);

    const message = await harness.waitFor(
      (candidate) => candidate.type === "shutdown-complete"
    );
    assert.equal(message.type, "shutdown-complete");
  });

  it("refuses new work once shutting down", async () => {
    const harness = create();
    await harness.rpc.shutdown("test", 1_000);

    harness.send({
      type: "invoke",
      id: "11",
      channel: "ping",
      args: [],
      windowLabel: null,
    });

    const message = await harness.waitFor(
      (candidate) => candidate.type === "error"
    );
    assert.equal(message.type, "error");
    if (message.type !== "error") return;
    assert.equal(message.error.code, "shutting_down");
  });

  it("reports an unparseable line as invalid_message", async () => {
    const harness = create();

    harness.hostToSidecar.write("not json\n");

    const message = await harness.waitFor(
      (candidate) => candidate.type === "error"
    );
    assert.equal(message.type, "error");
    if (message.type !== "error") return;
    assert.equal(message.error.code, "invalid_message");
  });
});
