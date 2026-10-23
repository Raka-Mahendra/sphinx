import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FeatureUnavailableError } from "../shared/feature-flags.js";
import {
  featureForChannel,
  gatedChannels,
  requireFeature,
  requireFeatureChannel,
} from "./feature-flags-core.js";

const isFeatureUnavailable =
  (flag: string) =>
  (error: unknown): boolean => {
    assert.ok(error instanceof FeatureUnavailableError);
    assert.equal(error.code, "feature_unavailable");
    assert.equal(error.feature, flag);
    return true;
  };

describe("main feature flag enforcement", () => {
  it("maps gated channels to their owning feature flag", () => {
    assert.equal(featureForChannel("getAuth"), "HYDRA_ACCOUNT_FEATURES");
    assert.equal(featureForChannel("openCheckout"), "HYDRA_ACCOUNT_FEATURES");
    assert.equal(
      featureForChannel("deleteAchievementSouvenir"),
      "ACHIEVEMENTS"
    );
    assert.equal(featureForChannel("getUnlockedAchievements"), "ACHIEVEMENTS");
    assert.equal(featureForChannel("startSteamSync"), "STEAM_INTEGRATION");
    assert.equal(featureForChannel("startEpicAuth"), "EPIC_INTEGRATION");
    assert.equal(featureForChannel("syncGameCloudSave"), "HYDRA_CLOUD_LEGACY");
    assert.equal(featureForChannel("getCloudIframeUrl"), "HYDRA_CLOUD_LEGACY");
  });

  it("rejects every gated channel while the flags are off", () => {
    for (const channel of gatedChannels()) {
      const flag = featureForChannel(channel);
      assert.ok(flag, `${channel} should map to a flag`);
      assert.throws(
        () => requireFeatureChannel(channel),
        isFeatureUnavailable(flag),
        `${channel} should fail closed`
      );
    }
  });

  it("leaves channels without an owning flag untouched", () => {
    assert.equal(featureForChannel("downloadGame"), undefined);
    assert.equal(featureForChannel("getCatalogue"), undefined);
    assert.doesNotThrow(() => requireFeatureChannel("downloadGame"));
    assert.doesNotThrow(() => requireFeatureChannel(""));
  });

  it("rejects a disabled flag directly", () => {
    assert.throws(
      () => requireFeature("ACHIEVEMENTS"),
      isFeatureUnavailable("ACHIEVEMENTS")
    );
  });
});
