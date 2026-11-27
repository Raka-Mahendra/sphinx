import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRegisteredUrl } from "./url.ts";

describe("resolveRegisteredUrl", () => {
  it("returns an absolute URL unchanged", () => {
    assert.equal(
      resolveRegisteredUrl("http://localhost:5173/#/big-picture", null),
      "http://localhost:5173/#/big-picture"
    );
  });

  it("resolves a bundle-relative route against the packaged app base", () => {
    assert.equal(
      resolveRegisteredUrl(
        "index.html#/big-picture",
        "http://tauri.localhost/"
      ),
      "http://tauri.localhost/index.html#/big-picture"
    );
  });

  it("returns the relative path when the base is not known yet", () => {
    assert.equal(
      resolveRegisteredUrl("index.html#/big-picture", null),
      "index.html#/big-picture"
    );
  });

  it("returns an empty string when nothing was registered", () => {
    assert.equal(resolveRegisteredUrl(null, "http://tauri.localhost/"), "");
  });
});
