import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { SyncIcon } from "@primer/octicons-react";
import { Link } from "../link/link";
import "./auto-update-header.scss";
import type { AppUpdaterEvent } from "@types";

export const releasesPageUrl =
  "https://github.com/Raka-Mahendra/sphinx/releases/latest";

export function AutoUpdateSubHeader() {
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  // `null` = the check has not resolved yet. `checkForUpdates()` only resolves
  // after the update has finished downloading, so a `false` default would show
  // the "download from the releases page" link for the whole download even
  // though the app is already downloading it.
  const [isAutoInstallAvailable, setIsAutoInstallAvailable] = useState<
    boolean | null
  >(null);

  const { t } = useTranslation("header");

  const handleClickInstallUpdate = () => {
    window.electron.restartAndInstallUpdate();
  };

  useEffect(() => {
    const unsubscribe = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvent) => {
        if (event.type == "update-available") {
          setNewVersion(event.info.version);
        }

        if (event.type == "update-downloaded") {
          setIsReadyToInstall(true);
        }
      }
    );

    window.electron
      .checkForUpdates()
      .then((isAutoInstallAvailable) => {
        setIsAutoInstallAvailable(isAutoInstallAvailable);
      })
      .catch(() => {
        // The shell timed out or restarted. That is not an update and not
        // something the user needs to see; the baseline also treated a failed
        // check as "no update available".
        setIsAutoInstallAvailable(false);
      });

    return () => {
      unsubscribe();
    };
  }, []);

  if (!newVersion) return null;

  if (isAutoInstallAvailable === false) {
    return (
      <header className="auto-update-sub-header">
        <Link
          to={releasesPageUrl}
          className="auto-update-sub-header__new-version-link"
        >
          <SyncIcon
            className="auto-update-sub-header__new-version-icon"
            size={12}
          />
          {t("version_available_download", { version: newVersion })}
        </Link>
      </header>
    );
  }

  if (isAutoInstallAvailable === true && isReadyToInstall) {
    return (
      <header className="auto-update-sub-header">
        <button
          type="button"
          className="auto-update-sub-header__new-version-button"
          onClick={handleClickInstallUpdate}
        >
          <SyncIcon
            className="auto-update-sub-header__new-version-icon"
            size={12}
          />
          {t("version_available_install", { version: newVersion })}
        </button>
      </header>
    );
  }

  return null;
}
