import { createHash, randomBytes } from "node:crypto";

/**
 * RFC 7636 §4.1: the verifier is 43-128 characters from the unreserved set.
 * 64 random bytes base64url-encoded produce 86 characters.
 */
export const createCodeVerifier = (): string =>
  randomBytes(64).toString("base64url");

/** RFC 7636 §4.2: `BASE64URL(SHA256(ASCII(verifier)))`. */
export const computeCodeChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

/**
 * `state` only needs to be unguessable; 32 bytes is plenty and keeps the
 * authorization URL short.
 */
export const createOAuthState = (): string =>
  randomBytes(32).toString("base64url");
