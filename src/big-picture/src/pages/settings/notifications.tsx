import "./notifications.scss";

import { isFeatureEnabled } from "../../feature-flags";
import { NotificationsAchievementsSection } from "./notifications-achievements-section";
import { NotificationsLibrarySection } from "./notifications-library-section";
import {
  NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS,
  NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS,
} from "./settings-navigation";

interface SettingsSectionProps {
  className?: string;
}

export function NotificationsSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const accountFeaturesEnabled = isFeatureEnabled("HYDRA_ACCOUNT_FEATURES");
  const achievementsEnabled = isFeatureEnabled("ACHIEVEMENTS");

  return (
    <div
      className={
        className
          ? `notifications-settings-section ${className}`
          : "notifications-settings-section"
      }
    >
      <NotificationsLibrarySection
        lastItemDownTarget={
          achievementsEnabled
            ? {
                type: "item",
                itemId:
                  NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS.achievementNotificationsEnabled,
              }
            : { type: "block" }
        }
      />

      {achievementsEnabled && (
        <NotificationsAchievementsSection
          firstItemUpTarget={{
            type: "item",
            itemId: accountFeaturesEnabled
              ? NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.friendStartGameNotificationsEnabled
              : NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.repackUpdatesNotificationsEnabled,
          }}
        />
      )}
    </div>
  );
}
