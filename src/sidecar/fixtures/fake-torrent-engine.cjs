/**
 * Stand-in for `hydra-native.node` in the sidecar's torrent tests.
 *
 * The real addon needs a Rust + MSVC build and libtorrent, so it does not exist
 * on every machine — but the properties Fase 6 must prove are *lifecycle*
 * properties, not libtorrent behaviour: one engine per sidecar, a request path,
 * an ordered `torrentShutdown`, and no second engine after a restart. Those are
 * observable with a module that keeps the same exotic resource libtorrent keeps:
 * an exclusive listen socket on the port it is given (5881 by default).
 *
 * The socket binds `127.0.0.1` rather than libtorrent's `0.0.0.0` so the test
 * never asks Windows Firewall for permission; exclusivity, which is what the
 * assertion needs, is identical.
 *
 * It is loaded only when `SPHINX_TEST_NATIVE_ADDON` points at it, which nothing
 * but `src/sidecar/torrent-engine.test.ts` does.
 */
const fs = require("node:fs");
const net = require("node:net");

const logFile = process.env.SPHINX_TEST_ENGINE_LOG;

const record = (event, detail = {}) => {
  const line = `${JSON.stringify({ event, pid: process.pid, ...detail })}\n`;

  if (logFile) fs.appendFileSync(logFile, line);
  else process.stderr.write(`[fake-engine] ${line}`);
};

record("loaded", { module: __filename });

let server = null;

exports.torrentInitialize = async (port) => {
  if (server) {
    record("initialize", { ok: true, port, reused: true });
    return;
  }

  try {
    server = await new Promise((resolve, reject) => {
      const candidate = net.createServer();

      candidate.once("error", (error) => {
        candidate.close();
        reject(error);
      });

      candidate.listen(port, "127.0.0.1", () => {
        // Like the N-API addon: the engine is not an event-loop handle of the
        // sidecar, so it must not keep the process alive on its own.
        candidate.unref();
        resolve(candidate);
      });
    });

    record("initialize", { ok: true, port });
  } catch (error) {
    record("initialize", {
      ok: false,
      port,
      code: error && error.code ? error.code : "unknown",
    });
    throw error;
  }
};

exports.torrentRequest = async (method, paramsJson) => {
  let params = {};

  try {
    params = JSON.parse(paramsJson);
  } catch {
    /* the baseline always sends JSON; a malformed value is the caller's bug */
  }

  record("request", { method, params });

  return JSON.stringify({ result: true });
};

exports.torrentShutdown = async () => {
  record("shutdown", { hasEngine: server !== null });

  if (!server) return;

  const closing = server;
  server = null;

  await new Promise((resolve) => closing.close(() => resolve()));
};

// The recovery scan enumerates processes through the same addon. An empty list
// is the honest answer for a torrent stand-in.
exports.listProcesses = () => [];
exports.getLinuxActiveWindow = () => null;
