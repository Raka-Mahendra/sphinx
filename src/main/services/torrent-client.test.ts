import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TorrentClient,
  TorrentError,
  type TorrentBackend,
} from "./torrent-client.ts";

const backend = (overrides: Partial<TorrentBackend> = {}): TorrentBackend => ({
  initialize: async () => {},
  request: async () => '{"result":null}',
  shutdown: async () => {},
  ...overrides,
});

describe("native torrent client", () => {
  it("shares initialization and preserves null results", async () => {
    let starts = 0;
    const client = new TorrentClient(
      backend({
        initialize: async () => {
          starts++;
        },
      })
    );
    assert.deepEqual(
      await Promise.all([client.call("status"), client.call("status")]),
      [{ data: null }, { data: null }]
    );
    assert.equal(starts, 1);
    await client.shutdown();
  });

  it("preserves application error fields", async () => {
    const client = new TorrentClient(
      backend({
        request: async () =>
          '{"error":{"code":"metadata_timeout","message":"metadata_timeout"}}',
      })
    );
    await assert.rejects(client.call("torrent_files"), (e: TorrentError) => {
      assert.equal(e.code, "metadata_timeout");
      assert.equal(e.response.data.error, "metadata_timeout");
      return true;
    });
    await client.shutdown();
  });

  it("rejects pending calls on shutdown and ignores late results", async () => {
    let finish!: (value: string) => void;
    const client = new TorrentClient(
      backend({
        request: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      })
    );
    const pending = client.call("torrent_files");
    const rejected = assert.rejects(pending, { code: "torrent_shutdown" });
    await new Promise((resolve) => setImmediate(resolve));
    await client.shutdown();
    finish('{"result":{}}');
    await rejected;
    await assert.rejects(client.call("status"), { code: "torrent_shutdown" });
  });

  it("initializes on the baseline listen port and sends JSON params", async () => {
    // Fase 6 keeps the port and the request shape: 5881 is the BitTorrent
    // listener, not a local control port (`docs/torrent-audit.md` §3).
    const ports: number[] = [];
    const requests: { method: string; params: string }[] = [];
    const client = new TorrentClient(
      backend({
        initialize: async (port) => {
          ports.push(port);
        },
        request: async (method, params) => {
          requests.push({ method, params });
          return '{"result":true}';
        },
      })
    );

    await client.call("action", { action: "pause", id: "custom:game" });

    assert.deepEqual(ports, [5881]);
    assert.deepEqual(requests, [
      {
        method: "action",
        params: JSON.stringify({ action: "pause", id: "custom:game" }),
      },
    ]);

    await client.shutdown();
  });

  it("shuts the engine down once even when asked twice", async () => {
    let shutdowns = 0;
    const client = new TorrentClient(
      backend({
        shutdown: async () => {
          shutdowns++;
        },
      })
    );

    await client.initialize();
    await Promise.all([client.shutdown(), client.shutdown()]);

    assert.equal(shutdowns, 1);
  });

  it("waits for shutdown before explicit reinitialization", async () => {
    let stop!: () => void;
    let starts = 0;
    const client = new TorrentClient(
      backend({
        initialize: async () => {
          starts++;
        },
        shutdown: () =>
          new Promise<void>((resolve) => {
            stop = resolve;
          }),
      })
    );
    await client.initialize();
    const stopping = client.shutdown();
    const restarting = client.initialize();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(starts, 1);
    stop();
    await stopping;
    await restarting;
    assert.equal(starts, 2);
  });
});
