/**
 * Tests for `lib/sidecar-env.mjs`.
 *
 * Regression guard for the CI-only boot failure: a sidecar built without `.env`
 * left `import.meta.env.MAIN_VITE_API_URL` undefined, `src/main/constants.ts`
 * threw at load, and the sidecar answered every invoke with
 * "No handler registered for 'ping'".
 *
 * Run with `yarn test` or
 * `node --test scripts/sidecar-env.test.mjs`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildEnvDefines,
  collectEnvKeys,
  parseEnvFile,
} from "./lib/sidecar-env.mjs";

describe("parseEnvFile", () => {
  test("reads KEY=value lines and drops quotes", () => {
    const env = parseEnvFile(
      ['MAIN_VITE_API_URL="https://api.test"', "RENDERER_VITE_X='y'"].join("\n")
    );

    assert.equal(env.MAIN_VITE_API_URL, "https://api.test");
    assert.equal(env.RENDERER_VITE_X, "y");
  });

  test("ignores comments, blanks and non-uppercase keys", () => {
    const env = parseEnvFile("# comment\n\nlower_case=1\nEMPTY=");

    assert.deepEqual(env, { EMPTY: "" });
  });
});

describe("collectEnvKeys", () => {
  test("finds configurable keys and ignores esbuild's own", () => {
    const keys = collectEnvKeys([
      "const a = import.meta.env.MAIN_VITE_API_URL;",
      "const b = import.meta.env.RENDERER_VITE_TORBOX_REFERRAL_CODE;",
      "const c = import.meta.env.DEV;",
      "const d = import.meta.env.MODE;",
    ]);

    assert.deepEqual([...keys].sort(), [
      "MAIN_VITE_API_URL",
      "RENDERER_VITE_TORBOX_REFERRAL_CODE",
    ]);
  });

  test("deduplicates a key used in several files", () => {
    const keys = collectEnvKeys([
      "import.meta.env.MAIN_VITE_API_URL",
      "import.meta.env.MAIN_VITE_API_URL",
    ]);

    assert.deepEqual([...keys], ["MAIN_VITE_API_URL"]);
  });
});

describe("buildEnvDefines", () => {
  test("defines a missing key as an empty string, never leaves it out", () => {
    const defines = buildEnvDefines({
      keys: new Set(["MAIN_VITE_API_URL", "MAIN_VITE_AUTH_URL"]),
      env: { MAIN_VITE_AUTH_URL: "https://auth.test" },
    });

    assert.deepEqual(defines, {
      "import.meta.env.MAIN_VITE_API_URL": '""',
      "import.meta.env.MAIN_VITE_AUTH_URL": '"https://auth.test"',
    });
  });

  test('a configured value wins over the "" default', () => {
    const defines = buildEnvDefines({
      keys: new Set(["MAIN_VITE_API_URL"]),
      env: { MAIN_VITE_API_URL: "https://api.staging.test" },
    });

    assert.equal(
      defines["import.meta.env.MAIN_VITE_API_URL"],
      '"https://api.staging.test"'
    );
  });
});
