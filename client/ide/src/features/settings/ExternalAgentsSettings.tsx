import type {
  ExternalAgentInstallation,
  ExternalAgentRegistryEntry,
} from "@coloride/contracts";
import {
  Download01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "../../shared/ui/Icon";
import {
  AgentMark,
  externalAgentsApi,
  isOfferedAgent,
} from "../external-agents";
import "./styles/external-agents.css";

type Filter = "all" | "installed" | "available";

function AgentLinkIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

function ExternalLink({
  href,
  children,
  label,
}: {
  href?: string | null;
  children: ReactNode;
  label: string;
}) {
  if (!href || !/^https?:\/\//i.test(href)) return null;
  return (
    <a
      aria-label={label}
      href={href}
      rel="noreferrer"
      target="_blank"
      title={label}
      onClick={(event) => {
        if (window.colorideDesktop?.openExternal) {
          event.preventDefault();
          void window.colorideDesktop.openExternal(href);
        }
      }}
    >
      {children}
    </a>
  );
}

export function ExternalAgentsSettings() {
  const [entries, setEntries] = useState<ExternalAgentRegistryEntry[]>([]);
  const [installations, setInstallations] = useState<
    ExternalAgentInstallation[]
  >([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hostMissing, setHostMissing] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      externalAgentsApi.registry(),
      externalAgentsApi.installations(),
    ]);
    if (!mounted.current) return;
    const [catalog, installed] = results;
    if (catalog.status === "fulfilled")
      setEntries(catalog.value.filter((entry) => isOfferedAgent(entry.id)));
    if (installed.status === "fulfilled")
      setInstallations(
        installed.value.filter((item) => isOfferedAgent(item.agentId)),
      );
    const failure = results.find((result) => result.status === "rejected");
    const message =
      failure?.status === "rejected"
        ? String(
            failure.reason instanceof Error
              ? failure.reason.message
              : failure.reason,
          )
        : "";
    setHostMissing(message.startsWith("Coloride API 404:"));
    setError(message);
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const perform = async (
    entry: ExternalAgentRegistryEntry,
    installation?: ExternalAgentInstallation,
  ) => {
    if (pending[entry.id]) return;
    const removing = installation?.status === "installed";
    setPending((current) => ({
      ...current,
      [entry.id]: removing ? "Removing…" : "Installing…",
    }));
    setError("");
    setNotice("");
    try {
      if (removing) await externalAgentsApi.uninstall(installation.id);
      else await externalAgentsApi.install(entry.id, entry.version);
      if (!mounted.current) return;
      window.localStorage.setItem(
        "coloride.external-agents.installations-updated",
        String(Date.now()),
      );
      window.dispatchEvent(new Event("coloride:external-agents-changed"));
      setNotice(
        removing
          ? `${entry.name} removed. Saved conversations have been kept.`
          : `${entry.name} installed. Choose it from the + menu in the agent panel.`,
      );
      await refresh();
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "The operation failed. Please retry.",
        );
    } finally {
      if (mounted.current)
        setPending((current) => {
          const next = { ...current };
          delete next[entry.id];
          return next;
        });
    }
  };

  const byAgent = new Map(installations.map((item) => [item.agentId, item]));
  const catalog = [...entries];
  for (const item of installations) {
    if (!catalog.some((entry) => entry.id === item.agentId))
      catalog.push({
        id: item.agentId,
        name: item.name,
        version: item.version,
        description: "Installed on this computer.",
        distributionKind: item.distribution,
        installed: item.status === "installed",
        installedVersion: item.version,
      });
  }
  const needle = query.trim().toLocaleLowerCase();
  const visible = catalog
    .filter((entry) => {
      const installed = byAgent.get(entry.id)?.status === "installed";
      return (
        (filter === "all" ||
          (filter === "installed" ? installed : !installed)) &&
        `${entry.name} ${entry.id} ${entry.description}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section
      className="acp-registry settings-section-group"
      data-settings-category="External agents"
      data-settings-group="ACP Registry"
      id="settings-group-acp-registry"
      aria-label="ACP Registry"
    >
      <header className="acp-registry-heading">
        <h2>ACP Registry</h2>
      </header>
      <div className="acp-registry-toolbar">
        <label className="acp-registry-search">
          <Icon icon={Search01Icon} size={14} />
          <input
            aria-label="Search agents"
            placeholder="Search agents…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          className="acp-registry-filters"
          role="group"
          aria-label="Filter agents"
        >
          {(
            [
              ["all", "All"],
              ["installed", "Installed"],
              ["available", "Not Installed"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={filter === value}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {hostMissing ? (
        <div className="acp-registry-error" role="alert">
          <strong>The running host needs an update.</strong>
          <p>
            Restart the host to load External Agents. This closes open terminal
            processes and reopens Coloride. Save your work first.
          </p>
          {window.colorideDesktop?.restartHost ? (
            <button
              type="button"
              onClick={() => {
                setNotice("Restarting the host…");
                void window.colorideDesktop!.restartHost!().catch(
                  (reason: unknown) =>
                    setNotice(
                      reason instanceof Error
                        ? reason.message
                        : "Could not restart the host.",
                    ),
                );
              }}
            >
              Restart host and close terminals
            </button>
          ) : (
            <p>
              Close terminal tabs, then stop pnpm dev and start it again to load
              the updated desktop.
            </p>
          )}
        </div>
      ) : error ? (
        <div className="acp-registry-error" role="alert">
          {error}
          <button onClick={() => void refresh()} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {notice || loading ? (
        <p className="acp-registry-status" role="status">
          {notice || "Loading agents…"}
        </p>
      ) : null}
      <div className="acp-registry-list" aria-busy={loading}>
        {visible.map((entry) => {
          const installation = byAgent.get(entry.id);
          const installed = installation?.status === "installed";
          return (
            <article
              className="acp-agent-card settings-preference-row"
              key={entry.id}
              aria-label={entry.name}
            >
              <div className="acp-agent-title">
                <AgentMark
                  agentId={entry.id}
                  icon={entry.icon}
                  name={entry.name}
                />
                <h3>{entry.name}</h3>
                <span className="acp-agent-version">
                  v{installed ? installation.version : entry.version}
                </span>
              </div>
              <div className="acp-agent-links">
                <ExternalLink
                  href={entry.repository}
                  label={`${entry.name} repository`}
                >
                  <AgentLinkIcon>
                    <path
                      d="M16.24 22a1 1 0 0 1-1-1v-2.6a2.15 2.15 0 0 0-.54-1.66a1 1 0 0 1 .61-1.67C17.75 14.78 20 14 20 9.77a4 4 0 0 0-.67-2.22a2.75 2.75 0 0 1-.41-2.06a3.7 3.7 0 0 0 0-1.41a7.7 7.7 0 0 0-2.09 1.09a1 1 0 0 1-.84.15a10.15 10.15 0 0 0-5.52 0a1 1 0 0 1-.84-.15a7.4 7.4 0 0 0-2.11-1.09a3.5 3.5 0 0 0 0 1.41a2.84 2.84 0 0 1-.43 2.08a4.07 4.07 0 0 0-.67 2.23c0 3.89 1.88 4.93 4.7 5.29a1 1 0 0 1 .82.66a1 1 0 0 1-.21 1a2.06 2.06 0 0 0-.55 1.56V21a1 1 0 0 1-2 0v-.57a6 6 0 0 1-5.27-2.09a3.9 3.9 0 0 0-1.16-.88a1 1 0 1 1 .5-1.94a4.9 4.9 0 0 1 2 1.36c1 1 2 1.88 3.9 1.52a3.9 3.9 0 0 1 .23-1.58c-2.06-.52-5-2-5-7a6 6 0 0 1 1-3.33a.85.85 0 0 0 .13-.62a5.7 5.7 0 0 1 .33-3.21a1 1 0 0 1 .63-.57c.34-.1 1.56-.3 3.87 1.2a12.16 12.16 0 0 1 5.69 0c2.31-1.5 3.53-1.31 3.86-1.2a1 1 0 0 1 .63.57a5.7 5.7 0 0 1 .33 3.22a.75.75 0 0 0 .11.57a6 6 0 0 1 1 3.34c0 5.07-2.92 6.54-5 7a4.3 4.3 0 0 1 .22 1.67V21a1 1 0 0 1-.94 1"
                      fill="currentColor"
                    />
                  </AgentLinkIcon>
                </ExternalLink>
                <ExternalLink
                  href={entry.website}
                  label={`${entry.name} website`}
                >
                  <AgentLinkIcon>
                    <g
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    >
                      <path d="M13.544 10.456a4.37 4.37 0 0 0-6.176 0l-3.089 3.088a4.367 4.367 0 1 0 6.177 6.177L12 18.177" />
                      <path d="M10.456 13.544a4.37 4.37 0 0 0 6.176 0l3.089-3.088a4.367 4.367 0 1 0-6.177-6.177L12 5.823" />
                    </g>
                  </AgentLinkIcon>
                </ExternalLink>
                <ExternalLink
                  href={entry.licenseUrl}
                  label={`${entry.name} license`}
                >
                  <AgentLinkIcon>
                    <g
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                    >
                      <path d="M19.25 2.75v18.5h-12a2.5 2.5 0 0 1-2.5-2.5V5.25a2.5 2.5 0 0 1 2.5-2.5Z" />
                      <path d="M19.25 16.25h-12a2.5 2.5 0 0 0-2.5 2.5M8.75 7h6.5m-6.5 3.25h4" />
                    </g>
                  </AgentLinkIcon>
                </ExternalLink>
              </div>
              <p className="acp-agent-description" title={entry.description}>
                {entry.description}
              </p>
              <div className="acp-agent-meta">
                <button
                  className="acp-agent-action"
                  data-installed={installed}
                  disabled={Boolean(pending[entry.id]) || hostMissing}
                  onClick={() => void perform(entry, installation)}
                  type="button"
                >
                  {!installed ? <Icon icon={Download01Icon} size={15} /> : null}
                  {pending[entry.id] ||
                    (installed
                      ? "Remove"
                      : installation?.status === "failed" ||
                          installation?.status === "missing-runtime"
                        ? "Retry install"
                        : "Install")}
                </button>
              </div>
              {installation?.error && !pending[entry.id] ? (
                <p className="acp-agent-error">{installation.error}</p>
              ) : null}
            </article>
          );
        })}
        {!loading && !visible.length && !hostMissing ? (
          <p className="acp-registry-empty">
            {query
              ? "No agents match your search."
              : filter === "installed"
                ? "No agents installed yet. Choose All to install your first agent."
                : "No agents available. Refresh the catalog to try again."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
