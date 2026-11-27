import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";

import {
  reportBridgeFailure,
  reportBridgeSuccess,
  reportSidecarStatus,
  setSidecarRetry,
} from "./reconnect-indicator.ts";

const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: JSDOM;

function setGlobal(key: string, value: unknown) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

const indicator = (): HTMLElement | null =>
  document.getElementById("sphinx-bridge-status");

before(() => {
  dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });

  for (const key of ["window", "document", "Element", "Node"]) {
    setGlobal(key, (dom.window as unknown as Record<string, unknown>)[key]);
  }
});

after(() => {
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
  dom.window.close();
});

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe("reconnect indicator", () => {
  it("shows a retry button after the supervisor gives up", () => {
    reportSidecarStatus("gave-up");

    const node = indicator();
    assert.ok(node);
    assert.equal(node.dataset.visible, "true");

    const button = node.querySelector("button");
    assert.ok(button);
    assert.equal(button.textContent, "Coba lagi");
  });

  it("runs the retry handler once and leaves the button disabled", async () => {
    let calls = 0;
    setSidecarRetry(async () => {
      calls += 1;
    });

    reportSidecarStatus("gave-up");
    const button = indicator()?.querySelector("button");
    assert.ok(button);

    button.click();
    await Promise.resolve();

    assert.equal(calls, 1);
    // The terminal banner is replaced by the "starting" message.
    assert.equal(indicator()?.querySelector("button") ?? null, null);
  });

  it("returns to the gave-up state when the retry fails", async () => {
    setSidecarRetry(async () => {
      throw new Error("still down");
    });

    reportSidecarStatus("gave-up");
    const button = indicator()?.querySelector("button");
    assert.ok(button);

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
      indicator()?.querySelector("button")?.textContent,
      "Coba lagi"
    );
  });

  it("ignores error codes that are not transport failures", () => {
    reportBridgeFailure("channel_not_allowed");

    assert.equal(indicator(), null);
  });

  it("shows a transport failure and hides on the next success", () => {
    reportBridgeFailure("sidecar_restarted");

    assert.equal(indicator()?.dataset.visible, "true");

    reportBridgeSuccess();

    assert.equal(indicator()?.dataset.visible, "false");
  });

  it("hides after the shell reports ready", async () => {
    reportSidecarStatus("restarting");
    assert.equal(indicator()?.dataset.visible, "true");

    reportSidecarStatus("ready");
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.equal(indicator()?.dataset.visible, "false");
  });
});
