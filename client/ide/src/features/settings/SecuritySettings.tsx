import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Switch as SettingsSwitch } from "../../shared/ui/Switch";
import { clearLocalActivity } from "./activity";
import {
  updateAppPreference,
  useAppPreferences,
  type PermissionMode,
} from "./preferences";
import { CompactSelect, SettingsGroup, SettingsRow } from "./SettingsControls";

const permissionOptions: Array<{ label: string; value: PermissionMode }> = [
  { label: "Confirm changes", value: "confirm-changes" },
  { label: "Read only", value: "read-only" },
  { label: "Read and write", value: "read-write" },
];

export function SecuritySettings() {
  const preferences = useAppPreferences();
  const [confirmClear, setConfirmClear] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);

  const clearHistory = () => {
    clearLocalActivity();
    setConfirmClear(false);
    setHistoryCleared(true);
    window.setTimeout(() => setHistoryCleared(false), 2_000);
  };

  return (
    <div className="settings-security mt-6 pb-8">
      <SettingsGroup title="Workspace protection">
        <SettingsRow
          description="Control manual file changes made through Coloride's Explorer and editor. Agent autonomy is configured separately in each chat."
          label="Explorer file access"
        >
          <CompactSelect
            ariaLabel="Explorer file access"
            onChange={(value) => updateAppPreference("permissionMode", value)}
            options={permissionOptions}
            value={preferences.permissionMode}
          />
        </SettingsRow>
        <SettingsRow
          description="Always ask before deleting files, folders or other saved resources."
          label="Destructive actions"
        >
          <SettingsSwitch
            checked={preferences.confirmDangerousActions}
            label="Confirm destructive actions"
            onChange={(checked) =>
              updateAppPreference("confirmDangerousActions", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="SSH connections">
        <SettingsRow
          description="Every server identity must match a trusted SHA-256 host fingerprint or Coloride CA."
          label="Host verification"
        >
          <SecurityStatus label="Required" tone="secure" />
        </SettingsRow>
        <SettingsRow
          description="Saved passwords and private credentials are kept outside app files in the operating system vault."
          label="Credential storage"
        >
          <SecurityStatus label="System Keychain" tone="secure" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Issue reports">
        <SettingsRow
          description="Include app version, connection state and operating-system details by default. File contents and terminal output are excluded."
          label="Include diagnostics"
        >
          <SettingsSwitch
            checked={preferences.includeDiagnosticsInReports}
            label="Include diagnostics in issue reports"
            onChange={(checked) =>
              updateAppPreference("includeDiagnosticsInReports", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Passwords, tokens, API keys and private keys are removed before a report is stored."
          label="Sensitive-data redaction"
        >
          <SecurityStatus label="Always on" tone="secure" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Local privacy">
        <SettingsRow
          description="Keep launch counts and active days on this device for the Account activity view."
          label="Activity history"
        >
          <SettingsSwitch
            checked={preferences.recordLocalActivity}
            label="Record local activity"
            onChange={(checked) =>
              updateAppPreference("recordLocalActivity", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Permanently remove locally stored launch and activity history from this device."
          label="Clear activity data"
        >
          <div className="relative flex min-h-7 items-center justify-end">
            <AnimatePresence initial={false} mode="wait">
              {historyCleared ? (
                <motion.span
                  animate={{ opacity: 1, y: 0 }}
                  className="security-success-text text-xs font-medium text-[#65bc89]"
                  exit={{ opacity: 0, y: -2 }}
                  initial={{ opacity: 0, y: 2 }}
                  key="cleared"
                >
                  History cleared
                </motion.span>
              ) : confirmClear ? (
                <motion.div
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1.5"
                  exit={{ opacity: 0, x: 4 }}
                  initial={{ opacity: 0, x: 4 }}
                  key="confirm"
                >
                  <Button size="sm" onClick={() => setConfirmClear(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="danger" onClick={clearHistory}>
                    Confirm clear
                  </Button>
                </motion.div>
              ) : (
                <motion.button
                  animate={{ opacity: 1 }}
                  className="settings-action-button h-7 rounded-lg bg-[#2c2c2c] px-2.5 text-xs text-[#d0d0d3] transition-colors hover:bg-[#353535] hover:text-white"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  key="clear"
                  onClick={() => setConfirmClear(true)}
                  type="button"
                >
                  Clear history
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function SecurityStatus({ label, tone }: { label: string; tone: "secure" }) {
  return (
    <span
      className="security-status inline-flex h-7 items-center rounded-lg bg-[#26352e] px-2.5 text-xs font-medium text-[#76c99b]"
      data-tone={tone}
    >
      {label}
    </span>
  );
}
