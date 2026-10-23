import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { InternalAxiosRequestConfig } from "axios";

interface RecordedRequest {
  method?: string;
  url?: string;
  data: unknown;
  authorization: unknown;
}

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-api-public-"));
  const key = "__hydraPublicTest" + Math.random().toString(36).slice(2);
  const globals = globalThis as unknown as Record<string, unknown>;

  const requests: RecordedRequest[] = [];
  const logs: unknown[][] = [];
  const harness = {
    adapter: async (config: InternalAxiosRequestConfig) => {
      requests.push({
        method: config.method,
        url: config.url,
        data:
          typeof config.data === "string"
            ? JSON.parse(config.data)
            : config.data,
        authorization:
          (config.headers as Record<string, unknown> | undefined)
            ?.Authorization ?? null,
      });
      return {
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    },
  };
  const logger = Object.fromEntries(
    ["log", "info", "error", "debug"].map((method) => [
      method,
      (...args: unknown[]) => logs.push(args),
    ])
  );
  globals[key] = { harness, logger };

  t.after(async () => {
    delete globals[key];
    await fs.rm(root, { recursive: true, force: true });
  });

  const stubs: Record<string, string> = {
    "@main/constants": "export const appVersion = 'test';",
    "./logger":
      "export const logger = globalThis[key].logger; export const networkLogger = globalThis[key].logger;",
    "@shared":
      "export class FeatureUnavailableError extends Error { constructor(feature) { super('feature_unavailable'); this.name = 'FeatureUnavailableError'; this.code = 'feature_unavailable'; this.feature = feature; } }",
    axios:
      "import realAxios from 'real-axios'; export default { create: (options) => realAxios.create({ ...options, adapter: globalThis[key].harness.adapter }) };",
  };

  const bundlePath = path.join(root, "hydra-api-public.mjs");
  await build({
    stdin: {
      contents: "export { HydraApi } from './hydra-api';",
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      loader: "ts",
    },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define: {
      "import.meta.env.MAIN_VITE_API_URL": JSON.stringify(
        "http://localhost:3000"
      ),
    },
    plugins: [
      {
        name: "environment",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "real-axios")
              return { path: import.meta.resolve("axios"), external: true };
            if (Object.hasOwn(stubs, args.path))
              return { path: args.path, namespace: "test" };
            return undefined;
          });
          builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            contents:
              "const key = " + JSON.stringify(key) + "; " + stubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });

  const { HydraApi } = (await import(pathToFileURL(bundlePath).href)) as {
    HydraApi: typeof import("./hydra-api").HydraApi;
  };
  await HydraApi.setupApi();

  return { api: HydraApi, requests, logs };
}

const expectFeatureUnavailable =
  (flag: string) =>
  (error: unknown): boolean => {
    assert.ok(error instanceof Error);
    assert.equal((error as { code?: string }).code, "feature_unavailable");
    assert.equal((error as { feature?: string }).feature, flag);
    return true;
  };

test("anonymous build exposes no account identity", async (t) => {
  const f = await fixture(t);

  assert.equal(f.api.getAuthContext(), null);
  assert.equal(f.api.isLoggedIn(), false);
  assert.equal(f.api.hasActiveSubscription(), false);
});

test("default requests fail closed as HYDRA_ACCOUNT_FEATURES", async (t) => {
  const f = await fixture(t);

  await assert.rejects(
    () => f.api.get("/profile/me"),
    expectFeatureUnavailable("HYDRA_ACCOUNT_FEATURES")
  );
  await assert.rejects(
    () => f.api.get("/profile/download-sources"),
    expectFeatureUnavailable("HYDRA_ACCOUNT_FEATURES")
  );
  assert.equal(f.requests.length, 0, "no HTTP request may leave the process");
});

test("auth or subscription options fail closed even when explicitly requested", async (t) => {
  const f = await fixture(t);

  await assert.rejects(
    () => f.api.get("/profile/me", undefined, { needsAuth: true }),
    expectFeatureUnavailable("HYDRA_ACCOUNT_FEATURES")
  );
  await assert.rejects(
    () =>
      f.api.get("/profile/cloud-saves", undefined, {
        needsAuth: false,
        needsSubscription: true,
      }),
    expectFeatureUnavailable("HYDRA_ACCOUNT_FEATURES")
  );
  await assert.rejects(
    () => f.api.checkDownloadSourcesChanges([], [], "2026-01-01"),
    expectFeatureUnavailable("HYDRA_ACCOUNT_FEATURES")
  );
  assert.equal(f.requests.length, 0);
});

test("explicit public requests reach the API without credentials", async (t) => {
  const f = await fixture(t);

  const assets = await f.api.get("/games/steam/620/assets", undefined, {
    needsAuth: false,
  });
  assert.deepEqual(assets, { ok: true });

  const search = await f.api.post(
    "/catalogue/search",
    { query: "sphinx" },
    { needsAuth: false }
  );
  assert.deepEqual(search, { ok: true });

  assert.deepEqual(
    f.requests.map((request) => [request.method, request.url]),
    [
      ["get", "/games/steam/620/assets"],
      ["post", "/catalogue/search"],
    ]
  );
  assert.deepEqual(
    f.requests.map((request) => request.authorization),
    [null, null],
    "anonymous requests must not carry an Authorization header"
  );
});

test("auth-surface methods are inert no-ops", async (t) => {
  const f = await fixture(t);

  await assert.rejects(
    () => f.api.handleExternalAuth("hydra://auth?payload=secret"),
    expectFeatureUnavailable("HYDRA_ACCOUNT_FEATURES")
  );
  await assert.rejects(
    () => f.api.refreshToken(),
    expectFeatureUnavailable("HYDRA_ACCOUNT_FEATURES")
  );
  await f.api.handleSignOut();
  f.api.persistUserCache();
  f.api.updateUserSubscription();
  assert.equal(f.requests.length, 0);
});
