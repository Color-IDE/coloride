import type { AgentMCPServer } from "@coloride/contracts";
import {
  Cancel01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  Plug01Icon,
  SearchIcon,
  Settings01Icon,
  Ticket01Icon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../shared/api/client";
import githubMark from "../../shared/assets/complements/github.svg";
import linearMark from "../../shared/assets/complements/linear.svg";
import mcpMark from "../../shared/assets/complements/mcp.svg";
import { Icon, type IconSvgElement } from "../../shared/ui/Icon";
import { Switch as SettingsSwitch } from "../../shared/ui/Switch";
import {
  cloudLinearOAuthStatus,
  disconnectCloudLinear,
  fetchCloudLinearToken,
  startCloudLinearOAuth,
  tryFetchCloudLinearToken,
} from "../auth/linearCloud";

type CatalogItem = {
  id: string;
  name: string;
  description: string;
  url: string;
  connectUrl?: string;
  headerName?: string;
  headerEnv?: string;
  icon: IconSvgElement;
  artwork?: string;
  custom?: boolean;
};

function ComplementMark({
  item,
  size,
}: {
  item: Pick<CatalogItem, "name" | "icon" | "artwork">;
  size: number;
}) {
  if (item.artwork) {
    return (
      <img alt="" className="agent-complements-artwork" src={item.artwork} />
    );
  }
  return <Icon icon={item.icon} size={size} strokeWidth={1.8} />;
}

type ComplementsTab = "public" | "yours";

const CUSTOM_ITEM: CatalogItem = {
  id: "custom",
  name: "Custom MCP",
  description: "Any Streamable HTTP server",
  url: "",
  icon: Plug01Icon,
  artwork: mcpMark,
  custom: true,
};

const CATALOG: CatalogItem[] = [
  {
    id: "github",
    name: "GitHub",
    description: "PRs, issues, and reviews",
    url: "https://api.githubcopilot.com/mcp/",
    connectUrl: "https://github.com/login",
    headerName: "Authorization",
    headerEnv: "GITHUB_TOKEN",
    icon: Plug01Icon,
    artwork: githubMark,
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues and project workflows",
    url: "https://mcp.linear.app/mcp",
    connectUrl: "https://linear.app/login",
    headerName: "Authorization",
    headerEnv: "LINEAR_API_KEY",
    icon: Ticket01Icon,
    artwork: linearMark,
  },
  CUSTOM_ITEM,
];

const emptyForm = {
  name: "",
  url: "",
  headerName: "Authorization",
  headerEnv: "",
};

function slugId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "custom";
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const next = `${base.slice(0, 44)}-${index}`;
    if (!taken.has(next)) return next;
  }
  return `${base.slice(0, 40)}-${Date.now().toString(36)}`;
}

function payloadOf(servers: AgentMCPServer[]) {
  return servers.map((server) => ({
    id: server.id,
    name: server.name,
    url: server.url,
    enabled: server.enabled,
    headerEnv: server.headerEnv ?? {},
  }));
}

function messageFromError(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : "Could not update complements";
  const json = raw.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { detail?: unknown };
      if (typeof parsed.detail === "string") return parsed.detail;
      if (
        parsed.detail &&
        typeof parsed.detail === "object" &&
        "message" in parsed.detail
      ) {
        const message = (parsed.detail as { message?: unknown }).message;
        if (typeof message === "string") return message;
      }
    } catch {
      // Fall through to the raw API text.
    }
  }
  const cleaned =
    raw.replace(/^Coloride API \d+:\s*/, "") || "Could not update complements";
  if (/not found/i.test(cleaned)) {
    return "Quit Coloride fully and start it again with pnpm dev so the sidecar can store Linear.";
  }
  return cleaned;
}

const COLORIDE_TERMS_URL = "";
const COLORIDE_PRIVACY_URL = "";

function LegalLink({ href, children }: { href: string; children: string }) {
  const url = href.trim();
  if (!url)
    return <span className="agent-complements-legal-link">{children}</span>;
  return (
    <a
      className="agent-complements-legal-link"
      href={url}
      onClick={(event) => {
        event.preventDefault();
        if (window.colorideDesktop?.openExternal && /^https:\/\//i.test(url)) {
          void window.colorideDesktop.openExternal(url);
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
      }}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function catalogForServer(server: AgentMCPServer): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === server.id);
}

let cachedServers: AgentMCPServer[] | null = null;

function isComplementConnected(server: AgentMCPServer | undefined): boolean {
  if (!server?.enabled) return false;
  if (server.id === "linear") return server.status === "ready";
  return server.status !== "error";
}

export function ComplementsView() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ComplementsTab>("public");
  const [servers, setServers] = useState<AgentMCPServer[]>(
    () => cachedServers ?? [],
  );
  const [loading, setLoading] = useState(() => cachedServers == null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<CatalogItem | null>(null);

  const load = useCallback(async () => {
    try {
      let next = await api.agentIntegrations();
      if (
        next.some(
          (server) => server.id === "linear" && server.status !== "ready",
        )
      ) {
        next = next.filter(
          (server) => !(server.id === "linear" && server.status !== "ready"),
        );
        void api.updateAgentIntegrations(payloadOf(next));
      }
      cachedServers = next;
      setServers(next);
      setError("");
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (next: AgentMCPServer[]) => {
    setSaving(true);
    setError("");
    try {
      await api.updateAgentIntegrations(payloadOf(next));
      const refreshed = await api.agentIntegrations();
      setServers(refreshed);
    } catch (reason) {
      setError(messageFromError(reason));
      throw reason;
    } finally {
      setSaving(false);
    }
  }, []);

  const installedById = useMemo(() => {
    const map = new Map<string, AgentMCPServer>();
    for (const server of servers) {
      if (isComplementConnected(server)) map.set(server.id, server);
    }
    return map;
  }, [servers]);

  const filteredCatalog = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items =
      tab === "yours"
        ? [
            ...servers.map((server) => {
              const known = catalogForServer(server);
              return {
                id: server.id,
                name: server.name,
                description: known?.description ?? server.url,
                url: server.url,
                headerName: known?.headerName,
                headerEnv: known?.headerEnv,
                icon: known?.icon ?? Plug01Icon,
                artwork: known?.artwork,
                custom: !known || known.custom,
              } satisfies CatalogItem;
            }),
            CUSTOM_ITEM,
          ]
        : CATALOG;
    if (!needle) return items;
    return items.filter((item) =>
      `${item.name} ${item.description} ${item.url}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query, servers, tab]);

  const openCustomForm = (preset?: CatalogItem) => {
    setForm({
      name: preset && !preset.custom ? preset.name : "",
      url: preset && !preset.custom ? preset.url : "",
      headerName: preset?.headerName ?? "Authorization",
      headerEnv: preset?.headerEnv ?? "",
    });
    setFormOpen(true);
    setManaging(true);
    setMenuId(null);
  };

  const openExternal = async (href: string) => {
    const target = href.trim();
    if (!target) throw new Error("Missing Linear authorize URL.");
    try {
      if (window.colorideDesktop?.openExternal && /^https:\/\//i.test(target)) {
        await window.colorideDesktop.openExternal(target);
        return;
      }
    } catch {
      // Fall through to the browser window.
    }
    const opened = window.open(target, "_blank", "noopener,noreferrer");
    if (!opened && !window.colorideDesktop?.openExternal) {
      throw new Error("Could not open Linear in the browser.");
    }
  };

  const installPreset = (item: CatalogItem) => {
    if (item.custom) {
      openCustomForm();
      return;
    }
    setError("");
    setMenuId(null);
    setConnecting(item);
  };

  const confirmConnect = async () => {
    if (!connecting) return;
    if (connecting.id === "linear") {
      setSaving(true);
      setError("");
      try {
        const finishWithToken = async (accessToken: string) => {
          const refreshed = await api.saveLinearCredentials(accessToken);
          setServers(refreshed);
          setConnecting(null);
        };
        const existingToken = await tryFetchCloudLinearToken();
        if (existingToken) {
          await finishWithToken(existingToken);
          return;
        }
        const started = await startCloudLinearOAuth();
        await openExternal(started.authorizeUrl);
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          const token = await tryFetchCloudLinearToken();
          if (token) {
            await finishWithToken(token);
            return;
          }
          try {
            const next = await cloudLinearOAuthStatus();
            if (next.status === "ready") {
              await finishWithToken(await fetchCloudLinearToken());
              return;
            }
            if (next.status === "error")
              throw new Error(next.error || "Linear sign-in failed.");
          } catch (reason) {
            const message = messageFromError(reason);
            if (
              /not configured|sign in|unauthorized|linear sign-in failed/i.test(
                message,
              )
            ) {
              throw reason;
            }
          }
        }
        throw new Error(
          "Linear redirected back, but the API never stored the token. The callback must look up `state` in SQLite and exchange `code` — do not use cookies.",
        );
      } catch (reason) {
        setError(messageFromError(reason));
      } finally {
        setSaving(false);
      }
      return;
    }
    const next: AgentMCPServer = {
      id: connecting.id,
      name: connecting.name,
      url: connecting.url,
      enabled: true,
      headerEnv:
        connecting.headerName && connecting.headerEnv
          ? { [connecting.headerName]: connecting.headerEnv }
          : {},
      status: "configured",
      error: "",
    };
    try {
      await persist([...servers, next]);
      if (connecting.connectUrl) openExternal(connecting.connectUrl);
      setConnecting(null);
    } catch {
      // Shown via error state.
    }
  };

  const addCustom = async () => {
    const name = form.name.trim();
    const url = form.url.trim();
    if (!name || !url) {
      setError("Name and HTTPS URL are required.");
      return;
    }
    const taken = new Set(servers.map((server) => server.id));
    const id = uniqueId(slugId(name), taken);
    const headerName = form.headerName.trim();
    const headerEnv = form.headerEnv.trim();
    const next: AgentMCPServer = {
      id,
      name,
      url,
      enabled: true,
      headerEnv: headerName && headerEnv ? { [headerName]: headerEnv } : {},
      status: "configured",
      error: "",
    };
    try {
      await persist([...servers, next]);
      setForm(emptyForm);
      setFormOpen(false);
    } catch {
      // Shown via error state.
    }
  };

  const toggleServer = async (serverId: string) => {
    const next = servers.map((server) =>
      server.id === serverId ? { ...server, enabled: !server.enabled } : server,
    );
    try {
      await persist(next);
    } catch {
      // Shown via error state.
    }
  };

  const removeServer = async (serverId: string) => {
    try {
      if (serverId === "linear") void disconnectCloudLinear();
      await persist(servers.filter((server) => server.id !== serverId));
      setMenuId(null);
    } catch {
      // Shown via error state.
    }
  };

  return (
    <div className="agent-complements" onClick={() => setMenuId(null)}>
      <div className="agent-complements-inner">
        <header className="agent-complements-header">
          <h1 className="agent-complements-title">Complements</h1>
          <p className="agent-complements-subtitle">
            Work with Coloride in your favorite tools
          </p>
        </header>
        <label className="agent-complements-search">
          <Icon
            className="agent-complements-search-icon"
            icon={SearchIcon}
            size={14}
            strokeWidth={1.8}
          />
          <input
            aria-label="Search complements"
            className="agent-complements-search-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search complements"
            type="search"
            value={query}
          />
        </label>

        <section className="agent-complements-section">
          <div className="agent-complements-section-head">
            <h2 className="agent-complements-section-title">Installed</h2>
            <button
              aria-label="Manage complements"
              aria-pressed={managing}
              className={`agent-complements-icon-btn${managing ? " is-active" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                setManaging((open) => !open);
              }}
              type="button"
            >
              <Icon icon={Settings01Icon} size={15} strokeWidth={1.8} />
            </button>
          </div>
          {servers.length > 0 ? (
            <div className="agent-complements-installed">
              {servers.map((server) => {
                const known = catalogForServer(server);
                return (
                  <button
                    className={`agent-complements-tile${known?.artwork ? " has-artwork" : ""}${server.enabled ? "" : " is-disabled"}`}
                    key={server.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setManaging(true);
                    }}
                    title={`${server.name}${server.enabled ? "" : " · disabled"}`}
                    type="button"
                  >
                    <ComplementMark
                      item={{
                        name: server.name,
                        icon: known?.icon ?? Plug01Icon,
                        artwork: known?.artwork,
                      }}
                      size={16}
                    />
                  </button>
                );
              })}
            </div>
          ) : null}

          {managing ? (
            <div className="agent-complements-manage">
              {servers.map((server) => (
                <div className="agent-complements-manage-row" key={server.id}>
                  <div className="agent-complements-manage-copy">
                    <div className="agent-complements-manage-name">
                      {server.name}
                    </div>
                    <div className="agent-complements-manage-meta">
                      {server.status === "error" && server.error
                        ? server.error
                        : server.url}
                    </div>
                  </div>
                  <SettingsSwitch
                    checked={server.enabled}
                    disabled={saving}
                    label={
                      server.enabled
                        ? `Disable ${server.name}`
                        : `Enable ${server.name}`
                    }
                    onChange={() => void toggleServer(server.id)}
                  />
                </div>
              ))}
              {formOpen ? (
                <form
                  className="agent-complements-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addCustom();
                  }}
                >
                  <input
                    aria-label="Complement name"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Name"
                    value={form.name}
                  />
                  <input
                    aria-label="MCP HTTPS URL"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                    placeholder="https://mcp.example.com"
                    value={form.url}
                  />
                  <div className="agent-complements-form-row">
                    <input
                      aria-label="Header name"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          headerName: event.target.value,
                        }))
                      }
                      placeholder="Authorization"
                      value={form.headerName}
                    />
                    <input
                      aria-label="Environment variable"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          headerEnv: event.target.value,
                        }))
                      }
                      placeholder="GITHUB_TOKEN"
                      value={form.headerEnv}
                    />
                  </div>
                  <p className="agent-complements-form-hint">
                    Secrets stay in the environment. Coloride only stores the
                    variable name.
                  </p>
                  <div className="agent-complements-form-actions">
                    <button
                      className="agent-complements-install"
                      disabled={saving}
                      type="submit"
                    >
                      Add
                    </button>
                    <button
                      className="agent-complements-icon-btn"
                      onClick={() => {
                        setFormOpen(false);
                        setForm(emptyForm);
                      }}
                      type="button"
                    >
                      <Icon icon={Cancel01Icon} size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="agent-complements-tabs" role="tablist">
          <button
            aria-selected={tab === "public"}
            className={`agent-complements-tab${tab === "public" ? " is-active" : ""}`}
            onClick={() => setTab("public")}
            role="tab"
            type="button"
          >
            Public
          </button>
          <button
            aria-selected={tab === "yours"}
            className={`agent-complements-tab${tab === "yours" ? " is-active" : ""}`}
            onClick={() => setTab("yours")}
            role="tab"
            type="button"
          >
            Yours
          </button>
        </div>

        <section className="agent-complements-section">
          <h2 className="agent-complements-section-title">
            {tab === "yours" ? "Yours" : "Featured"}
          </h2>
          <div className="agent-complements-grid">
            {filteredCatalog.map((item) => {
              const installed = installedById.get(item.id);
              return (
                <article
                  className="agent-complements-card"
                  key={`${tab}-${item.id}`}
                >
                  <span
                    className={`agent-complements-card-icon${item.artwork ? " has-artwork" : ""}`}
                  >
                    <ComplementMark item={item} size={18} />
                  </span>
                  <div className="agent-complements-card-copy">
                    <div className="agent-complements-card-name">
                      {item.name}
                    </div>
                    <div className="agent-complements-card-desc">
                      {item.description}
                    </div>
                  </div>
                  {installed && !item.custom ? (
                    <div className="agent-complements-card-menu">
                      <button
                        aria-label={`${item.name} options`}
                        className="agent-complements-icon-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuId((current) =>
                            current === item.id ? null : item.id,
                          );
                        }}
                        type="button"
                      >
                        <Icon
                          icon={MoreHorizontalIcon}
                          size={16}
                          strokeWidth={1.8}
                        />
                      </button>
                      {menuId === item.id ? (
                        <div
                          className="agent-complements-menu"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            disabled={saving}
                            onClick={() => void toggleServer(item.id)}
                            type="button"
                          >
                            {installed.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            disabled={saving}
                            onClick={() => void removeServer(item.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      className="agent-complements-install"
                      disabled={saving || connecting?.id === item.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        installPreset(item);
                      }}
                      type="button"
                    >
                      {connecting?.id === item.id ? (
                        <>
                          <Icon
                            className="agent-complements-spin"
                            icon={Loading03Icon}
                            size={14}
                            strokeWidth={2}
                          />
                          Installing
                        </>
                      ) : (
                        "Install"
                      )}
                    </button>
                  )}
                </article>
              );
            })}
            {!loading && filteredCatalog.length === 0 ? (
              <div className="agent-complements-empty">
                No matching complements
              </div>
            ) : null}
          </div>
        </section>

        {error ? <p className="agent-complements-error">{error}</p> : null}
      </div>
      {createPortal(
        <ConnectComplementDialog
          error={error}
          item={connecting}
          saving={saving}
          onCancel={() => {
            setError("");
            setConnecting(null);
          }}
          onContinue={() => void confirmConnect()}
        />,
        document.body,
      )}
    </div>
  );
}

function ConnectComplementDialog({
  item,
  saving,
  error,
  onCancel,
  onContinue,
}: {
  item: CatalogItem | null;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onContinue: () => void;
}) {
  useEffect(() => {
    if (!item || saving) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [item, onCancel, saving]);

  if (typeof document === "undefined") return null;

  return (
    <AnimatePresence>
      {item ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="agent-complements-connect-overlay fixed inset-0 z-[12000] flex items-center justify-center p-6"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          <button
            aria-label="Dismiss"
            className="absolute inset-0 cursor-default border-0 bg-black/45"
            disabled={saving}
            onClick={() => {
              if (!saving) onCancel();
            }}
            type="button"
          />
          <motion.section
            animate={{ opacity: 1, scale: 1, y: 0 }}
            aria-describedby="agent-complements-connect-desc"
            aria-labelledby="agent-complements-connect-title"
            aria-modal="true"
            className="agent-complements-connect relative z-10 w-full max-w-[400px] rounded-[20px] border border-[#3a3a3a] bg-[#2a2a2a] p-5 shadow-2xl"
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            role="dialog"
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <div className="flex items-start gap-3">
              <span
                className={`agent-complements-connect-mark${item.artwork ? " has-artwork" : ""}`}
              >
                <ComplementMark item={item} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  className="text-[17px] font-semibold tracking-tight text-[#f4f4f5]"
                  id="agent-complements-connect-title"
                >
                  Connect {item.name}?
                </h2>
                <p
                  className="mt-2 text-[13px] leading-5 text-[#a1a1aa]"
                  id="agent-complements-connect-desc"
                >
                  Coloride will only use {item.name} for the work you ask it to
                  do. Connecting shares request metadata and the relevant parts
                  of the current task. Covered by our{" "}
                  <LegalLink href={COLORIDE_TERMS_URL}>
                    Terms of Service
                  </LegalLink>{" "}
                  and{" "}
                  <LegalLink href={COLORIDE_PRIVACY_URL}>
                    Privacy Policy
                  </LegalLink>
                  .
                </p>
                {error ? (
                  <p className="agent-complements-connect-error mt-3 text-[13px] leading-5">
                    {error}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                className="agent-complements-connect-cancel flex h-8 items-center justify-center rounded-[10px] px-3 text-[13px] font-medium text-[#e4e4e7] transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                disabled={saving}
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="agent-complements-connect-continue flex h-8 items-center justify-center gap-1.5 rounded-[10px] bg-[#ececee] px-3 text-[13px] font-medium text-[#171717] transition-[filter,opacity] hover:brightness-110 disabled:opacity-60"
                disabled={saving}
                onClick={onContinue}
                type="button"
              >
                {saving ? (
                  <>
                    <Icon
                      className="agent-complements-spin"
                      icon={Loading03Icon}
                      size={14}
                      strokeWidth={2}
                    />
                    Connecting…
                  </>
                ) : (
                  `Continue to ${item.name}`
                )}
              </button>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
