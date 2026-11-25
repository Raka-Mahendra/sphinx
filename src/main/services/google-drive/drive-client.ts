import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";

import { GOOGLE_DRIVE_API_BASE, GOOGLE_DRIVE_UPLOAD_BASE } from "./config.js";

/**
 * Drive REST v3 over `fetch`. No `googleapis` dependency: the API surface this
 * app needs is four endpoints, and the library would add megabytes (and its
 * own auth stack) for none of the quota or retry behaviour below.
 */

export class GoogleDriveError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "GoogleDriveError";
    this.code = code;
    this.status = status;
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
  parents?: string[];
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface DriveStorageQuota {
  limit?: string;
  usage?: string;
  usageInDrive?: string;
}

export interface DriveListParams {
  q: string;
  fields: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
}

export interface DriveUploadInput {
  name: string;
  parents: string[];
  appProperties?: Record<string, string>;
  mimeType: string;
  body: Buffer;
}

export interface DrivePathUploadInput {
  name: string;
  parents: string[];
  appProperties?: Record<string, string>;
  mimeType: string;
  path: string;
  sizeBytes: number;
}

export interface GoogleDriveClientOptions {
  getAccessToken: () => Promise<string>;
  /** Called once per request after a 401; must resolve to a usable token. */
  refreshAccessToken: () => Promise<unknown>;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
  apiBaseUrl?: string;
  uploadBaseUrl?: string;
}

export interface DriveClientLike {
  listFiles(params: DriveListParams): Promise<DriveFileList>;
  listAllFiles(q: string, fields: string): Promise<DriveFile[]>;
  createFolder(name: string, parentId: string): Promise<DriveFile>;
  uploadFile(input: DriveUploadInput): Promise<DriveFile>;
  uploadFileFromPath(input: DrivePathUploadInput): Promise<DriveFile>;
  getTextFile(fileId: string): Promise<string>;
  getMediaResponse(fileId: string): Promise<Response>;
  deleteFile(fileId: string): Promise<void>;
  about(): Promise<DriveStorageQuota>;
}

const FILE_FIELDS =
  "id,name,mimeType,size,createdTime,modifiedTime,appProperties,parents";
const MULTIPART_LIMIT_BYTES = 4 * 1024 * 1024;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

interface DriveErrorPayload {
  message: string;
  reasons: string[];
}

const readErrorPayload = async (
  response: Response
): Promise<DriveErrorPayload> => {
  const text = await response.text().catch(() => "");
  if (!text) return { message: "", reasons: [] };

  try {
    const parsed = JSON.parse(text) as {
      error?: {
        message?: unknown;
        errors?: Array<{ reason?: unknown }>;
        status?: unknown;
      };
    };
    const errors = parsed.error?.errors ?? [];
    return {
      message:
        typeof parsed.error?.message === "string" ? parsed.error.message : "",
      reasons: errors.flatMap((entry) =>
        typeof entry.reason === "string" ? [entry.reason] : []
      ),
    };
  } catch {
    return { message: text.slice(0, 500), reasons: [] };
  }
};

export const createMultipartBody = (
  metadata: object,
  content: Buffer,
  mimeType: string
): { body: Buffer; contentType: string } => {
  const boundary = `sphinx-${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, content, tail]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
};

const positiveInteger = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export class GoogleDriveClient implements DriveClientLike {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly apiBaseUrl: string;
  private readonly uploadBaseUrl: string;

  constructor(private readonly options: GoogleDriveClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.maxRetries = options.maxRetries ?? 4;
    this.apiBaseUrl = options.apiBaseUrl ?? GOOGLE_DRIVE_API_BASE;
    this.uploadBaseUrl = options.uploadBaseUrl ?? GOOGLE_DRIVE_UPLOAD_BASE;
  }

  /**
   * Backoff for one attempt, in milliseconds.
   *
   * Exponential with full jitter, per Google's documented algorithm: wait
   * `min(2^n + random, 32s)`. `Retry-After` wins when Google sends it, because
   * a rate-limited caller should not come back early.
   */
  private retryDelay(response: Response | null, attempt: number): number {
    const retryAfter = positiveInteger(
      response?.headers.get("retry-after") ?? null
    );
    if (retryAfter !== null) return Math.min(retryAfter * 1000, 64_000);

    const exponential = 500 * 2 ** attempt;
    const jitter = Math.floor(this.random() * 1_000);
    return Math.min(exponential + jitter, 32_000);
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let refreshed = false;

    for (let attempt = 0; ; attempt += 1) {
      const token = await this.options.getAccessToken();
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);

      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, headers });
      } catch (error) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay(null, attempt));
          continue;
        }
        throw new GoogleDriveError(
          "google_drive_network_error",
          error instanceof Error ? error.message : String(error)
        );
      }

      if (response.ok) return response;

      if (response.status === 401 && !refreshed) {
        // An expired access token is normal; refresh once and retry the same
        // request. A second 401 means the stored refresh token is dead.
        refreshed = true;
        await this.options.refreshAccessToken();
        continue;
      }

      if (response.status === 401) {
        throw new GoogleDriveError(
          "google_drive_reconnect_required",
          "Google Drive rejected the saved credentials; connect it again",
          401
        );
      }

      const payload = await readErrorPayload(response);

      if (payload.reasons.includes("storageQuotaExceeded")) {
        throw new GoogleDriveError(
          "google_drive_storage_quota_exceeded",
          "Your Google account is out of storage. Free up space in Google Drive and try again.",
          403
        );
      }

      const rateLimited =
        RETRYABLE_STATUSES.has(response.status) ||
        (response.status === 403 &&
          payload.reasons.some((reason) => RATE_LIMIT_REASONS.has(reason)));

      if (rateLimited) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay(response, attempt));
          continue;
        }
        throw new GoogleDriveError(
          "google_drive_rate_limited",
          "Google Drive is rate limiting Sphinx. Try again in a minute.",
          response.status
        );
      }

      if (response.status === 403) {
        throw new GoogleDriveError(
          "google_drive_forbidden",
          payload.message ||
            "Google Drive denied the request. Check that the Drive API is enabled and the app is not blocked.",
          403
        );
      }

      if (response.status === 404) {
        throw new GoogleDriveError(
          "google_drive_not_found",
          payload.message || "The Google Drive item no longer exists",
          404
        );
      }

      throw new GoogleDriveError(
        "google_drive_request_failed",
        payload.message || `Google Drive returned HTTP ${response.status}`,
        response.status
      );
    }
  }

  private buildUrl(
    path: string,
    params: Record<string, string | number | undefined>
  ) {
    const url = new URL(path, this.apiBaseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private buildUploadUrl(
    path: string,
    params: Record<string, string | number | undefined>
  ) {
    const url = new URL(path, this.uploadBaseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async listFiles({
    q,
    fields,
    pageSize = 1000,
    pageToken,
    orderBy,
  }: DriveListParams): Promise<DriveFileList> {
    const response = await this.request(
      this.buildUrl("/drive/v3/files", {
        spaces: "appDataFolder",
        q,
        fields: `nextPageToken,files(${fields})`,
        pageSize,
        pageToken,
        orderBy,
      }),
      { method: "GET" }
    );
    return (await response.json()) as DriveFileList;
  }

  async listAllFiles(q: string, fields: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.listFiles({ q, fields, pageToken });
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async createFolder(name: string, parentId: string): Promise<DriveFile> {
    const response = await this.request(
      this.buildUrl("/drive/v3/files", { fields: FILE_FIELDS }),
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
          appProperties: { app: "sphinx", schema: "1", kind: "folder" },
        }),
      }
    );
    return (await response.json()) as DriveFile;
  }

  private async startResumable(
    input: Pick<
      DriveUploadInput,
      "name" | "parents" | "appProperties" | "mimeType"
    >,
    sizeBytes: number
  ): Promise<string> {
    const response = await this.request(
      this.buildUploadUrl("/upload/drive/v3/files", {
        uploadType: "resumable",
        fields: FILE_FIELDS,
      }),
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": input.mimeType,
          "x-upload-content-length": String(sizeBytes),
        },
        body: JSON.stringify({
          name: input.name,
          parents: input.parents,
          ...(input.appProperties
            ? { appProperties: input.appProperties }
            : {}),
        }),
      }
    );

    const location = response.headers.get("location");
    if (!location) {
      throw new GoogleDriveError(
        "google_drive_resumable_failed",
        "Google Drive did not return a resumable upload URL"
      );
    }
    return location;
  }

  /**
   * Uploads through a resumable session. The body factory is re-invoked on
   * every attempt, because a stream cannot be replayed.
   */
  private async putResumable(
    location: string,
    bodyFactory: () => BodyInit,
    sizeBytes: number
  ): Promise<DriveFile> {
    let refreshed = false;

    for (let attempt = 0; ; attempt += 1) {
      const token = await this.options.getAccessToken();
      let response: Response;
      try {
        response = await this.fetchImpl(location, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-length": String(sizeBytes),
          },
          body: bodyFactory(),
          // Node needs this for a streaming body.
          duplex: "half",
        } as RequestInit);
      } catch (error) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay(null, attempt));
          continue;
        }
        throw new GoogleDriveError(
          "google_drive_network_error",
          error instanceof Error ? error.message : String(error)
        );
      }

      if (response.ok) return (await response.json()) as DriveFile;

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await this.options.refreshAccessToken();
        continue;
      }

      if (
        RETRYABLE_STATUSES.has(response.status) &&
        attempt < this.maxRetries
      ) {
        await this.sleep(this.retryDelay(response, attempt));
        continue;
      }

      const payload = await readErrorPayload(response);
      if (payload.reasons.includes("storageQuotaExceeded")) {
        throw new GoogleDriveError(
          "google_drive_storage_quota_exceeded",
          "Your Google account is out of storage. Free up space in Google Drive and try again.",
          response.status
        );
      }
      throw new GoogleDriveError(
        "google_drive_upload_failed",
        payload.message || `Google Drive returned HTTP ${response.status}`,
        response.status
      );
    }
  }

  async uploadFile(input: DriveUploadInput): Promise<DriveFile> {
    if (input.body.length <= MULTIPART_LIMIT_BYTES) {
      const multipart = createMultipartBody(
        {
          name: input.name,
          parents: input.parents,
          ...(input.appProperties
            ? { appProperties: input.appProperties }
            : {}),
        },
        input.body,
        input.mimeType
      );
      const response = await this.request(
        this.buildUploadUrl("/upload/drive/v3/files", {
          uploadType: "multipart",
          fields: FILE_FIELDS,
        }),
        {
          method: "POST",
          headers: { "content-type": multipart.contentType },
          // Node's Buffer is a typed array; the DOM lib narrows BodyInit.
          body: multipart.body as unknown as BodyInit,
        }
      );
      return (await response.json()) as DriveFile;
    }

    const location = await this.startResumable(input, input.body.length);
    return this.putResumable(
      location,
      () => input.body as unknown as BodyInit,
      input.body.length
    );
  }

  async uploadFileFromPath(input: DrivePathUploadInput): Promise<DriveFile> {
    if (input.sizeBytes <= MULTIPART_LIMIT_BYTES) {
      return this.uploadFile({
        name: input.name,
        parents: input.parents,
        appProperties: input.appProperties,
        mimeType: input.mimeType,
        body: await fs.readFile(input.path),
      });
    }

    const location = await this.startResumable(input, input.sizeBytes);
    return this.putResumable(
      location,
      () => createReadStream(input.path) as unknown as BodyInit,
      input.sizeBytes
    );
  }

  async getTextFile(fileId: string): Promise<string> {
    const response = await this.request(
      this.buildUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
        alt: "media",
      }),
      { method: "GET" }
    );
    return response.text();
  }

  async getMediaResponse(fileId: string): Promise<Response> {
    return this.request(
      this.buildUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
        alt: "media",
      }),
      { method: "GET" }
    );
  }

  async deleteFile(fileId: string): Promise<void> {
    const response = await this.request(
      this.buildUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, {}),
      { method: "DELETE" }
    );
    // Drain the empty body so the socket can be reused.
    await response.arrayBuffer().catch(() => undefined);
  }

  async about(): Promise<DriveStorageQuota> {
    const response = await this.request(
      this.buildUrl("/drive/v3/about", { fields: "storageQuota" }),
      { method: "GET" }
    );
    const payload = (await response.json()) as {
      storageQuota?: DriveStorageQuota;
    };
    return payload.storageQuota ?? {};
  }
}
