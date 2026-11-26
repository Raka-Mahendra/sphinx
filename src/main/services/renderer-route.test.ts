import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rendererRouteUrl } from "./renderer-route.ts";

describe("rendererRouteUrl", () => {
  it("keeps the Big Picture route in the packaged build", () => {
    assert.equal(rendererRouteUrl("big-picture"), "index.html#/big-picture");
  });

  it("keeps a library route with a query in the packaged build", () => {
    assert.equal(
      rendererRouteUrl("theme-editor?themeId=abc"),
      "index.html#/theme-editor?themeId=abc"
    );
  });

  it("uses the dev server when one is configured", () => {
    assert.equal(
      rendererRouteUrl("friends-window", "http://localhost:5173"),
      "http://localhost:5173#/friends-window"
    );
  });
});
