import { Switch as SettingsSwitch } from "../../shared/ui/Switch";
import { ensureDesktopNotificationPermission } from "./notifications";
import {
  updateAppPreference,
  useAppPreferences,
  type AfterConnectBehavior,
  type StartupBehavior,
} from "./preferences";
import { CompactSelect, SettingsGroup, SettingsRow } from "./SettingsControls";

const startupOptions: Array<{ label: string; value: StartupBehavior }> = [
  { label: "Restore last session", value: "restore-session" },
];

const afterConnectOptions: Array<{
  label: string;
  value: AfterConnectBehavior;
}> = [
  { label: "Open file browser", value: "file-browser" },
  { label: "Open server health", value: "server-health" },
];

export function GeneralSettings() {
  const preferences = useAppPreferences();

  return (
    <div className="settings-general mt-6 pb-8">
      <SettingsGroup title="General">
        <SettingsRow
          description="Choose the first screen shown when Coloride starts."
          label="On startup"
        >
          <CompactSelect
            ariaLabel="Startup behavior"
            onChange={(value) => updateAppPreference("startupBehavior", value)}
            options={startupOptions}
            value={preferences.startupBehavior}
          />
        </SettingsRow>
        <SettingsRow
          description="Choose where Coloride takes you after the VPS is ready."
          label="After connecting"
        >
          <CompactSelect
            ariaLabel="After connecting"
            onChange={(value) =>
              updateAppPreference("afterConnectBehavior", value)
            }
            options={afterConnectOptions}
            value={preferences.afterConnectBehavior}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Session">
        <SettingsRow
          description="Reopen the last VPS workspace folder, expanded tree folders, and app tab after restart (requires On startup → Restore last session)."
          label="Remember workspace"
        >
          <span className="text-[11px] text-[#878888]">
            {preferences.startupBehavior === "restore-session"
              ? "On"
              : "Set startup to Restore last session"}
          </span>
        </SettingsRow>
        <SettingsRow
          description="Reopen editor tabs from the previous workspace session."
          label="Restore open files"
        >
          <SettingsSwitch
            checked={preferences.restoreOpenFiles}
            label="Restore open files"
            onChange={(checked) =>
              updateAppPreference("restoreOpenFiles", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Keep your sidebar and bottom-panel dimensions between launches."
          label="Remember panel sizes"
        >
          <SettingsSwitch
            checked={preferences.rememberPanelSizes}
            label="Remember panel sizes"
            onChange={(checked) =>
              updateAppPreference("rememberPanelSizes", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Notifications">
        <SettingsRow
          description="Notify when a VPS connects, disconnects or becomes unavailable."
          label="Connection changes"
        >
          <SettingsSwitch
            checked={preferences.notifyConnectionChanges}
            label="Connection change notifications"
            onChange={async (checked) => {
              if (checked && !(await ensureDesktopNotificationPermission()))
                return;
              updateAppPreference("notifyConnectionChanges", checked);
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export { Switch as SettingsSwitch } from "../../shared/ui/Switch";

export { CompactSelect, SettingsGroup, SettingsRow } from "./SettingsControls";
