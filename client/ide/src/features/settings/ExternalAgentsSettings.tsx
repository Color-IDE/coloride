import type { ExternalAgentInstallation, ExternalAgentRegistryEntry } from "@coloride/contracts";
import { useEffect, useState } from "react";
import { externalAgentsApi } from "../external-agents";
import { SettingsGroup, SettingsRow } from "./SettingsControls";

export function ExternalAgentsSettings() {
  const [entries, setEntries] = useState<ExternalAgentRegistryEntry[]>([]);
  const [installations, setInstallations] = useState<ExternalAgentInstallation[]>([]);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    const [catalog, installed] = await Promise.all([
      externalAgentsApi.registry(),
      externalAgentsApi.installations(),
    ]);
    setEntries(catalog);
    setInstallations(installed);
  };

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setMessage(reason instanceof Error ? reason.message : "Could not read the agent catalog.");
    });
  }, []);

  const install = async (agentId: string) => {
    setMessage("Installing…");
    try {
      await externalAgentsApi.install(agentId);
      await refresh();
      setMessage("Installed. Opening Coloride again uses this same version.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Install failed.");
    }
  };

  return (
    <div className="settings-agent mt-6 pb-8" data-settings-category="External agents">
      <SettingsGroup title="Catalog">
        {entries.filter((entry) => entry.id === "codex-acp").map((entry) => (
          <SettingsRow
            description={`${entry.description} Registry version ${entry.version}.`}
            key={entry.id}
            label={entry.name}
          >
            <button
              className="rounded-control border border-[#3a3a3a] px-3 py-1 text-xs"
              onClick={() => void install(entry.id)}
              type="button"
            >
              {entry.installed ? `Installed ${entry.installedVersion}` : "Install"}
            </button>
          </SettingsRow>
        ))}
      </SettingsGroup>
      <SettingsGroup title="Installed">
        {installations.length === 0 ? (
          <SettingsRow description="Install Codex from the catalog. Its login stays with Codex." label="None yet">
            <span />
          </SettingsRow>
        ) : installations.map((item) => (
          <SettingsRow description={`${item.distribution} · ${item.status}${item.error ? ` · ${item.error}` : ""}`} key={item.id} label={`${item.name} ${item.version}`}>
            <button
              className="rounded-control border border-[#3a3a3a] px-3 py-1 text-xs"
              onClick={() => void externalAgentsApi.uninstall(item.id).then(refresh)}
              type="button"
            >
              Uninstall
            </button>
          </SettingsRow>
        ))}
      </SettingsGroup>
      {message ? <p className="mt-3 text-xs text-[#85858a]">{message}</p> : null}
    </div>
  );
}
