import { Switch as SettingsSwitch } from "../../shared/ui/Switch";
import {
  updateAppPreference,
  useAppPreferences,
  type TerminalCursorStyle,
} from "./preferences";
import { CompactSelect, SettingsGroup, SettingsRow } from "./SettingsControls";

const cursorOptions: Array<{ label: string; value: TerminalCursorStyle }> = [
  { label: "Bar", value: "bar" },
  { label: "Block", value: "block" },
  { label: "Underline", value: "underline" },
];

const scrollbackOptions = [
  { label: "1,000 lines", value: "1000" },
  { label: "5,000 lines", value: "5000" },
  { label: "10,000 lines", value: "10000" },
  { label: "50,000 lines", value: "50000" },
];

const contrastOptions = [
  { label: "Standard", value: "1" },
  { label: "Enhanced", value: "4.5" },
  { label: "High", value: "7" },
];

export function TerminalSettings() {
  const preferences = useAppPreferences();

  return (
    <div className="settings-terminal mt-6 pb-8">
      <SettingsGroup title="Cursor">
        <SettingsRow
          description="Choose the shape used by the active terminal cursor."
          label="Cursor style"
        >
          <CompactSelect
            ariaLabel="Terminal cursor style"
            onChange={(value) =>
              updateAppPreference("terminalCursorStyle", value)
            }
            options={cursorOptions}
            value={preferences.terminalCursorStyle}
          />
        </SettingsRow>
        <SettingsRow
          description="Blink the cursor while the terminal is focused."
          label="Cursor blinking"
        >
          <SettingsSwitch
            checked={preferences.terminalCursorBlink}
            label="Terminal cursor blinking"
            onChange={(checked) =>
              updateAppPreference("terminalCursorBlink", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Buffer">
        <SettingsRow
          description="Keep this many previous output lines available for scrolling."
          label="Scrollback"
        >
          <CompactSelect
            ariaLabel="Terminal scrollback"
            onChange={(value) =>
              updateAppPreference("terminalScrollback", Number(value))
            }
            options={scrollbackOptions}
            value={String(preferences.terminalScrollback)}
          />
        </SettingsRow>
        <SettingsRow
          description="Animate movement through terminal history and command output."
          label="Smooth scrolling"
        >
          <SettingsSwitch
            checked={preferences.terminalSmoothScrolling}
            label="Terminal smooth scrolling"
            onChange={(checked) =>
              updateAppPreference("terminalSmoothScrolling", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Increase foreground contrast when command colors are difficult to read."
          label="Text contrast"
        >
          <CompactSelect
            ariaLabel="Terminal text contrast"
            onChange={(value) =>
              updateAppPreference("terminalMinimumContrastRatio", Number(value))
            }
            options={contrastOptions}
            value={String(preferences.terminalMinimumContrastRatio)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Interaction">
        <SettingsRow
          description="Copy selected terminal text to the clipboard immediately."
          label="Copy on selection"
        >
          <SettingsSwitch
            checked={preferences.terminalCopyOnSelect}
            label="Copy terminal selection"
            onChange={(checked) =>
              updateAppPreference("terminalCopyOnSelect", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Require Command or Control when opening URLs and remote file paths."
          label="Link modifier"
        >
          <SettingsSwitch
            checked={preferences.terminalRequireLinkModifier}
            label="Require modifier to open terminal links"
            onChange={(checked) =>
              updateAppPreference("terminalRequireLinkModifier", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Send the Option key as Meta for shell and command-line shortcuts on macOS."
          label="Option as Meta"
        >
          <SettingsSwitch
            checked={preferences.terminalMacOptionIsMeta}
            label="Use Option as terminal Meta key"
            onChange={(checked) =>
              updateAppPreference("terminalMacOptionIsMeta", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
