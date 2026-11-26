import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIpcEvent } from "./ipc-event.ts";

describe("createIpcEvent", () => {
  it("exposes the sender's main frame so src/main can check the caller URL", () => {
    const sender = {
      mainFrame: { url: "https://release-v0-1-0.example.test/" },
    };

    const event = createIpcEvent(sender, 4242);

    assert.equal(
      event.senderFrame?.url,
      "https://release-v0-1-0.example.test/"
    );
    assert.equal(event.sender, sender);
    assert.equal(event.processId, 4242);
  });
});
