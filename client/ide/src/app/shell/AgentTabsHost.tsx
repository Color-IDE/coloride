import type { ExternalAgentInstallation } from "@coloride/contracts";
import { useEffect, useState, type MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import { AgentView } from "../../features/agents/AgentView";
import type { AgentViewProps } from "../../features/agents/agentViewTypes";
import {
  ExternalAgentView,
  externalAgentsApi,
  readAgentWorkspaceTabs,
  writeAgentWorkspaceTabs,
  type AgentWorkspaceTab,
} from "../../features/external-agents";
import { Menu, MenuItem } from "../../shared/ui/Menu";

type HostProps = AgentViewProps & {
  onResizeStart: MouseEventHandler<HTMLDivElement>;
};

export function AgentTabsHost(props: HostProps) {
  const stored = readAgentWorkspaceTabs();
  const [tabs, setTabs] = useState<AgentWorkspaceTab[]>(stored.tabs);
  const [selectedId, setSelectedId] = useState<string | null>(stored.selectedId);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [installations, setInstallations] = useState<ExternalAgentInstallation[]>([]);
  const selected = tabs.find((tab) => tab.id === selectedId) ?? tabs[0];

  useEffect(() => {
    writeAgentWorkspaceTabs(tabs, selectedId);
  }, [tabs, selectedId]);

  useEffect(() => {
    void externalAgentsApi.installations().then(setInstallations).catch(() => setInstallations([]));
  }, [menu]);

  const openExternal = async (installation: ExternalAgentInstallation) => {
    setMenu(null);
    if (props.workspaceKind === "ssh") {
      const id = `external-ssh-${installation.agentId}`;
      setTabs((current) => current.some((tab) => tab.id === id) ? current : [...current, { id, kind: "external", agentId: installation.agentId, sessionId: id }]);
      setSelectedId(id);
      return;
    }
    if (!props.workspacePath) return;
    const opened = await externalAgentsApi.openSession({
      agentId: installation.agentId,
      workspacePath: props.workspacePath,
      executionTarget: "local",
    });
    const tab: AgentWorkspaceTab = { id: opened.id, kind: "external", agentId: installation.agentId, sessionId: opened.id };
    setTabs((current) => current.some((item) => item.id === tab.id) ? current : [...current, tab]);
    setSelectedId(tab.id);
  };

  const closeTab = (tab: AgentWorkspaceTab) => {
    if (tab.kind === "external") void externalAgentsApi.close(tab.sessionId);
    setTabs((current) => {
      const remaining = current.filter((item) => item.id !== tab.id);
      return remaining.length ? remaining : [{ id: "coloride", kind: "coloride", sessionId: null }];
    });
    setSelectedId((current) => (current === tab.id ? "coloride" : current));
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {props.presentation !== "sidebar" ? (
        <div className="flex items-center gap-1 border-b border-[var(--agent-border,#333)] px-2 py-1">
          {tabs.map((tab) => (
            <button
              aria-selected={tab.id === selected?.id}
              className="rounded-control px-2 py-1 text-xs"
              key={tab.id}
              onClick={() => setSelectedId(tab.id)}
              role="tab"
              type="button"
            >
              {tab.kind === "external" ? "Codex" : tab.kind === "terminal" ? "Terminal" : "Coloride"}
              {tab.kind !== "coloride" ? (
                <span
                  aria-label={`Close ${tab.kind}`}
                  className="ml-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab);
                  }}
                  role="button"
                >
                  ×
                </span>
              ) : null}
            </button>
          ))}
          <button
            aria-label="Add tab"
            className="px-2 text-sm"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu(menu ? null : { x: rect.left, y: rect.bottom + 4 });
            }}
            type="button"
          >
            +
          </button>
        </div>
      ) : null}
      {menu
        ? createPortal(
            <Menu aria-label="Add tab" className="fixed z-[10060] w-[180px]" style={{ left: menu.x, top: menu.y }}>
              <MenuItem compact onClick={() => { setMenu(null); setSelectedId("coloride"); }}>
                Coloride Agent
              </MenuItem>
              {installations.filter((item) => item.status === "installed").map((item) => (
                <MenuItem compact key={item.id} onClick={() => void openExternal(item)}>
                  {item.name}
                </MenuItem>
              ))}
            </Menu>,
            document.body,
          )
        : null}
      <div className={selected?.kind === "coloride" || props.presentation === "sidebar" ? "min-h-0 flex-1" : "hidden"}>
        <AgentView {...props} />
      </div>
      {tabs.filter((tab) => tab.kind === "external").map((tab) => (
        <div className={selected?.id === tab.id && props.presentation !== "sidebar" ? "min-h-0 flex-1" : "hidden"} key={tab.id}>
          <ExternalAgentView
            active={Boolean(props.active) && selected?.id === tab.id}
            sessionId={tab.sessionId}
            workspaceKind={props.workspaceKind ?? "ssh"}
          />
        </div>
      ))}
    </div>
  );
}
