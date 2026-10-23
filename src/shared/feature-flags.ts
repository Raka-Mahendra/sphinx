// SPDX-License-Identifier: Apache-2.0

import rawFeatureFlags from "./feature-flags.json" with { type: "json" };

export type FeatureFlag = keyof typeof rawFeatureFlags;

export const FEATURE_UNAVAILABLE_CODE = "feature_unavailable" as const;

export const featureFlags: Readonly<Record<FeatureFlag, boolean>> =
  Object.freeze({ ...rawFeatureFlags });

export const isFeatureEnabled = (flag: FeatureFlag): boolean =>
  featureFlags[flag] === true;

export class FeatureUnavailableError extends Error {
  readonly code = FEATURE_UNAVAILABLE_CODE;

  constructor(readonly feature: FeatureFlag) {
    super(FEATURE_UNAVAILABLE_CODE);
    this.name = "FeatureUnavailableError";
  }
}

export const isFeatureUnavailableError = (
  error: unknown
): error is FeatureUnavailableError => {
  if (error instanceof FeatureUnavailableError) return true;

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === FEATURE_UNAVAILABLE_CODE
  );
};

export const assertFeatureEnabled = (flag: FeatureFlag): void => {
  if (!isFeatureEnabled(flag)) throw new FeatureUnavailableError(flag);
};
