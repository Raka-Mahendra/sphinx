import { FeatureUnavailableError, isFeatureUnavailableError } from "@shared";
import { HydraApi } from "@main/services";

import { registerEvent } from "../register-event";
import { logger } from "@main/services/logger";

interface HydraApiCallPayload {
  method: "get" | "post" | "postResponse" | "put" | "patch" | "delete";
  url: string;
  data?: unknown;
  params?: unknown;
  options?: {
    needsAuth?: boolean;
    needsSubscription?: boolean;
    ifModifiedSince?: Date;
    acceptedStatuses?: number[];
  };
}

const PUBLIC_GET_PREFIXES = [
  "/catalogue",
  "/badges",
  "/features",
  "/users",
  "/games",
] as const;

const isPublicGetPath = (path: string): boolean =>
  PUBLIC_GET_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );

const isAllowedPublicRequest = (
  method: HydraApiCallPayload["method"],
  url: string
) => {
  const path = url.split("?")[0];

  if (method === "get") {
    return isPublicGetPath(path);
  }

  return method === "post" && path === "/catalogue/search";
};

const hydraApiCall = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: HydraApiCallPayload
) => {
  const { method, url, data, params, options } = payload;

  if (options?.needsSubscription) {
    logger.debug(
      "[feature-flags] HYDRA_CLOUD_LEGACY is disabled; rejecting cloud API request"
    );
    throw new FeatureUnavailableError("HYDRA_CLOUD_LEGACY");
  }

  if (options?.needsAuth !== false || !isAllowedPublicRequest(method, url)) {
    logger.debug(
      `[feature-flags] HYDRA_ACCOUNT_FEATURES is disabled; rejecting ${method} ${url}`
    );
    throw new FeatureUnavailableError("HYDRA_ACCOUNT_FEATURES");
  }

  const hydraApiOptions = {
    ...options,
    validateStatus: options?.acceptedStatuses
      ? (status: number) =>
          status !== 401 &&
          (options.acceptedStatuses?.includes(status) ?? false)
      : undefined,
  };

  const getErrorMessage = (error: unknown): string | null => {
    if (typeof error === "object" && error !== null) {
      const response = (
        error as { response?: { data?: { message?: unknown } } }
      ).response;
      const responseMessage = response?.data?.message;

      if (typeof responseMessage === "string") {
        return responseMessage;
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return null;
  };

  try {
    let request: Promise<unknown>;

    switch (method) {
      case "get":
        request = HydraApi.get(url, params, hydraApiOptions);
        break;
      case "post":
        request = HydraApi.post(url, data, hydraApiOptions);
        break;
      case "postResponse":
        request = HydraApi.postResponse(url, data, hydraApiOptions);
        break;
      case "put":
        request = HydraApi.put(url, data, hydraApiOptions);
        break;
      case "patch":
        request = HydraApi.patch(url, data, hydraApiOptions);
        break;
      case "delete":
        request = HydraApi.delete(url, hydraApiOptions);
        break;
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }

    return await request;
  } catch (error) {
    if (isFeatureUnavailableError(error)) throw error;

    const errorMessage = getErrorMessage(error);
    throw new Error(errorMessage ?? "hydra-api-call-failed");
  }
};

registerEvent("hydraApiCall", hydraApiCall);
