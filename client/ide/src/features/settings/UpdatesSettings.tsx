import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../shared/ui/Button";
import { Switch as SettingsSwitch } from "../../shared/ui/Switch";
import {
  updateAppPreference,
  useAppPreferences,
  type UpdateChannel,
} from "./preferences";
import { CompactSelect, SettingsGroup, SettingsRow } from "./SettingsControls";
import {
  openUpdateDownload,
  refreshUpdateStateFromMain,
  useUpdateState,
  type UpdateCheckResult,
} from "./updates";

const channelOptions: Array<{ label: string; value: UpdateChannel }> = [
  { label: "Stable", value: "stable" },
  { label: "Beta", value: "beta" },
];

const platformLabels: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

export function UpdatesSettings() {
  const preferences = useAppPreferences();
  const updateState = useUpdateState();
  const [appInfo, setAppInfo] = useState<ColorideAppInfo | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.colorideDesktop
      ?.getAppInfo?.()
      .then((info) => {
        if (active) setAppInfo(info);
      })
      .catch(() => {});
    void refreshUpdateStateFromMain();
    return () => {
      active = false;
    };
  }, []);

  const result =
    updateState.result?.channel === preferences.updateChannel
      ? updateState.result
      : updateState.result;
  const isElectronOwnVersion = (version: string | null | undefined) =>
    /^v?43\./.test(String(version || "").trim());
  const currentVersion =
    (result?.currentVersion && !isElectronOwnVersion(result.currentVersion)
      ? result.currentVersion
      : appInfo?.version && !isElectronOwnVersion(appInfo.version)
        ? appInfo.version
        : null) ?? "Unavailable";
  const autoUpdate = Boolean(
    result?.autoUpdateEnabled ?? updateState.autoUpdateEnabled,
  );
  const status = deriveStatusLabel(updateState, result);
  const tone = deriveTone(updateState, result);

  return (
    <div className="settings-updates mt-6 pb-8">
      <SettingsGroup title="Updates">
        <SettingsRow
          description={
            autoUpdate
              ? "Coloride downloads updates in the background and restarts automatically when ready."
              : "Automatic checks look for a newer version. Full in-app install requires the packaged desktop app."
          }
          label="Automatic checks"
        >
          <SettingsSwitch
            checked={preferences.checkForUpdatesAutomatically}
            label="Check for updates automatically"
            onChange={(checked) =>
              updateAppPreference("checkForUpdatesAutomatically", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Stable is production. Beta includes prerelease GitHub builds."
          label="Release channel"
        >
          <CompactSelect
            ariaLabel="Release channel"
            onChange={(channel) =>
              updateAppPreference("updateChannel", channel)
            }
            options={channelOptions}
            value={preferences.updateChannel}
          />
        </SettingsRow>
        <SettingsRow
          description="In-app download and restart (electron-updater). Dev builds stay on manual download only."
          label="Install mode"
        >
          <UpdateValue>
            {autoUpdate
              ? "Auto-update (installed app)"
              : "Manual / development"}
          </UpdateValue>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Installed version">
        <SettingsRow
          description="The Coloride desktop version currently running on this device."
          label="Current version"
        >
          <UpdateValue>
            {currentVersion === "Unavailable"
              ? currentVersion
              : `v${currentVersion}`}
          </UpdateValue>
        </SettingsRow>
        <SettingsRow
          description="The operating system and processor architecture used by this build."
          label="Build target"
        >
          <UpdateValue>
            {appInfo
              ? `${platformLabels[appInfo.platform] ?? appInfo.platform} · ${appInfo.arch}`
              : "Unavailable"}
          </UpdateValue>
        </SettingsRow>
        <SettingsRow
          description="Updates are checked automatically in the background."
          label="Update status"
        >
          <UpdateStatus label={status} tone={tone} />
        </SettingsRow>
        {updateState.lastCheckedAt && (
          <p className="settings-update-meta -mt-1 pb-2 text-right text-[11px] text-[#77777c]">
            Last checked {formatDate(updateState.lastCheckedAt)}
          </p>
        )}
        {(updateState.error || actionError) && (
          <p className="settings-update-error rounded-lg bg-[#3b292b] px-3 py-2 text-xs leading-5 text-[#e69a9f]">
            {actionError || updateState.error}
          </p>
        )}
      </SettingsGroup>

      {result?.available && (
        <SettingsGroup title="Available release">
          <SettingsRow
            description="The newest release published for the selected channel."
            label="Latest version"
          >
            <UpdateValue>v{result?.latestVersion || "—"}</UpdateValue>
          </SettingsRow>
          {result?.publishedAt && (
            <SettingsRow
              description="When this release was published by Coloride."
              label="Published"
            >
              <UpdateValue>{formatDate(result.publishedAt)}</UpdateValue>
            </SettingsRow>
          )}
          {result?.notes && (
            <div className="settings-update-notes my-2 rounded-xl bg-[#2c2c2c] px-3 py-2.5">
              <div className="text-xs font-medium text-[#e6e6e8]">
                Release notes
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#929297]">
                {result.notes}
              </p>
            </div>
          )}

          {!autoUpdate && result?.downloadUrl ? (
            <SettingsRow
              description="Open the official HTTPS download. Install the DMG manually (development / fallback)."
              label="Download"
            >
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  setActionError(null);
                  try {
                    await openUpdateDownload(result.downloadUrl!);
                  } catch (error) {
                    setActionError(
                      error instanceof Error ? error.message : String(error),
                    );
                  }
                }}
              >
                Open download
              </Button>
            </SettingsRow>
          ) : null}
        </SettingsGroup>
      )}
    </div>
  );
}

function deriveStatusLabel(
  updateState: ReturnType<typeof useUpdateState>,
  result: UpdateCheckResult | null,
): string {
  if (updateState.error || updateState.status === "error")
    return "Check failed";
  if (result?.available) return "Update available";
  if (result || updateState.status === "not-available") return "Up to date";
  return "Automatic checks enabled";
}

function deriveTone(
  updateState: ReturnType<typeof useUpdateState>,
  result: UpdateCheckResult | null,
): "available" | "current" | "error" | "neutral" {
  if (
    updateState.status === "downloaded" ||
    updateState.status === "installing" ||
    updateState.canInstall
  ) {
    return "available";
  }
  if (updateState.status === "downloading") return "available";
  if (updateState.error || updateState.status === "error") return "error";
  if (result?.available) return "available";
  if (result || updateState.status === "not-available") return "current";
  return "neutral";
}

function UpdateValue({ children }: { children: ReactNode }) {
  return (
    <span className="settings-update-value text-xs font-medium text-[#d8d8db]">
      {children}
    </span>
  );
}

function UpdateStatus({
  label,
  tone,
}: {
  label: string;
  tone: "available" | "current" | "error" | "neutral";
}) {
  return (
    <span
      className="settings-update-status inline-flex h-7 items-center gap-2 rounded-lg bg-[#2c2c2c] px-2.5 text-xs font-medium text-[#b8b8bc]"
      data-tone={tone}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {label}
    </span>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
