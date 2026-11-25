import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { GoogleDriveClient, GoogleDriveError } from "./drive-client.ts";

interface RecordedRequest {
  method: string;
  url: URL;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

type Handler = (
  request: RecordedRequest,
  response: ServerResponse
) => void | Promise<void>;

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const startServer = async (handler: Handler) => {
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    await handler(
      {
        method: request.method ?? "GET",
        url: new URL(request.url ?? "/", "http://127.0.0.1"),
        headers: request.headers,
        body,
      },
      response
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

const createClient = (
  base: string,
  overrides: Partial<ConstructorParameters<typeof GoogleDriveClient>[0]> = {}
) => {
  let refreshCalls = 0;
  const sleeps: number[] = [];
  const client = new GoogleDriveClient({
    getAccessToken: async () => "access-token",
    refreshAccessToken: async () => {
      refreshCalls += 1;
    },
    fetch,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    random: () => 0.5,
    apiBaseUrl: base,
    uploadBaseUrl: base,
    ...overrides,
  });
  return { client, sleeps, refreshCalls: () => refreshCalls };
};

describe("Google Drive REST client", () => {
  it("lists app data with partial fields and a large page size", async () => {
    let captured: RecordedRequest | null = null;
    const server = await startServer((request, response) => {
      captured = request;
      json(response, 200, { files: [{ id: "file-1", name: "a" }] });
    });

    try {
      const { client } = createClient(server.base);
      const page = await client.listFiles({
        q: "trashed = false",
        fields: "id,name",
      });
      assert.equal(page.files[0].id, "file-1");

      assert.ok(captured);
      const request = captured as RecordedRequest;
      assert.equal(request.url.searchParams.get("spaces"), "appDataFolder");
      assert.equal(request.url.searchParams.get("pageSize"), "1000");
      assert.equal(request.url.searchParams.get("q"), "trashed = false");
      assert.equal(
        request.url.searchParams.get("fields"),
        "nextPageToken,files(id,name)"
      );
      assert.equal(request.headers.authorization, "Bearer access-token");
    } finally {
      await server.close();
    }
  });

  it("follows pagination until nextPageToken is gone", async () => {
    let calls = 0;
    const server = await startServer((_request, response) => {
      calls += 1;
      json(
        response,
        200,
        calls === 1
          ? { files: [{ id: "a", name: "a" }], nextPageToken: "next" }
          : { files: [{ id: "b", name: "b" }] }
      );
    });

    try {
      const { client } = createClient(server.base);
      const files = await client.listAllFiles("trashed = false", "id,name");
      assert.deepEqual(
        files.map((file) => file.id),
        ["a", "b"]
      );
      assert.equal(calls, 2);
    } finally {
      await server.close();
    }
  });

  it("uploads small files as multipart/related", async () => {
    let captured: RecordedRequest | null = null;
    const server = await startServer((request, response) => {
      captured = request;
      json(response, 200, { id: "manifest-1", name: "1.json" });
    });

    try {
      const { client } = createClient(server.base);
      const file = await client.uploadFile({
        name: "1.json",
        parents: ["snapshots"],
        appProperties: { app: "sphinx", version: "1" },
        mimeType: "application/json",
        body: Buffer.from('{"version":1}'),
      });

      assert.equal(file.id, "manifest-1");
      assert.ok(captured);
      const request = captured as RecordedRequest;
      assert.equal(request.method, "POST");
      assert.equal(request.url.searchParams.get("uploadType"), "multipart");
      assert.match(
        request.headers["content-type"] ?? "",
        /^multipart\/related; boundary=/
      );
      const body = request.body.toString("utf8");
      assert.match(body, /Content-Type: application\/json; charset=UTF-8/);
      assert.match(body, /"appProperties":\{"app":"sphinx","version":"1"\}/);
      assert.match(body, /\{"version":1\}/);
    } finally {
      await server.close();
    }
  });

  it("uploads large files through a resumable session", async () => {
    const requests: RecordedRequest[] = [];
    const server = await startServer((request, response) => {
      requests.push(request);
      if (request.method === "POST") {
        response.writeHead(200, {
          location: `http://${request.headers.host}/upload-session/abc`,
        });
        response.end("{}");
        return;
      }
      json(response, 200, { id: "blob-1", name: "hash" });
    });

    try {
      const { client } = createClient(server.base);
      const file = await client.uploadFile({
        name: "hash",
        parents: ["game"],
        mimeType: "application/octet-stream",
        body: Buffer.alloc(4 * 1024 * 1024 + 1, 7),
      });

      assert.equal(file.id, "blob-1");
      assert.equal(requests[0].url.searchParams.get("uploadType"), "resumable");
      assert.equal(
        requests[0].headers["x-upload-content-length"],
        String(4 * 1024 * 1024 + 1)
      );
      assert.equal(requests[1].method, "PUT");
      assert.equal(requests[1].url.pathname, "/upload-session/abc");
      assert.equal(requests[1].body.length, 4 * 1024 * 1024 + 1);
    } finally {
      await server.close();
    }
  });

  it("refreshes once after a 401 and retries the same request", async () => {
    let attempts = 0;
    const server = await startServer((_request, response) => {
      attempts += 1;
      if (attempts === 1) {
        json(response, 401, { error: { message: "expired" } });
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"version":2}');
    });

    try {
      const { client, refreshCalls } = createClient(server.base);
      assert.equal(await client.getTextFile("manifest"), '{"version":2}');
      assert.equal(refreshCalls(), 1);
      assert.equal(attempts, 2);
    } finally {
      await server.close();
    }
  });

  it("backs off on 429 and then succeeds", async () => {
    let attempts = 0;
    const server = await startServer((_request, response) => {
      attempts += 1;
      if (attempts === 1) {
        response.writeHead(429, { "retry-after": "2" });
        response.end("slow down");
        return;
      }
      json(response, 200, { files: [] });
    });

    try {
      const { client, sleeps } = createClient(server.base);
      await client.listAllFiles("trashed = false", "id");
      assert.deepEqual(sleeps, [2_000]);
      assert.equal(attempts, 2);
    } finally {
      await server.close();
    }
  });

  it("gives up with a clear code when rate limiting persists", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(429);
      response.end("slow down");
    });

    try {
      const { client } = createClient(server.base, { maxRetries: 1 });
      await assert.rejects(
        client.listAllFiles("trashed = false", "id"),
        (error: unknown) => {
          assert.ok(error instanceof GoogleDriveError);
          assert.equal(error.code, "google_drive_rate_limited");
          return true;
        }
      );
    } finally {
      await server.close();
    }
  });

  it("reports storageQuotaExceeded instead of retrying it", async () => {
    const server = await startServer((_request, response) => {
      json(response, 403, {
        error: {
          message: "The user's Drive storage quota has been exceeded.",
          errors: [{ reason: "storageQuotaExceeded" }],
        },
      });
    });

    try {
      const { client, sleeps } = createClient(server.base);
      await assert.rejects(
        client.uploadFile({
          name: "hash",
          parents: ["game"],
          mimeType: "application/octet-stream",
          body: Buffer.from("data"),
        }),
        (error: unknown) => {
          assert.ok(error instanceof GoogleDriveError);
          assert.equal(error.code, "google_drive_storage_quota_exceeded");
          return true;
        }
      );
      assert.deepEqual(sleeps, []);
    } finally {
      await server.close();
    }
  });

  it("reads the account quota from about.get", async () => {
    let fields = "";
    const server = await startServer((request, response) => {
      fields = request.url.searchParams.get("fields") ?? "";
      json(response, 200, {
        storageQuota: { limit: "1000", usage: "250" },
      });
    });

    try {
      const { client } = createClient(server.base);
      const quota = await client.about();
      assert.equal(fields, "storageQuota");
      assert.equal(quota.limit, "1000");
      assert.equal(quota.usage, "250");
    } finally {
      await server.close();
    }
  });

  it("deletes a file with DELETE", async () => {
    let method = "";
    const server = await startServer((request, response) => {
      method = request.method ?? "";
      response.writeHead(204).end();
    });

    try {
      const { client } = createClient(server.base);
      await client.deleteFile("file-id");
      assert.equal(method, "DELETE");
    } finally {
      await server.close();
    }
  });
});
