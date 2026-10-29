import type {
  ExternalAgentInstallation,
  ExternalAgentRegistryEntry,
} from "@coloride/contracts";
import {
  useCallback,
  useEffect,
  useState,
  type MouseEventHandler,
} from "react";
import { createPortal } from "react-dom";
import { AgentView } from "../../features/agents/AgentView";
import type { AgentViewProps } from "../../features/agents/agentViewTypes";
import {
  ExternalAgentView,
  externalAgentsApi,
  isOfferedAgent,
  readAgentWorkspaceTabs,
  writeAgentWorkspaceTabs,
  type AgentWorkspaceTab,
} from "../../features/external-agents";

function externalTabTitle(title: string | null | undefined) {
  const text = title?.replace(/\s+/g, " ").trim();
  if (!text || /^(codex|external agent)$/i.test(text)) return "New chat";
  return text.length > 22 ? `${text.slice(0, 22).trimEnd()}…` : text;
}
import { Menu, MenuItem } from "../../shared/ui/Menu";

type HostProps = AgentViewProps & {
  onResizeStart: MouseEventHandler<HTMLDivElement>;
};

export function AgentTabsHost(props: HostProps) {
  const namespace = JSON.stringify([
    props.workspaceKind,
    props.workspacePath,
    props.presentation ?? "full",
  ]);
  return (
    <AgentTabsWorkspace
      key={namespace}
      {...props}
      storageNamespace={namespace}
    />
  );
}

function AgentTabsWorkspace(props: HostProps & { storageNamespace: string }) {
  const [stored] = useState(() =>
    readAgentWorkspaceTabs(props.storageNamespace),
  );
  const [tabs, setTabs] = useState<AgentWorkspaceTab[]>(stored.tabs);
  const [selectedId, setSelectedId] = useState<string | null>(
    stored.selectedId,
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<Record<string, boolean>>({});
  const [installations, setInstallations] = useState<
    ExternalAgentInstallation[]
  >([]);
  const [registry, setRegistry] = useState<ExternalAgentRegistryEntry[]>([]);
  const [externalTitles, setExternalTitles] = useState<Record<string, string>>(
    {},
  );
  const selected = tabs.find((tab) => tab.id === selectedId) ?? tabs[0];

  useEffect(() => {
    writeAgentWorkspaceTabs(tabs, selectedId, props.storageNamespace);
  }, [tabs, selectedId, props.storageNamespace]);

  const refreshInstallations = useCallback(() => {
    void externalAgentsApi
      .installations()
      .then((items) =>
        setInstallations(
          items.filter((item) => isOfferedAgent(item.agentId)),
        ),
      )
      .catch(() => undefined);
    void externalAgentsApi
      .registry()
      .then((entries) =>
        setRegistry(entries.filter((entry) => isOfferedAgent(entry.id))),
      )
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refreshInstallations();
    window.addEventListener("focus", refreshInstallations);
    window.addEventListener("storage", refreshInstallations);
    window.addEventListener(
      "coloride:external-agents-changed",
      refreshInstallations,
    );
    return () => {
      window.removeEventListener("focus", refreshInstallations);
      window.removeEventListener("storage", refreshInstallations);
      window.removeEventListener(
        "coloride:external-agents-changed",
        refreshInstallations,
      );
    };
  }, [refreshInstallations]);
  useEffect(() => {
    if (menu) refreshInstallations();
  }, [menu, refreshInstallations]);
  useEffect(() => {
    const open = tabs.filter((tab) => tab.kind === "external");
    if (!open.length) return;
    let cancelled = false;
    const refreshTitles = () => {
      void Promise.all(
        open.map(async (tab) => {
          if (tab.kind !== "external") return null;
          try {
            return [tab.id, (await externalAgentsApi.session(tab.sessionId)).title] as const;
          } catch {
            return null;
          }
        }),
      ).then((pairs) => {
        if (cancelled) return;
        setExternalTitles((current) => {
          const next = { ...current };
          for (const pair of pairs) {
            if (pair) next[pair[0]] = pair[1];
          }
          return next;
        });
      });
    };
    refreshTitles();
    const timer = window.setInterval(refreshTitles, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tabs]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);

  const openExternal = (installation: ExternalAgentInstallation) => {
    setMenu(null);
    if (props.workspaceKind !== "local") {
      setError("External agents currently support local projects only.");
      return;
    }
    if (!props.workspacePath) {
      setError("Open a local project folder first.");
      return;
    }
    const tabId = `external-agent:${crypto.randomUUID()}`;
    const tab: AgentWorkspaceTab = {
      id: tabId,
      kind: "external",
      agentId: installation.agentId,
      sessionId: "",
    };
    setError("");
    setTabs((current) => [...current, tab]);
    setSelectedId(tabId);
    setOpening((current) => ({ ...current, [tabId]: true }));
    void externalAgentsApi
      .openSession({
        agentId: installation.agentId,
        workspacePath: props.workspacePath,
        executionTarget: "local",
      })
      .then((opened) => {
        setTabs((current) =>
          current.map((item) =>
            item.id === tabId && item.kind === "external"
              ? { ...item, sessionId: opened.id }
              : item,
          ),
        );
      })
      .catch((reason: unknown) => {
        setTabs((current) => current.filter((item) => item.id !== tabId));
        setSelectedId((current) => (current === tabId ? "coloride" : current));
        setError(
          reason instanceof Error ? reason.message : "Could not open the agent.",
        );
      })
      .finally(() => {
        setOpening((current) => {
          const next = { ...current };
          delete next[tabId];
          return next;
        });
      });
  };

  const closeTab = async (tab: AgentWorkspaceTab) => {
    try {
      if (tab.kind === "external" && tab.sessionId)
        await externalAgentsApi.close(tab.sessionId);
      const remaining = tabs.filter((item) => item.id !== tab.id);
      const next: AgentWorkspaceTab[] = remaining.length
        ? remaining
        : [{ id: "coloride", kind: "coloride", sessionId: null }];
      setTabs(next);
      if (selectedId === tab.id) {
        const coloride = next.find((item) => item.kind === "coloride");
        setSelectedId(coloride?.id ?? next[0].id);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not close the agent.",
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {props.presentation !== "sidebar" ? (
        <div
          aria-label="Agent tabs"
          role="tablist"
          className="flex items-center gap-1 overflow-x-auto border-b border-[var(--agent-border,#333)] px-2 py-1"
        >
          {tabs.map((tab) => (
            <div className="flex shrink-0 items-center" key={tab.id}>
              <button
                aria-selected={tab.id === selected?.id}
                className="rounded-control px-2 py-1 text-xs text-primary aria-selected:bg-surface-selected"
                onClick={() => setSelectedId(tab.id)}
                role="tab"
                type="button"
              >
                {tab.kind === "external"
                  ? (installations.find((item) => item.agentId === tab.agentId)
                      ?.name ?? tab.agentId)
                  : tab.kind === "terminal"
                    ? "Terminal"
                    : "Coloride"}
              </button>
              {tab.kind !== "coloride" ? (
                <button
                  aria-label={`Close ${tab.kind === "external" ? tab.agentId : "terminal"} tab`}
                  className="px-1 text-xs"
                  onClick={() => void closeTab(tab)}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          <button
            aria-label="Add tab"
            className="px-2 text-sm"
            onClick={(event) => {
              event.stopPropagation();
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
            <Menu
              onClick={(event) => event.stopPropagation()}
              aria-label="Add tab"
              className="fixed z-[10060] w-[180px]"
              style={{ left: menu.x, top: menu.y }}
            >
              <MenuItem
                compact
                onClick={() => {
                  setMenu(null);
                  setSelectedId("coloride");
                }}
              >
                Coloride Agent
              </MenuItem>
              {installations
                .filter((item) => item.status === "installed")
                .map((item) => (
                  <MenuItem
                    compact
                    key={item.id}
                    onClick={() => openExternal(item)}
                  >
                    {item.name}
                  </MenuItem>
                ))}
            </Menu>,
            document.body,
          )
        : null}
      {error ? (
        <p className="px-3 py-2 text-xs text-[#dc9292]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <AgentView
          {...props}
          active={Boolean(props.active)}
          externalAgentOptions={installations
            .filter((item) => item.status === "installed")
            .map((item) => ({
              agentId: item.agentId,
              name: item.name,
              icon: registry.find((entry) => entry.id === item.agentId)?.icon,
            }))}
          externalAgentTabs={tabs
            .filter((tab) => tab.kind === "external")
            .map((tab) => ({
              id: tab.id,
              agentId: tab.agentId,
              title: externalTabTitle(externalTitles[tab.id]),
              icon: registry.find((entry) => entry.id === tab.agentId)?.icon,
            }))}
          activeExternalAgentId={
            selected?.kind === "external" ? selected.id : null
          }
          onSelectExternalAgent={(id) =>
            setSelectedId(id || "coloride")
          }
          onCloseExternalAgent={(id) => {
            const tab = tabs.find((item) => item.id === id);
            if (tab) void closeTab(tab);
          }}
          onOpenExternalAgent={(id) => {
            const installation = installations.find(
              (item) => item.agentId === id,
            );
            if (installation) void openExternal(installation);
          }}
          externalAgentView={
            props.presentation === "sidebar"
              ? tabs
                  .filter((tab) => tab.kind === "external")
                  .map((tab) => (
                    <div
                      className={
                        selected?.id === tab.id
                          ? "min-h-0 flex-1"
                          : "hidden"
                      }
                      key={tab.id}
                    >
                      <ExternalAgentView
                        active={
                          Boolean(props.active) && selected?.id === tab.id
                        }
                        sessionId={tab.sessionId}
                        starting={Boolean(opening[tab.id])}
                        workspaceKind={props.workspaceKind ?? "ssh"}
                      />
                    </div>
                  ))
              : undefined
          }
        />
      </div>
      {props.presentation === "sidebar"
        ? null
        : tabs
            .filter((tab) => tab.kind === "external")
            .map((tab) => (
              <div
                className={
                  selected?.id === tab.id ? "min-h-0 flex-1" : "hidden"
                }
                key={tab.id}
              >
                <ExternalAgentView
                  active={Boolean(props.active) && selected?.id === tab.id}
                  sessionId={tab.sessionId}
                  starting={Boolean(opening[tab.id])}
                  workspaceKind={props.workspaceKind ?? "ssh"}
                />
              </div>
            ))}
    </div>
  );
}
