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
          logger.log(" ---- REQUEST -----");
          logger.log(
            request.method,
            request.url,
            sanitizeNetworkLogPayload({
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
          logger.log(
            response.status,
            response.config.method,
            response.config.url,
            response.config.logResponseBody === false
              ? summarizeNetworkLogPayload(response.data)
              : sanitizeNetworkLogPayload(response.data)
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
            sanitizeNetworkLogPayload({
              headers: config.headers ?? null,
              data: config.data ?? null,
            })
          );
          if (error.response) {
            logger.error(
              "Response error:",
              error.response.status,
              sanitizeNetworkLogPayload(error.response.data)
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
          "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
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
          "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
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
