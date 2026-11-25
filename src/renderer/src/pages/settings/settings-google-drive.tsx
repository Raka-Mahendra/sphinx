import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudIcon, LinkExternalIcon } from "@primer/octicons-react";
import type { GoogleDriveState } from "@types";

import { Button, ConfirmationModal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { SettingsIntegrationCard } from "./settings-integration-card";
import "./settings-google-drive.scss";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
};

export function SettingsGoogleDrive() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [state, setState] = useState<GoogleDriveState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [disconnectMode, setDisconnectMode] = useState<
    "keep" | "delete" | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      setState(await window.electron.getGoogleDriveState());
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : t("google_drive_unavailable")
      );
    } finally {
      setIsLoading(false);
    }
  }, [showErrorToast, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (
    action: () => Promise<GoogleDriveState | unknown>,
    successKey: string
  ) => {
    setIsBusy(true);
    try {
      await action();
      await refresh();
      showSuccessToast(t(successKey));
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : t("google_drive_unavailable")
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleConnect = () =>
    run(() => window.electron.connectGoogleDrive(), "google_drive_connected");

  const handleDisconnect = (deleteCloudData: boolean) => {
    setDisconnectMode(null);
    void run(
      () => window.electron.disconnectGoogleDrive(deleteCloudData),
      deleteCloudData
        ? "google_drive_disconnected_with_data"
        : "google_drive_disconnected"
    );
  };

  const updateSetting = async (patch: Record<string, number>) => {
    const next = await window.electron.setGoogleDriveSettings(patch);
    setState((previous) =>
      previous ? { ...previous, settings: next } : previous
    );
  };

  const configured = state?.configured ?? false;
  const connected = state?.connected ?? false;
  const usage = state?.usage;
  const status = !configured
    ? t("google_drive_not_configured")
    : connected
      ? t("google_drive_status_connected")
      : t("google_drive_status_disconnected");

  return (
    <>
      <SettingsIntegrationCard
        title={t("google_drive")}
        logo={<CloudIcon size={22} />}
        status={status}
        statusTone={connected ? "success" : configured ? "warning" : "neutral"}
        loading={isLoading}
        actions={
          configured ? (
            <>
              {connected ? (
                <Button
                  theme="danger"
                  onClick={() => setDisconnectMode("keep")}
                  disabled={isBusy}
                >
                  {t("integration_disconnect")}
                </Button>
              ) : (
                <Button onClick={handleConnect} disabled={isBusy}>
                  <LinkExternalIcon size={14} />
                  {t("integration_connect")}
                </Button>
              )}
            </>
          ) : (
            <Button disabled>{t("integration_connect")}</Button>
          )
        }
      >
        <p className="settings-integration-card__description">
          {configured
            ? t("google_drive_description")
            : t("google_drive_not_configured_description")}
        </p>

        {connected && usage && (
          <p className="settings-google-drive__usage">
            {t("google_drive_usage", {
              saves: formatBytes(usage.cloudSaveBytes),
              files: usage.cloudSaveFileCount,
            })}
            {usage.limitBytes
              ? ` · ${t("google_drive_quota", {
                  used: formatBytes(usage.usageBytes),
                  total: formatBytes(usage.limitBytes),
                  remaining: formatBytes(
                    Math.max(0, usage.limitBytes - usage.usageBytes)
                  ),
                })}`
              : ""}
          </p>
        )}

        {connected && state?.tokenStorage === "memory" && (
          <p className="settings-google-drive__warning" role="alert">
            {t("google_drive_memory_only")}
          </p>
        )}

        {state?.error && (
          <p className="settings-google-drive__warning" role="alert">
            {state.error}
          </p>
        )}

        {connected && state && (
          <div className="settings-google-drive__settings">
            <label>
              <span>{t("google_drive_retention")}</span>
              <input
                type="number"
                min={1}
                max={10}
                defaultValue={state.settings.retentionVersions}
                disabled={isBusy}
                onBlur={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  if (Number.isFinite(value)) {
                    void updateSetting({ retentionVersions: value });
                  }
                }}
              />
            </label>
            <label>
              <span>{t("google_drive_confirm_mb")}</span>
              <input
                type="number"
                min={1}
                defaultValue={Math.round(
                  state.settings.confirmUploadBytes / (1024 * 1024)
                )}
                disabled={isBusy}
                onBlur={(event) => {
                  const megabytes = Number.parseInt(event.target.value, 10);
                  if (Number.isFinite(megabytes) && megabytes > 0) {
                    void updateSetting({
                      confirmUploadBytes: megabytes * 1024 * 1024,
                    });
                  }
                }}
              />
            </label>
          </div>
        )}
        {connected && (
          <button
            type="button"
            className="settings-google-drive__delete-link"
            onClick={() => setDisconnectMode("delete")}
            disabled={isBusy}
          >
            {t("google_drive_delete_confirm")}
          </button>
        )}
      </SettingsIntegrationCard>

      <ConfirmationModal
        visible={disconnectMode !== null}
        onClose={() => setDisconnectMode(null)}
        title={t(
          disconnectMode === "delete"
            ? "google_drive_delete_title"
            : "google_drive_disconnect_title"
        )}
        descriptionText={t(
          disconnectMode === "delete"
            ? "google_drive_delete_description"
            : "google_drive_disconnect_description"
        )}
        confirmButtonLabel={t(
          disconnectMode === "delete"
            ? "google_drive_delete_confirm"
            : "google_drive_disconnect_keep_data"
        )}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        buttonsIsDisabled={isBusy}
        onConfirm={() => handleDisconnect(disconnectMode === "delete")}
      />
    </>
  );
}
