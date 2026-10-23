// SPDX-License-Identifier: Apache-2.0

import { logger } from "@main/services/logger";
import {
  FeatureUnavailableError,
  assertFeatureEnabled,
  featureFlags,
  isFeatureEnabled,
  isFeatureUnavailableError,
  type FeatureFlag,
} from "@shared";
import {
  featureForChannel,
  requireFeature as requireFeatureWithoutLogging,
} from "./feature-flags-core";

export {
  FeatureUnavailableError,
  assertFeatureEnabled,
  featureFlags,
  featureForChannel,
  isFeatureEnabled,
  isFeatureUnavailableError,
  type FeatureFlag,
};

export const requireFeature = (flag: FeatureFlag): void => {
  if (isFeatureEnabled(flag)) return;

  logger.debug(`[feature-flags] ${flag} is disabled; rejecting request`);
  requireFeatureWithoutLogging(flag);
};

export const requireFeatureChannel = (channel: string): void => {
  const flag = featureForChannel(channel);
  if (!flag) return;

  requireFeature(flag);
};
