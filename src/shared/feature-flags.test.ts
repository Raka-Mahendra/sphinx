import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FEATURE_UNAVAILABLE_CODE,
  FeatureUnavailableError,
  assertFeatureEnabled,
  featureFlags,
  isFeatureEnabled,
  isFeatureUnavailableError,
  type FeatureFlag,
} from "./feature-flags.js";

const ALL_FLAGS: readonly FeatureFlag[] = [
  "HYDRA_ACCOUNT_FEATURES",
  "ACHIEVEMENTS",
  "STEAM_INTEGRATION",
  "EPIC_INTEGRATION",
  "HYDRA_CLOUD_LEGACY",
];

describe("shared feature flags", () => {
  it("ships every account-dependent flag disabled", () => {
    assert.deepEqual(Object.keys(featureFlags).sort(), [...ALL_FLAGS].sort());

    for (const flag of ALL_FLAGS) {
      assert.equal(featureFlags[flag], false, `${flag} must default to false`);
      assert.equal(isFeatureEnabled(flag), false, `${flag} must be off`);
    }
  });

  it("freezes the flag map so runtime code cannot flip a flag", () => {
    assert.equal(Object.isFrozen(featureFlags), true);
  });

  it("throws feature_unavailable from assertFeatureEnabled when a flag is off", () => {
    assert.throws(
      () => assertFeatureEnabled("HYDRA_ACCOUNT_FEATURES"),
      (error: unknown) => {
        assert.ok(error instanceof FeatureUnavailableError);
        assert.equal(error.code, FEATURE_UNAVAILABLE_CODE);
        assert.equal(error.message, FEATURE_UNAVAILABLE_CODE);
        assert.equal(error.feature, "HYDRA_ACCOUNT_FEATURES");
        return true;
      }
    );
  });

  it("recognizes feature_unavailable errors across the IPC boundary", () => {
    assert.equal(
      isFeatureUnavailableError(new FeatureUnavailableError("ACHIEVEMENTS")),
      true
    );
    assert.equal(
      isFeatureUnavailableError({ code: FEATURE_UNAVAILABLE_CODE }),
      true
    );
    assert.equal(isFeatureUnavailableError(new Error("nope")), false);
    assert.equal(isFeatureUnavailableError({ code: "other" }), false);
    assert.equal(isFeatureUnavailableError(null), false);
    assert.equal(isFeatureUnavailableError(undefined), false);
  });
});
