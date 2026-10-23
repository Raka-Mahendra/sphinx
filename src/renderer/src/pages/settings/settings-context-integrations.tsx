import { useTranslation } from "react-i18next";
import { isFeatureEnabled } from "@renderer/feature-flags";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsRetroAchievements } from "./settings-retroachievements";
import { SettingsSteam } from "./settings-steam";
import { SettingsEpic } from "./settings-epic";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");
  const steamIntegrationEnabled = isFeatureEnabled("STEAM_INTEGRATION");
  const epicIntegrationEnabled = isFeatureEnabled("EPIC_INTEGRATION");
  const achievementsEnabled = isFeatureEnabled("ACHIEVEMENTS");
  const hasIntegrationSettings =
    steamIntegrationEnabled || epicIntegrationEnabled || achievementsEnabled;

  return (
    <div className="settings-context-panel">
      {hasIntegrationSettings && (
        <div className="settings-context-panel__group">
          {steamIntegrationEnabled && <SettingsSteam />}
          {epicIntegrationEnabled && <SettingsEpic />}
          {achievementsEnabled && <SettingsRetroAchievements />}
        </div>
      )}

      {hasIntegrationSettings && (
        <hr className="settings-context-panel__divider" />
      )}

      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>
    </div>
  );
}
