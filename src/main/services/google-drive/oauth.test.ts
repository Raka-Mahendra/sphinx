import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { GOOGLE_DRIVE_SCOPE } from "./config.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import {
  refreshGoogleDriveAccessToken,
  requestGoogleDriveAuthorization,
  revokeGoogleDriveToken,
} from "./oauth.ts";

const config = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "client-secret",
  configured: true,
};

const now = 1_700_000_000_000;

const tokenResponse = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: GOOGLE_DRIVE_SCOPE,
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

describe("Google Drive OAuth flow", () => {
  it("receives the loopback callback, validates state and exchanges the code", async () => {
    let resolveAuthorizationUrl: (url: string) => void = () => undefined;
    const authorizationUrl = new Promise<string>((resolve) => {
      resolveAuthorizationUrl = resolve;
    });
    let tokenRequestBody = "";

    const pending = requestGoogleDriveAuthorization(config, {
      fetch: async (input, init) => {
        assert.equal(String(input), "https://oauth2.googleapis.com/token");
        tokenRequestBody = String(init?.body ?? "");
        return tokenResponse();
      },
      openExternal: async (url) => resolveAuthorizationUrl(url),
      now: () => now,
      timeoutMs: 5_000,
    });

    const url = new URL(await authorizationUrl);
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal(url.searchParams.get("scope"), GOOGLE_DRIVE_SCOPE);

    const state = url.searchParams.get("state") ?? "";
    const callback = await fetch(
      `${redirectUri}?code=authorization-code&state=${encodeURIComponent(state)}`
    );
    assert.equal(callback.status, 200);

    const tokens = await pending;
    assert.equal(tokens.accessToken, "access-token");
    assert.equal(tokens.refreshToken, "refresh-token");
    assert.equal(tokens.expiresAt, now + 3_600_000);
    assert.equal(tokens.scope, GOOGLE_DRIVE_SCOPE);

    const body = new URLSearchParams(tokenRequestBody);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "authorization-code");
    assert.equal(body.get("redirect_uri"), redirectUri);
    assert.match(body.get("code_verifier") ?? "", /^[A-Za-z0-9_-]{43,128}$/);
  });

  it("rejects a callback whose state does not match", async () => {
    let resolveAuthorizationUrl: (url: string) => void = () => undefined;
    const authorizationUrl = new Promise<string>((resolve) => {
      resolveAuthorizationUrl = resolve;
    });

    const pending = requestGoogleDriveAuthorization(config, {
      fetch: async () => tokenResponse(),
      openExternal: async (url) => resolveAuthorizationUrl(url),
      timeoutMs: 5_000,
    });

    // Attach the rejection handler before the callback fires; the loopback
    // server settles the promise while `fetch` is still reading the reply.
    const rejection = assert.rejects(pending, (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "google_drive_state_mismatch"
      );
      return true;
    });

    const redirectUri =
      new URL(await authorizationUrl).searchParams.get("redirect_uri") ?? "";
    await fetch(`${redirectUri}?code=injected&state=wrong-state`);
    await rejection;
  });

  it("rejects a token that grants more than drive.appdata", async () => {
    let resolveAuthorizationUrl: (url: string) => void = () => undefined;
    const authorizationUrl = new Promise<string>((resolve) => {
      resolveAuthorizationUrl = resolve;
    });

    const pending = requestGoogleDriveAuthorization(config, {
      fetch: async () =>
        tokenResponse({
          scope: `${GOOGLE_DRIVE_SCOPE} https://www.googleapis.com/auth/drive`,
        }),
      openExternal: async (url) => resolveAuthorizationUrl(url),
      timeoutMs: 5_000,
    });

    const rejection = assert.rejects(pending, (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "google_drive_scope_mismatch"
      );
      return true;
    });

    const url = new URL(await authorizationUrl);
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    await fetch(
      `${redirectUri}?code=authorization-code&state=${encodeURIComponent(
        url.searchParams.get("state") ?? ""
      )}`
    );
    await rejection;
  });

  it("turns invalid_grant into a reconnect prompt", async () => {
    await assert.rejects(
      refreshGoogleDriveAccessToken(config, "dead-refresh-token", {
        fetch: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "google_drive_reconnect_required"
        );
        return true;
      }
    );
  });

  it("keeps the stored refresh token when Google does not return a new one", async () => {
    const tokens = await refreshGoogleDriveAccessToken(
      config,
      "stored-refresh-token",
      { fetch: async () => tokenResponse({ refresh_token: undefined }) }
    );
    assert.equal(tokens.refreshToken, "stored-refresh-token");
  });

  it("treats an already-invalid token as revoked", async () => {
    await revokeGoogleDriveToken("token", {
      fetch: async () =>
        new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 400,
        }),
    });
  });

  it("reports a server-side revoke failure", async () => {
    await assert.rejects(
      revokeGoogleDriveToken("token", {
        fetch: async () => new Response("boom", { status: 500 }),
      }),
      (error: unknown) =>
        (error as { code?: string }).code === "google_drive_revoke_failed"
    );
  });
});
