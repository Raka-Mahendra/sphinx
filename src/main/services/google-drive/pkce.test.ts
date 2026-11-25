import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { GOOGLE_DRIVE_SCOPE } from "./config.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildAuthorizationUrl,
  requestGoogleDriveAuthorization,
} from "./oauth.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { computeCodeChallenge, createCodeVerifier } from "./pkce.ts";

describe("Google Drive PKCE", () => {
  it("matches the RFC 7636 S256 test vector", () => {
    assert.equal(
      computeCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("produces a verifier within the RFC length and charset", () => {
    const verifier = createCodeVerifier();
    assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.notEqual(verifier, createCodeVerifier());
  });

  it("requests only drive.appdata with offline access and S256", () => {
    const url = new URL(
      buildAuthorizationUrl({
        config: {
          clientId: "client.apps.googleusercontent.com",
          clientSecret: "",
          configured: true,
        },
        redirectUri: "http://127.0.0.1:49152/callback",
        state: "state-value",
        codeChallenge: "challenge-value",
      })
    );

    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("scope"), GOOGLE_DRIVE_SCOPE);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), "state-value");
    assert.equal(
      url.searchParams.get("client_id"),
      "client.apps.googleusercontent.com"
    );
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://127.0.0.1:49152/callback"
    );
    assert.equal(url.searchParams.get("prompt"), "consent");
  });

  it("refuses to start without a build-time client id", async () => {
    await assert.rejects(
      requestGoogleDriveAuthorization(
        { clientId: "", clientSecret: "", configured: false },
        {
          fetch,
          openExternal: async () => undefined,
        }
      ),
      (error: unknown) =>
        (error as { code?: string }).code === "google_drive_not_configured"
    );
  });
});
