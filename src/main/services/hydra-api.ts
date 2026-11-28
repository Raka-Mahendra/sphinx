// SPDX-License-Identifier: Apache-2.0

import axios, { AxiosInstance } from "axios";
import { FeatureUnavailableError } from "@shared";
import { appVersion } from "@main/constants";
import { networkLogger as logger } from "./logger";
import {
  sanitizeNetworkLogPayload,
  summarizeNetworkLogPayload,
} from "./network-log-payload";
import { summarizeNetworkError } from "./network-error-summary";
import type { HydraApiAuthContext } from "./hydra-auth-context";

declare module "axios" {
  interface AxiosRequestConfig {
    logResponseBody?: boolean;
    /** Millisecond timestamp set by the request interceptor for duration logging. */
    logStartedAt?: number;
  }
}

export interface HydraApiOptions {
  needsAuth?: boolean;
  needsSubscription?: boolean;
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  logResponseBody?: boolean;
  timeout?: number;
  authContext?: HydraApiAuthContext;
}

/**
 * Catalogue responses are large, so bodies stay out of the log unless a caller
 * explicitly opts in per request (`logResponseBody: true`) or a developer sets
 * `SPHINX_LOG_HTTP_BODIES=1`. Even then the payload is capped so one giant
 * response cannot fill the log or hang stderr.
 */
const MAX_LOGGED_BODY_CHARS = 8 * 1024;

const shouldLogResponseBody = (configured?: boolean) =>
  configured === true || process.env.SPHINX_LOG_HTTP_BODIES === "1";

const payloadByteLength = (value: unknown) => {
  if (value === null || value === undefined) return 0;
  try {
    return Buffer.byteLength(
      typeof value === "string" ? value : JSON.stringify(value)
    );
  } catch {
    return 0;
  }
};

const describeResponseBody = (value: unknown, includeBody: boolean) => {
  if (!includeBody) return summarizeNetworkLogPayload(value);

  const sanitized = sanitizeNetworkLogPayload(value);
  let serialized: string;
  try {
    serialized =
      typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
  } catch {
    return summarizeNetworkLogPayload(value);
  }

  if (typeof serialized !== "string") return sanitized;

  return serialized.length > MAX_LOGGED_BODY_CHARS
    ? `${serialized.slice(0, MAX_LOGGED_BODY_CHARS)}…[truncated, ${serialized.length} chars]`
    : serialized;
};

export class HydraApi {
  private static instance: AxiosInstance;
  private static readonly ADD_LOG_INTERCEPTOR = true;

  public static getAuthContext(): HydraApiAuthContext | null {
    return null;
  }

  public static isAuthContextCurrent(_context: HydraApiAuthContext) {
    return false;
  }

  public static onAuthContextChanged(_listener: () => void) {
    return () => {};
  }

  public static persistUserCache(..._args: unknown[]) {
    return Promise.resolve();
  }

  public static isLoggedIn() {
    return false;
  }

  public static hasActiveSubscription() {
    return false;
  }

  public static updateUserSubscription(..._args: unknown[]) {
    return;
  }

  static async handleExternalAuth(_uri: string) {
    throw new FeatureUnavailableError("HYDRA_ACCOUNT_FEATURES");
  }

  static async handleSignOut(_cleanupUserData?: () => Promise<void>) {
    return;
  }

  static async setupApi() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Sphinx Launcher v${appVersion}` },
    });

    if (this.ADD_LOG_INTERCEPTOR) {
      this.instance.interceptors.request.use(
        (request) => {
          request.logStartedAt = Date.now();
          logger.log(" ---- REQUEST -----");
          logger.log(
            request.method,
            request.url,
            summarizeNetworkLogPayload({
              params: request.params ?? null,
              data: request.data ?? null,
            })
          );
          return request;
        },
        (error) => {
          logger.error("request error", summarizeNetworkError(error));
          return Promise.reject(error);
        }
      );
      this.instance.interceptors.response.use(
        (response) => {
          logger.log(" ---- RESPONSE -----");
          const durationMs = response.config.logStartedAt
            ? Date.now() - response.config.logStartedAt
            : undefined;
          logger.log(
            response.status,
            response.config.method,
            response.config.url,
            durationMs === undefined ? "" : `${durationMs}ms`,
            `${payloadByteLength(response.data)} bytes`,
            describeResponseBody(
              response.data,
              shouldLogResponseBody(response.config.logResponseBody)
            )
          );
          return response;
        },
        (error) => {
          logger.error(" ---- RESPONSE ERROR -----");
          const config = error.config ?? {};

          logger.error(
            config.method,
            config.baseURL,
            config.url,
            summarizeNetworkLogPayload({
              headers: config.headers ?? null,
              data: config.data ?? null,
            })
          );
          if (error.response) {
            logger.error(
              "Response error:",
              error.response.status,
              describeResponseBody(
                error.response.data,
                shouldLogResponseBody(config.logResponseBody)
              )
            );

            return Promise.reject(error as Error);
          }

          if (error.request) {
            const errorData = error.toJSON();
            logger.error("Request error:", summarizeNetworkError(error));
            return Promise.reject(
              new Error(
                `Request failed with ${errorData.code} ${errorData.message}`
              )
            );
          }

          logger.error("Error", summarizeNetworkError(error));
          return Promise.reject(error as Error);
        }
      );
    }
  }

  public static async refreshToken(): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    throw new FeatureUnavailableError("HYDRA_ACCOUNT_FEATURES");
  }

  private static validatePublicRequest(options?: HydraApiOptions) {
    const needsAuth = options?.needsAuth !== false;
    const needsSubscription = options?.needsSubscription === true;

    if (needsAuth || needsSubscription) {
      throw new FeatureUnavailableError("HYDRA_ACCOUNT_FEATURES");
    }
  }

  private static requestConfig(options?: HydraApiOptions) {
    return {
      signal: options?.signal,
      timeout: options?.timeout,
      logResponseBody: options?.logResponseBody,
      ...(options?.validateStatus
        ? { validateStatus: options.validateStatus }
        : {}),
    };
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    this.validatePublicRequest(options);
    return this.instance
      .get<T>(url, {
        ...this.requestConfig(options),
        params,
        headers: {
          "Sphinx-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
          "If-None-Match": options?.ifNoneMatch,
        },
      })
      .then((response) => response.data);
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    this.validatePublicRequest(options);
    return this.instance
      .get<T>(url, {
        ...this.requestConfig(options),
        params,
        headers: {
          "Sphinx-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
          "If-None-Match": options?.ifNoneMatch,
        },
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
        headers: response.headers,
      }));
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    this.validatePublicRequest(options);
    return this.instance
      .post<T>(url, data, this.requestConfig(options))
      .then((response) => response.data);
  }

  static async postResponse<T = unknown>(
    url: string,
    data?: unknown,
    options?: HydraApiOptions
  ) {
    this.validatePublicRequest(options);
    return this.instance
      .post<T>(url, data, this.requestConfig(options))
      .then((response) => ({ status: response.status, data: response.data }));
  }

  static async put<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    this.validatePublicRequest(options);
    return this.instance
      .put<T>(url, data, this.requestConfig(options))
      .then((response) => response.data);
  }

  static async patch<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    this.validatePublicRequest(options);
    return this.instance
      .patch<T>(url, data, this.requestConfig(options))
      .then((response) => response.data);
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    this.validatePublicRequest(options);
    return this.instance
      .delete<T>(url, this.requestConfig(options))
      .then((response) => response.data);
  }

  static async checkDownloadSourcesChanges(
    downloadSourceIds: string[],
    games: Array<{ shop: string; objectId: string }>,
    since: string
  ) {
    logger.info("HydraApi.checkDownloadSourcesChanges called with:", {
      downloadSourceIds,
      gamesCount: games.length,
      since,
    });

    return this.post<
      Array<{
        shop: string;
        objectId: string;
        newDownloadOptionsCount: number;
        downloadSourceIds: string[];
      }>
    >(
      "/download-sources/changes",
      {
        downloadSourceIds,
        games,
        since,
      },
      { needsAuth: true }
    );
  }
}
