import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT,
  GOOGLE_OAUTH_REVOKE_ENDPOINT,
  GOOGLE_OAUTH_TOKEN_ENDPOINT,
  type GoogleDriveConfig,
} from "./config.js";
import {
  computeCodeChallenge,
  createCodeVerifier,
  createOAuthState,
} from "./pkce.js";

export class GoogleOAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

export interface GoogleDriveTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

export interface GoogleOAuthDependencies {
  fetch: typeof fetch;
  openExternal: (url: string) => Promise<void>;
  /** Milliseconds the loopback server waits for the browser callback. */
  timeoutMs?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_PATH = "/callback";

interface TokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const readPayload = async (response: Response): Promise<TokenPayload> => {
  try {
    return (await response.json()) as TokenPayload;
  } catch {
    return {};
  }
};

const describeError = (payload: TokenPayload, status: number) => {
  const code = typeof payload.error === "string" ? payload.error : "";
  const description =
    typeof payload.error_description === "string"
      ? payload.error_description
      : "";
  return [code, description].filter(Boolean).join(": ") || `HTTP ${status}`;
};

/**
 * Validates the token endpoint's answer.
 *
 * `refreshToken` is only required for the authorization-code exchange; a
 * refresh answers without a new one and must keep the stored value.
 */
const parseTokens = (
  payload: TokenPayload,
  { requireRefreshToken, now }: { requireRefreshToken: boolean; now: number }
): GoogleDriveTokens => {
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken =
    typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  const expiresIn =
    typeof payload.expires_in === "number" ? payload.expires_in : 0;
  const scope = typeof payload.scope === "string" ? payload.scope : "";

  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new GoogleOAuthError(
      "google_drive_invalid_token_response",
      "Google returned an unusable token response"
    );
  }

  const grantedScopes = scope.split(/\s+/).filter(Boolean);
  if (
    !grantedScopes.includes(GOOGLE_DRIVE_SCOPE) ||
    grantedScopes.some((value) => value !== GOOGLE_DRIVE_SCOPE)
  ) {
    // A token with more than drive.appdata must never be used: the app would
    // silently hold broader access than the consent screen promised.
    throw new GoogleOAuthError(
      "google_drive_scope_mismatch",
      `Google granted unexpected scopes: ${scope || "(none)"}`
    );
  }

  if (requireRefreshToken && !refreshToken) {
    throw new GoogleOAuthError(
      "google_drive_no_refresh_token",
      "Google did not return a refresh token; try connecting again"
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn * 1000,
    scope,
  };
};

export const buildAuthorizationUrl = ({
  config,
  redirectUri,
  state,
  codeChallenge,
}: {
  config: GoogleDriveConfig;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string => {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_DRIVE_SCOPE);
  // `offline` is what makes Google return a refresh token; `consent` forces it
  // on a repeat authorization, which Google otherwise skips.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
};

const exchangeAuthorizationCode = async (
  config: GoogleDriveConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  dependencies: GoogleOAuthDependencies
): Promise<GoogleDriveTokens> => {
  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const response = await dependencies.fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    throw new GoogleOAuthError(
      "google_drive_token_exchange_failed",
      describeError(payload, response.status)
    );
  }

  return parseTokens(payload, {
    requireRefreshToken: true,
    now: dependencies.now?.() ?? Date.now(),
  });
};

export const refreshGoogleDriveAccessToken = async (
  config: GoogleDriveConfig,
  refreshToken: string,
  dependencies: Pick<GoogleOAuthDependencies, "fetch" | "now">
): Promise<GoogleDriveTokens> => {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const response = await dependencies.fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await readPayload(response);

  if (!response.ok) {
    if (payload.error === "invalid_grant") {
      // The user revoked access, changed the password, or the token expired.
      // Treat it as "disconnected" so the UI can offer to connect again.
      throw new GoogleOAuthError(
        "google_drive_reconnect_required",
        "Google Drive access was revoked; connect it again"
      );
    }
    throw new GoogleOAuthError(
      "google_drive_refresh_failed",
      describeError(payload, response.status)
    );
  }

  const parsed = parseTokens(payload, {
    requireRefreshToken: false,
    now: dependencies.now?.() ?? Date.now(),
  });
  return { ...parsed, refreshToken };
};

export const revokeGoogleDriveToken = async (
  token: string,
  dependencies: Pick<GoogleOAuthDependencies, "fetch">
): Promise<void> => {
  const response = await dependencies.fetch(GOOGLE_OAUTH_REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  // `400 invalid_token` means it was already invalid, which is the state we
  // wanted. Only a 5xx is worth reporting.
  if (response.status >= 500) {
    throw new GoogleOAuthError(
      "google_drive_revoke_failed",
      `Google could not revoke the token (HTTP ${response.status})`
    );
  }
};

interface LoopbackServer {
  redirectUri: string;
  code: Promise<string>;
  close: () => void;
}

/**
 * One-shot loopback listener for the OAuth redirect.
 *
 * Port 0 lets the OS pick a free port, and the server exists only for this
 * login: the caller closes it in a `finally` (PRD §4.F). The callback is bound
 * to `state`, so another local process cannot inject a code.
 */
const startLoopbackServer = async (
  expectedState: string,
  timeoutMs: number
): Promise<LoopbackServer> => {
  let settleCode: (code: string) => void = () => undefined;
  let failCode: (error: Error) => void = () => undefined;
  const code = new Promise<string>((resolve, reject) => {
    settleCode = resolve;
    failCode = reject;
  });

  const server = createServer((request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    );
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }

    const fail = (errorCode: string, message: string) => {
      response.writeHead(400, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(message);
      failCode(new GoogleOAuthError(errorCode, message));
    };

    if (url.searchParams.get("state") !== expectedState) {
      fail(
        "google_drive_state_mismatch",
        "The Google sign-in response did not match this request"
      );
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      fail("google_drive_access_denied", `Google returned ${error}`);
      return;
    }

    const authorizationCode = url.searchParams.get("code");
    if (!authorizationCode) {
      fail(
        "google_drive_callback_invalid",
        "Google did not return an authorization code"
      );
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><meta charset=utf-8><title>Sphinx</title>" +
        "<p>Google Drive connected. You can close this tab and return to Sphinx.</p>"
    );
    settleCode(authorizationCode);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) =>
      reject(
        new GoogleOAuthError("google_drive_loopback_failed", error.message)
      )
    );
    server.listen(0, "127.0.0.1", resolve);
  }).catch((error: Error) => {
    server.close();
    throw error;
  });

  const port = (server.address() as AddressInfo).port;
  const timer = setTimeout(() => {
    failCode(
      new GoogleOAuthError(
        "google_drive_login_timeout",
        "Google sign-in timed out before the browser returned"
      )
    );
  }, timeoutMs);
  timer.unref?.();

  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    code,
    close: () => {
      clearTimeout(timer);
      server.closeAllConnections();
      server.close();
    },
  };
};

/**
 * Runs the full Authorization Code + PKCE (S256) flow with a loopback redirect.
 *
 * The browser is the system browser; nothing here opens a webview. The token
 * exchange only happens after the loopback server saw the matching `state`.
 */
export const requestGoogleDriveAuthorization = async (
  config: GoogleDriveConfig,
  dependencies: GoogleOAuthDependencies
): Promise<GoogleDriveTokens> => {
  if (!config.configured) {
    throw new GoogleOAuthError(
      "google_drive_not_configured",
      "Google Drive is not configured in this build"
    );
  }

  const codeVerifier = createCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const state = createOAuthState();
  const loopback = await startLoopbackServer(
    state,
    dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    await dependencies.openExternal(
      buildAuthorizationUrl({
        config,
        redirectUri: loopback.redirectUri,
        state,
        codeChallenge,
      })
    );
    const code = await loopback.code;
    return await exchangeAuthorizationCode(
      config,
      code,
      codeVerifier,
      loopback.redirectUri,
      dependencies
    );
  } finally {
    loopback.close();
  }
};
