/**
 * The client `src/main` uses to ask the shell for something.
 *
 * In Electron, `src/main` *was* the shell. In the Tauri build it runs inside the
 * sidecar and the shell is a separate process, so anything only the shell can do
 * (installing an update, showing a native notification, writing the autostart
 * entry) goes through this one client.
 *
 * The implementation lives in the shim because that is where the RPC transport
 * is; this module exists so `src/main` does not reach into `src/sidecar` by
 * relative path, and so there is exactly one place to look when asking "what can
 * the sidecar ask the shell to do?" — the answer is `HOST_RPC_METHODS` in
 * `src-tauri/src/sidecar/protocol.rs`.
 */
export { hostRpc } from "@sidecar/electron-shim/host";
