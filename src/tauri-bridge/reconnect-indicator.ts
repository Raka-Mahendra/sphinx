/**
 * "Reconnecting" indicator for the bridge.
 *
 * When the sidecar dies, every in-flight `invoke` is rejected with
 * `sidecar_restarted`. The renderer has no place to show that: the preload is
 * reused unchanged, so no component knows about the sidecar. The bridge
 * therefore owns one small, dependency-free DOM element that appears when a call
 * fails for a transport reason and disappears on the next successful call or
 * when the shell reports `ready` again.
 *
 * It is deliberately outside React: the main window and Big Picture both load
 * this module, and a React tree would need a provider in two apps.
 */

const STYLE_ID = "sphinx-bridge-status-style";
const ELEMENT_ID = "sphinx-bridge-status";

const TRANSPORT_CODES = new Set([
  "sidecar_restarted",
  "sidecar_starting",
  "sidecar_unavailable",
  "request_timeout",
]);

const MESSAGES: Record<string, string> = {
  sidecar_restarted: "Menyambung ulang ke layanan latar…",
  sidecar_starting: "Menyalakan layanan latar…",
  sidecar_unavailable: "Layanan latar berhenti. Buka ulang aplikasi.",
  request_timeout: "Layanan latar tidak menjawab. Menyambung ulang…",
};

let hideTimer: ReturnType<typeof setTimeout> | null = null;

const ensureStyle = (): void => {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ELEMENT_ID} {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-radius: 999px;
      background: rgba(24, 24, 24, 0.94);
      color: #f2f2f2;
      font: 500 13px/1.2 "Noto Sans", system-ui, sans-serif;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.12);
      pointer-events: none;
      opacity: 0;
      transition: opacity 160ms ease;
    }
    #${ELEMENT_ID}[data-visible="true"] { opacity: 1; }
    #${ELEMENT_ID}::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #e0b341;
      animation: sphinx-bridge-pulse 1.1s ease-in-out infinite;
    }
    @keyframes sphinx-bridge-pulse {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 1; }
    }
  `;

  document.head.appendChild(style);
};

const element = (): HTMLElement => {
  ensureStyle();

  const existing = document.getElementById(ELEMENT_ID);
  if (existing) return existing;

  const created = document.createElement("div");
  created.id = ELEMENT_ID;
  created.dataset.visible = "false";
  created.setAttribute("role", "status");
  created.setAttribute("aria-live", "polite");
  document.body.appendChild(created);

  return created;
};

const show = (code: string): void => {
  if (typeof document === "undefined" || !document.body) return;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  const node = element();
  node.textContent = MESSAGES[code] ?? MESSAGES.sidecar_restarted;
  node.dataset.visible = "true";
};

const hide = (): void => {
  if (typeof document === "undefined") return;

  const node = document.getElementById(ELEMENT_ID);
  if (!node) return;

  node.dataset.visible = "false";
};

/** Called by the bridge after a failed `invoke`. */
export const reportBridgeFailure = (code: string | undefined): void => {
  if (!code || !TRANSPORT_CODES.has(code)) return;
  show(code);
};

/** Called by the bridge after a successful `invoke`. */
export const reportBridgeSuccess = (): void => {
  hide();
};

/** Called from the shell's `sphinx:sidecar-status` events. */
export const reportSidecarStatus = (status: string | undefined): void => {
  if (status === "ready") {
    // A short delay keeps the banner from flickering on a fast restart.
    hideTimer = setTimeout(hide, 400);
    return;
  }

  if (status === "gave-up") {
    show("sidecar_unavailable");
    return;
  }

  if (status === "restarting" || status === "starting") {
    show("sidecar_restarted");
  }
};
