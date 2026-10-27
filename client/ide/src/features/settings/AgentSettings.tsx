import { CompactSelect, SettingsGroup, SettingsRow } from "./SettingsControls";
import {
  setDefaultAgentAccessLevel,
  useDefaultAgentAccessLevel,
  type AgentAccessLevel,
} from "./agentAccess";
import {
  updateAppPreference,
  useAppPreferences,
  type AgentActivityDetail,
} from "./preferences";

const accessOptions: Array<{ label: string; value: AgentAccessLevel }> = [
  { label: "Request approval", value: "request" },
  { label: "Agent decides", value: "agent" },
  { label: "Full access", value: "full" },
];

const activityOptions: Array<{ label: string; value: AgentActivityDetail }> = [
  { label: "Minimal", value: "minimal" },
  { label: "Normal", value: "normal" },
  { label: "Verbose", value: "verbose" },
];

export function AgentSettings() {
  const defaultAccess = useDefaultAgentAccessLevel();
  const preferences = useAppPreferences();

  return (
    <div className="settings-agent mt-6 pb-8">
      <SettingsGroup title="Autonomy">
        <SettingsRow
          description="Applies to new chats. The agent always works inside the Coloride folder."
          label="Default access"
        >
          <CompactSelect
            ariaLabel="Default agent access"
            onChange={setDefaultAgentAccessLevel}
            options={accessOptions}
            value={defaultAccess}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Activity">
        <SettingsRow
          description="Show intent and effects. Hide repetitive internals unless you want every tool call."
          label="Agent activity"
        >
          <CompactSelect
            ariaLabel="Agent activity detail"
            onChange={(value) =>
              updateAppPreference("agentActivityDetail", value)
            }
            options={activityOptions}
            value={preferences.agentActivityDetail}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
