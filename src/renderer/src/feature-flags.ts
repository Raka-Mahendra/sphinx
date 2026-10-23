// SPDX-License-Identifier: Apache-2.0

import { featureFlags, isFeatureEnabled, type FeatureFlag } from "@shared";

export { featureFlags, isFeatureEnabled, type FeatureFlag };

export const useFeatureFlag = (flag: FeatureFlag): boolean =>
  isFeatureEnabled(flag);
