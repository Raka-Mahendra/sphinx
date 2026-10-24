/**
 * `node:crypto` replacement for the renderer bundle.
 *
 * `src/preload/index.ts` imports `randomUUID` for cloud-save operation ids. The
 * renderer has no Node built-ins, and Vite aliases `node:crypto` to this file.
 * `crypto.randomUUID()` is used when the webview exposes it (all Tauri webviews
 * are secure contexts) and a manual v4 generator covers the rest.
 */
export const randomUUID = (): string => {
  const webCrypto = globalThis.crypto;

  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 version 4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
};
