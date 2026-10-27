import { useEffect, useState } from "react";
import type { AppPreferences } from "../../features/settings/preferences";
interface Dependencies {
  appPreferences: AppPreferences;
  readStoredPanelSize: (key: string, fallback: number) => number;
  PANEL_SIZE_KEYS: readonly [
    "tree-width",
    "server-width",
    "settings-width",
    "terminal-height",
    "agent-width",
  ];
}
export function useAppPanelSizes({
  appPreferences,
  readStoredPanelSize,
  PANEL_SIZE_KEYS,
}: Dependencies) {
  const [treeWidth, setTreeWidth] = useState(() =>
    appPreferences.rememberPanelSizes
      ? readStoredPanelSize("tree-width", 240)
      : 240,
  );
  const [serverWidth, setServerWidth] = useState(() =>
    appPreferences.rememberPanelSizes
      ? readStoredPanelSize("server-width", 240)
      : 240,
  );
  const [settingsWidth, setSettingsWidth] = useState(() =>
    appPreferences.rememberPanelSizes
      ? readStoredPanelSize("settings-width", 240)
      : 240,
  );
  const [terminalHeight, setTerminalHeight] = useState(() =>
    appPreferences.rememberPanelSizes
      ? readStoredPanelSize("terminal-height", 224)
      : 224,
  );

  const [agentPanelWidth, setAgentPanelWidth] = useState(() =>
    appPreferences.rememberPanelSizes
      ? readStoredPanelSize("agent-width", 380)
      : 380,
  );

  useEffect(() => {
    if (!appPreferences.rememberPanelSizes) {
      PANEL_SIZE_KEYS.forEach((key) =>
        window.localStorage.removeItem(`coloride.layout.${key}`),
      );
      return;
    }
    window.localStorage.setItem("coloride.layout.tree-width", String(treeWidth));
    window.localStorage.setItem(
      "coloride.layout.server-width",
      String(serverWidth),
    );
    window.localStorage.setItem(
      "coloride.layout.settings-width",
      String(settingsWidth),
    );
    window.localStorage.setItem(
      "coloride.layout.terminal-height",
      String(terminalHeight),
    );
    window.localStorage.setItem(
      "coloride.layout.agent-width",
      String(agentPanelWidth),
    );
  }, [
    agentPanelWidth,
    appPreferences.rememberPanelSizes,
    serverWidth,
    settingsWidth,
    terminalHeight,
    treeWidth,
  ]);

  return {
    serverWidth,
    settingsWidth,
    treeWidth,
    setServerWidth,
    setSettingsWidth,
    setTreeWidth,
    agentPanelWidth,
    setAgentPanelWidth,
    terminalHeight,
    setTerminalHeight,
  };
}
