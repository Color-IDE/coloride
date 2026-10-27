import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Delete02Icon,
  HelpCircleIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  RefreshIcon,
  SearchIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../shared/ui/Icon";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEventHandler } from "react";
import { api } from "../../shared/api/client";
import type { AuthorizedKey, Profile, ServerDashboard, ServerSettings } from "../../shared/api/types";
import { ServerMenu, type ServerSubTab } from "./ServerMenu";

export type { ServerSubTab } from "./ServerMenu";

const MonitorIntervalContext = createContext(5);

interface ServerViewProps {
  host: string;
  onOpenExplorer: () => void;
  onDisconnect: () => Promise<void>;
  onForgetServer: () => Promise<void>;
  onPreferencesChange: (preferences: { defaultShell?: "default" | "bash" | "zsh" | "fish"; terminalPersistence?: boolean; monitorInterval?: 2 | 5 | 10 | 30 }) => Promise<Profile>;
  onResizeStart: MouseEventHandler<HTMLDivElement>;
  onServerNameChange: (name: string) => Promise<void>;
  onServerSubTabChange: (tab: ServerSubTab) => void;
  onWorkspaceChange: (path: string) => Promise<void>;
  port: string;
  profile: Profile | null;
  serverName: string;
  serverSubTab: ServerSubTab;
  serverWidth: number;
  sidePanelOpen: boolean;
  username: string;
  workspacePath: string;
}

const messageFromError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const payload = JSON.parse(raw.slice(raw.indexOf("{")));
    return payload.message ?? payload.detail?.message ?? raw;
  } catch {
    return raw;
  }
};

const formatBytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
};

const formatRate = (value: number) => `${formatBytes(value)}/s`;

type HealthHistory = Record<"cpu" | "load" | "memory" | "swap" | "disk" | "down" | "up" | "diskIo", number[]>;

const emptyHealthHistory = (): HealthHistory => ({ cpu: [], load: [], memory: [], swap: [], disk: [], down: [], up: [], diskIo: [] });
type DashboardCacheEntry = { dashboard: ServerDashboard; history: HealthHistory };

const dashboardCache = new Map<string, DashboardCacheEntry>();
const dashboardRequests = new Map<string, Promise<DashboardCacheEntry>>();

const appendHealthSample = (current: HealthHistory, dashboard: ServerDashboard): HealthHistory => ({
  cpu: [...current.cpu, dashboard.cpuPct].slice(-30),
  load: [...current.load, dashboard.load1m].slice(-30),
  memory: [...current.memory, dashboard.memory.pct].slice(-30),
  swap: [...current.swap, dashboard.swap.pct].slice(-30),
  disk: [...current.disk, dashboard.disk.pct].slice(-30),
  down: [...current.down, dashboard.downBps].slice(-30),
  up: [...current.up, dashboard.upBps].slice(-30),
  diskIo: [...current.diskIo, dashboard.diskReadBps + dashboard.diskWriteBps].slice(-30),
});

const requestServerDashboard = (connectionKey: string) => {
  const pending = dashboardRequests.get(connectionKey);
  if (pending) return pending;

  const request = api.serverDashboard()
    .then((dashboard) => {
      const history = appendHealthSample(
        dashboardCache.get(connectionKey)?.history ?? emptyHealthHistory(),
        dashboard,
      );
      const entry = { dashboard, history };
      dashboardCache.set(connectionKey, entry);
      return entry;
    })
    .finally(() => dashboardRequests.delete(connectionKey));

  dashboardRequests.set(connectionKey, request);
  return request;
};

export const prefetchServerDashboard = (connectionKey: string) => requestServerDashboard(connectionKey).then(() => undefined);

export function ServerView(props: ServerViewProps) {
  const connectionKey = `${props.username}@${props.host}:${props.port}`;
  const cachedDashboard = dashboardCache.get(connectionKey);
  const connectionKeyRef = useRef(connectionKey);
  connectionKeyRef.current = connectionKey;
  const [dashboard, setDashboard] = useState<ServerDashboard | null>(() => cachedDashboard?.dashboard ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !cachedDashboard);
  const [history, setHistory] = useState<HealthHistory>(() => cachedDashboard?.history ?? emptyHealthHistory());
  const [keysOpen, setKeysOpen] = useState(false);
  const dashboardScrollRef = useRef<HTMLDivElement>(null);
  const dashboardContentRef = useRef<HTMLDivElement>(null);
  const [dashboardFadeEdges, setDashboardFadeEdges] = useState({ bottom: false, top: false });

  const updateDashboardFadeEdges = useCallback(() => {
    const element = dashboardScrollRef.current;
    if (!element) return;

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const next = {
      bottom: maxScrollTop > 1 && element.scrollTop < maxScrollTop - 1,
      top: maxScrollTop > 1 && element.scrollTop > 1,
    };
    setDashboardFadeEdges((current) => (
      current.bottom === next.bottom && current.top === next.top ? current : next
    ));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await requestServerDashboard(connectionKey);
      if (connectionKeyRef.current !== connectionKey) return;
      setDashboard(next.dashboard);
      setHistory(next.history);
      setError("");
    } catch (reason) {
      if (connectionKeyRef.current !== connectionKey) return;
      setError(messageFromError(reason));
    } finally {
      if (connectionKeyRef.current === connectionKey) setLoading(false);
    }
  }, [connectionKey]);

  useEffect(() => {
    const cached = dashboardCache.get(connectionKey);
    setDashboard(cached?.dashboard ?? null);
    setHistory(cached?.history ?? emptyHealthHistory());
    setLoading(!cached);
    void refresh();
    const interval = window.setInterval(() => void refresh(), (props.profile?.monitorInterval ?? 5) * 1_000);
    return () => window.clearInterval(interval);
  }, [connectionKey, props.profile?.monitorInterval, refresh]);

  useLayoutEffect(() => {
    updateDashboardFadeEdges();
  }, [dashboard, loading, props.serverSubTab, updateDashboardFadeEdges]);

  useLayoutEffect(() => {
    const element = dashboardScrollRef.current;
    if (!element) return;
    element.scrollTop = 0;
    updateDashboardFadeEdges();
  }, [props.serverSubTab, updateDashboardFadeEdges]);

  useEffect(() => {
    const scrollElement = dashboardScrollRef.current;
    const contentElement = dashboardContentRef.current;
    if (!scrollElement || !contentElement) return;

    const resizeObserver = new ResizeObserver(updateDashboardFadeEdges);
    resizeObserver.observe(scrollElement);
    resizeObserver.observe(contentElement);
    window.addEventListener("resize", updateDashboardFadeEdges);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDashboardFadeEdges);
    };
  }, [updateDashboardFadeEdges]);

  return (
    <div className="server-view flex h-full min-h-0 min-w-0">
      <div className="app-main-card flex h-full min-h-0 min-w-0 flex-1 overflow-hidden border border-b-0 border-r-0 border-[#333333] bg-[#212121]">
      <div
        aria-hidden={!props.sidePanelOpen}
        className={`relative flex h-full min-h-0 flex-shrink-0 flex-col overflow-hidden transition-opacity duration-200 ease-out ${props.sidePanelOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        style={{ width: props.sidePanelOpen ? `${props.serverWidth}px` : "0px" }}
      >
        <ServerMenu serverSubTab={props.serverSubTab} onChange={props.onServerSubTabChange} />
      </div>
      <div
        aria-hidden={!props.sidePanelOpen}
        className={`app-split-seam relative z-10 flex-shrink-0 self-stretch transition-opacity duration-200 ease-out ${
          props.sidePanelOpen ? "w-px opacity-100" : "pointer-events-none w-0 opacity-0"
        }`}
      >
        <div
          className="absolute inset-y-0 -left-1.5 z-20 w-3 cursor-ew-resize"
          onMouseDown={props.onResizeStart}
          title="Drag to resize server panel"
        />
      </div>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#212121] p-4 text-sm">
          <Header {...props} />
          {error && <div className="mb-4 rounded-xl border border-[#663f3f] bg-[#311f1f] px-3 py-2 text-xs text-[#f1a4a4]">{error}</div>}
          <div className="relative -mr-4 min-h-0 flex-1">
            <div
              className="server-dashboard-scroll h-full min-h-0 overflow-y-auto pr-4"
              onScroll={updateDashboardFadeEdges}
              ref={dashboardScrollRef}
            >
              <div className={props.serverSubTab === "logs" ? "h-full min-h-0" : ""} ref={dashboardContentRef}>
                {loading && props.serverSubTab !== "settings" ? <LoadingPanel /> : <ServerTabContent {...props} dashboard={dashboard} history={history} keysOpen={keysOpen} onKeysClose={() => setKeysOpen(false)} onManageKeys={() => setKeysOpen(true)} onReconnect={() => void refresh()} />}
              </div>
            </div>
            {props.serverSubTab !== "logs" && (
              <>
                <span
                  aria-hidden="true"
                  data-edge="top"
                  className={`scroll-edge-fade server-dashboard-fade pointer-events-none absolute left-0 right-[7px] top-0 z-20 h-7 transition-opacity duration-150 ${dashboardFadeEdges.top ? "opacity-100" : "opacity-0"}`}
                />
                <span
                  aria-hidden="true"
                  data-edge="bottom"
                  className={`scroll-edge-fade server-dashboard-fade pointer-events-none absolute bottom-0 left-0 right-[7px] z-20 h-7 transition-opacity duration-150 ${dashboardFadeEdges.bottom ? "opacity-100" : "opacity-0"}`}
                />
              </>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function Header({ serverSubTab }: ServerViewProps) {
  const titles: Record<ServerSubTab, string> = {
    health: "Health",
    processes: "Processes",
    services: "Services",
    ports: "Ports",
    logs: "Logs",
    settings: "Settings",
  };

  return <div className={`mb-5 text-xl font-semibold tracking-tight text-white ${serverSubTab === "settings" ? "mx-auto mt-6 w-full max-w-3xl" : ""}`}>{titles[serverSubTab]}</div>;
}

function ServerTabContent(props: ServerViewProps & { dashboard: ServerDashboard | null; history: HealthHistory; keysOpen: boolean; onKeysClose: () => void; onManageKeys: () => void; onReconnect: () => void }) {
  const { dashboard, history, keysOpen, onKeysClose, onManageKeys, serverSubTab } = props;
  if (serverSubTab === "settings") return <><SettingsPanel {...props} onManageKeys={onManageKeys} /><AnimatePresence>{keysOpen && <ManageKeysModal onClose={onKeysClose} />}</AnimatePresence></>;
  if (!dashboard) return <EmptyPanel />;
  return <>
    {serverSubTab === "health" && <MonitorIntervalContext.Provider value={props.profile?.monitorInterval ?? 5}><HealthPanel dashboard={dashboard} history={history} /></MonitorIntervalContext.Provider>}
    {serverSubTab === "processes" && <ProcessesPanel processes={dashboard.processes} />}
    {serverSubTab === "services" && <ServicesPanel services={dashboard.services} />}
    {serverSubTab === "ports" && <PortsPanel ports={dashboard.ports} />}
    {serverSubTab === "logs" && <LogsPanel logs={dashboard.logs} />}
    <AnimatePresence>{keysOpen && <ManageKeysModal onClose={onKeysClose} />}</AnimatePresence>
  </>;
}

function HealthPanel({ dashboard, history }: { dashboard: ServerDashboard; history: HealthHistory }) {
  const [openGroups, setOpenGroups] = useState({ compute: true, storage: true, network: true });
  const toggleGroup = (group: keyof typeof openGroups) => setOpenGroups((current) => ({ ...current, [group]: !current[group] }));
  return <div className="pb-1 text-[#d0d0d5]"><div className="space-y-7"><MetricGroup title="Compute" open={openGroups.compute} onToggle={() => toggleGroup("compute")}><MetricChart label="CPU usage" value={`${dashboard.cpuPct.toFixed(1)}%`} detail="Processor time in use" help="CPU usage is sampled from the server and shows the share of processor time currently in use." samples={history.cpu} maxValue={100} valueLabel={(value) => `${Math.round(value)}%`} color="#67b9ef" /><MetricChart label="Load average" value={dashboard.load1m.toFixed(2)} detail={`5m ${dashboard.load5m.toFixed(2)} · 15m ${dashboard.load15m.toFixed(2)}`} help="Load average shows the number of tasks waiting for CPU or uninterruptible disk I/O. Compare it with the number of CPU cores." samples={history.load} maxValue={Math.max(...history.load, 1)} valueLabel={(value) => value.toFixed(1)} color="#a88ae7" /><MetricChart label="Memory usage" value={`${dashboard.memory.pct.toFixed(1)}%`} detail={`${formatBytes(dashboard.memory.usedBytes)} of ${formatBytes(dashboard.memory.totalBytes)}`} help="Memory usage excludes reclaimable cache where the server reports it, so it is a better signal than total allocated memory." samples={history.memory} maxValue={100} valueLabel={(value) => `${Math.round(value)}%`} color="#c879ae" /><MetricChart label="Swap usage" value={dashboard.swap.totalBytes ? `${dashboard.swap.pct.toFixed(1)}%` : "Disabled"} detail={dashboard.swap.totalBytes ? `${formatBytes(dashboard.swap.usedBytes)} of ${formatBytes(dashboard.swap.totalBytes)}` : "No swap configured"} help="Swap is disk space used as overflow memory. Sustained swap usage can indicate memory pressure." samples={history.swap} maxValue={100} valueLabel={(value) => `${Math.round(value)}%`} color="#dc8b70" /></MetricGroup><MetricGroup title="Storage" open={openGroups.storage} onToggle={() => toggleGroup("storage")}><MetricChart label="Disk usage" value={`${dashboard.disk.pct.toFixed(1)}%`} detail={`${formatBytes(dashboard.disk.usedBytes)} of ${formatBytes(dashboard.disk.totalBytes)}`} help="Disk usage is measured on the server root filesystem. Keep enough free space for logs, updates and temporary files." samples={history.disk} maxValue={100} valueLabel={(value) => `${Math.round(value)}%`} color="#e3ba63" /><MetricChart label="Disk I/O" value={`${formatRate(dashboard.diskReadBps + dashboard.diskWriteBps)}`} detail={`Read ${formatRate(dashboard.diskReadBps)} · Write ${formatRate(dashboard.diskWriteBps)}`} help="Disk I/O is the combined read and write throughput across the server disks." samples={history.diskIo} maxValue={Math.max(...history.diskIo, 1)} valueLabel={formatRate} color="#e0b26e" /></MetricGroup><MetricGroup title="Network" open={openGroups.network} onToggle={() => toggleGroup("network")}><MetricChart label="Network inbound" value={formatRate(dashboard.downBps)} detail="Traffic received by the server" help="Inbound traffic is measured from the active network interface, excluding loopback traffic." samples={history.down} maxValue={Math.max(...history.down, 1)} valueLabel={formatRate} color="#73d6af" /><MetricChart label="Network outbound" value={formatRate(dashboard.upBps)} detail="Traffic sent by the server" help="Outbound traffic is measured from the active network interface, excluding loopback traffic." samples={history.up} maxValue={Math.max(...history.up, 1)} valueLabel={formatRate} color="#64a7df" /></MetricGroup></div></div>;
}

function MetricGroup({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <div><button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-2 rounded-lg px-2 pr-3 py-1 text-left text-base font-medium text-[#f0f4f8] hover:bg-[#2a2a2a]"><span className="text-[#9a9a9a]">{open ? <Icon icon={ArrowUp01Icon} size={17} /> : <Icon icon={ArrowDown01Icon} size={17} />}</span>{title}</button><AnimatePresence initial={false}>{open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="overflow-hidden"><div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-7 xl:grid-cols-2">{children}</div></motion.div>}</AnimatePresence></div>;
}

function MetricChart({ label, value, detail, help, samples, maxValue, valueLabel, color }: { label: string; value: string; detail: string; help: string; samples: number[]; maxValue: number; valueLabel: (value: number) => string; color: string }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const sampleInterval = useContext(MonitorIntervalContext);
  const chart = useMemo(() => {
    const values = samples.length > 1 ? samples : [samples[0] ?? 0, samples[0] ?? 0];
    const left = 34;
    const right = 296;
    const top = 10;
    const bottom = 132;
    const safeMax = Math.max(maxValue, 1);
    return values.map((sample, index) => `${left + (index / (values.length - 1)) * (right - left)},${bottom - Math.min(sample / safeMax, 1) * (bottom - top)}`).join(" ");
  }, [maxValue, samples]);
  const labels = [maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0];
  const seconds = Math.max(0, (samples.length - 1) * sampleInterval);
  const timeTicks = [0, 0.25, 0.5, 0.75, 1];
  return <div role="region" aria-label={label} className="server-health-card min-w-0 rounded-2xl border border-[#383838] bg-[#1b1b1b] p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-medium text-[#f2f4f6]">{label}</h2><div className="mt-1 text-xl font-semibold text-white">{value}</div><div className="mt-0.5 text-xs text-[#858585]">{detail}</div></div><div className="relative"><button type="button" onClick={() => setHelpOpen((current) => !current)} aria-expanded={helpOpen} title={`About ${label}`} className="rounded-lg p-1 text-[#858585] transition-colors hover:bg-[#2a2a2a] hover:text-white"><Icon icon={HelpCircleIcon} size={16} /></button><AnimatePresence>{helpOpen && <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.16 }} className="absolute -right-3 top-[28px] z-30 w-60 rounded-2xl bg-white p-3 text-left text-xs leading-relaxed text-[#343434] shadow-[0_12px_30px_rgba(0,0,0,0.32)]"><span className="absolute -top-1 right-2 h-3 w-3 rotate-45 bg-white" /><div className="relative font-medium text-[#151515]">{label}</div><p className="relative mt-1 text-[#5d5d5d]">{help}</p></motion.div>}</AnimatePresence></div></div><div className="mt-3 flex gap-1"><div className="relative h-40 w-8 shrink-0 text-right text-[10px] leading-none text-[#898989]">{labels.map((tick, index) => <span key={`label-${index}`} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${index * 25}%` }}>{valueLabel(tick)}</span>)}</div><div className="min-w-0 flex-1"><svg viewBox="34 10 262 122" preserveAspectRatio="none" className="h-40 w-full" aria-label={`${label} line chart`} role="img"><g stroke="#3a3a3a" strokeWidth="1">{[10, 40.5, 71, 101.5, 132].map((y) => <line key={`horizontal-${y}`} x1="34" x2="296" y1={y} y2={y} />)}{[34, 99.5, 165, 230.5, 296].map((x) => <line key={`vertical-${x}`} x1={x} x2={x} y1="10" y2="132" />)}</g><polyline fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" points={chart} /></svg><div className="mt-2 grid grid-cols-5 text-[10px] leading-none text-[#777]">{timeTicks.map((position) => <span key={`time-${position}`} className={position === 0 ? "text-left" : position === 1 ? "text-right" : "text-center"}>{position === 1 ? "Now" : `${Math.round(seconds * (1 - position))}s ago`}</span>)}</div></div></div><div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#919191]"><span className="h-px w-4" style={{ backgroundColor: color }} />Last 30 samples</div></div>;
}

function ProcessesPanel({ processes }: Pick<ServerDashboard, "processes">) { return <ListPanel title="" empty="No processes could be read.">{processes.map((process) => <div key={process.pid} className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-[#2a2a2a]"><div className="flex gap-2 min-w-0"><span className="font-mono truncate text-[#f0f4f8]">{process.name}</span><span className="text-[#878888] text-xs">#{process.pid}</span></div><div className="flex gap-3 text-xs text-[#aaa]"><span>{process.cpuPct.toFixed(1)}% CPU</span><span>{formatBytes(process.memoryBytes)}</span></div></div>)}</ListPanel>; }
function ServicesPanel({ services }: Pick<ServerDashboard, "services">) { return <ListPanel title="" empty="systemd is unavailable or no services were returned.">{services.map((service) => <div key={service.name} className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-[#2a2a2a]"><div><div>{service.name}</div>{service.description && <div className="text-xs text-[#777] truncate max-w-[420px]">{service.description}</div>}</div><span className={service.status === "active" ? "text-emerald-400 text-xs" : "text-[#aaa] text-xs"}>{service.status}</span></div>)}</ListPanel>; }
function PortsPanel({ ports }: Pick<ServerDashboard, "ports">) { return <ListPanel title="" empty="No listening TCP ports were returned.">{ports.map((port) => <div key={`${port.address}-${port.port}`} className="flex justify-between px-2 py-2 rounded-lg hover:bg-[#2a2a2a] font-mono text-sm"><span>{port.port}/{port.protocol}</span><span className="text-[#878888] truncate ml-4">{port.address}</span></div>)}</ListPanel>; }
function LogsPanel({ logs }: Pick<ServerDashboard, "logs">) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [level, setLevel] = useState("all");
  const [paused, setPaused] = useState(false);
  const [pausedLogs, setPausedLogs] = useState(logs);
  const [hiddenLogs, setHiddenLogs] = useState<Set<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const sourceName = (log: ServerDashboard["logs"][number]) => log.source || "system";
  const logKey = (log: ServerDashboard["logs"][number]) => `${log.timestamp ?? "unknown"}|${sourceName(log)}|${log.message}`;

  useEffect(() => {
    if (!paused) setPausedLogs(logs);
  }, [logs, paused]);

  const sources = useMemo(() => Array.from(new Set(logs.map(sourceName))).sort(), [logs]);
  const displayLogs = paused ? pausedLogs : logs;
  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return displayLogs.filter((log) => {
      const entrySource = sourceName(log);
      if (hiddenLogs.has(logKey(log))) return false;
      if (source !== "all" && entrySource !== source) return false;
      if (level !== "all" && log.level !== level) return false;
      return !normalizedQuery || `${entrySource} ${log.message}`.toLowerCase().includes(normalizedQuery);
    });
  }, [displayLogs, hiddenLogs, level, query, source]);
  const selectedLog = filteredLogs.find((log) => logKey(log) === selectedKey) ?? null;
  const togglePaused = () => {
    if (!paused) setPausedLogs(logs);
    setPaused((current) => !current);
  };
  const formatTimestamp = (timestamp: string | null | undefined) => {
    if (!timestamp) return "Time unavailable";
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  };
  const displayMessage = (log: ServerDashboard["logs"][number]) => log.message.replace(/^\d{4}-\d{2}-\d{2}T\S+\s+\S+\s+/, "");
  const levelClass = (entryLevel: string) => entryLevel === "error" ? "bg-[#3a2222] text-[#f09b9b]" : entryLevel === "warning" ? "bg-[#3c3220] text-[#e6c579]" : "bg-[#1c3545] text-[#8bc6ed]";
  const levelBadge = (entryLevel: string) => (
    <span
      className={`server-log-level inline-flex rounded-md px-1.5 py-0.5 text-[9px] font-medium capitalize ${levelClass(entryLevel)}`}
      data-level={entryLevel}
    >
      {entryLevel}
    </span>
  );

  return (
    <div className="server-logs flex h-full min-h-0 flex-col text-[#d8d8dc]">
      <div className="server-logs-toolbar mb-3 flex items-center gap-2">
        <label className="server-logs-search relative min-w-0 flex-1 rounded-xl">
          <Icon icon={SearchIcon} size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#858585]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter logs..."
            className="h-8 w-full rounded-xl border border-[#3b3b3b] bg-[#191919] pl-8 pr-3 text-xs text-white outline-none placeholder:text-[#777] focus:border-[#6b6b6b]"
          />
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <LogFilterMenu label="All sources" value={source} options={sources} onChange={setSource} />
          <LogFilterMenu label="All levels" value={level} options={["info", "warning", "error"]} onChange={setLevel} />
          <button
            type="button"
            onClick={() => { setHiddenLogs(new Set(displayLogs.map(logKey))); setSelectedKey(null); }}
            disabled={!displayLogs.length}
            className="server-logs-control inline-flex h-8 items-center rounded-xl bg-[#2c2c2c] px-3 text-[11px] text-[#dedee1] transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="server-logs-table min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#383838] bg-[#1b1b1b]">
        <div className="flex h-full min-h-0 flex-col xl:flex-row">
          <div className="server-logs-list min-h-0 min-w-0 flex-1 overflow-auto">
            <div className="server-logs-header sticky top-0 z-10 grid min-w-[44rem] grid-cols-[11rem_11rem_6rem_minmax(0,1fr)] items-center border-b border-[#383838] bg-[#202020] px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.8px] text-[#838383]">
              <span>Timestamp</span>
              <span>Source</span>
              <span>Level</span>
              <span className="flex items-center justify-between gap-3">
                Event
                {!selectedLog && (
                  <button type="button" onClick={togglePaused} className="server-logs-pause inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] normal-case tracking-normal text-[#c9c9cd] transition-colors hover:bg-[#333] hover:text-white">
                    {paused ? <Icon icon={PlayCircleIcon} size={12} /> : <Icon icon={PauseCircleIcon} size={12} />}
                    {paused ? "Go Live" : "Pause"}
                  </button>
                )}
              </span>
            </div>

            {filteredLogs.length ? (
              <div className="min-w-[44rem]">
                {filteredLogs.map((log) => {
                  const key = logKey(log);
                  const active = key === selectedKey;
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setSelectedKey(key)}
                      className={`server-log-row grid w-full grid-cols-[11rem_11rem_6rem_minmax(0,1fr)] items-center px-4 py-2 text-left text-[11px] leading-4 transition-colors ${active ? "bg-[#303030]" : "hover:bg-[#272727]"}`}
                      data-active={active}
                    >
                      <span className="server-log-timestamp whitespace-nowrap pr-4 text-[#b4b4b8]">{formatTimestamp(log.timestamp)}</span>
                      <span className="server-log-source truncate pr-4 text-[#c8c8cc]">{sourceName(log)}</span>
                      <span>{levelBadge(log.level)}</span>
                      <span className="server-log-message truncate text-[#d7d7db]">{displayMessage(log)}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-44 items-center justify-center text-xs text-[#777]">
                {logs.length ? "No logs match the current filters." : "System logs are unavailable for this server."}
              </div>
            )}
          </div>

          <AnimatePresence initial={false}>
            {selectedLog && (
              <motion.div
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.16 }}
                className="server-log-details-shell flex w-full shrink-0 border-t border-[#383838] xl:w-80 xl:border-0"
              >
                <span aria-hidden="true" className="server-log-details-divider hidden w-px shrink-0 bg-[#3b3b3b] xl:block" />
                <aside className="server-log-details flex min-w-0 flex-1 flex-col bg-[#202020]">
                  <div className="server-log-details-header flex items-center justify-between border-b border-[#383838] px-4 py-2.5">
                    <div className="server-log-details-title text-xs font-medium text-white">Log details</div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={togglePaused} className="server-logs-pause inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] text-[#c9c9cd] transition-colors hover:bg-[#333] hover:text-white">
                        {paused ? <Icon icon={PlayCircleIcon} size={12} /> : <Icon icon={PauseCircleIcon} size={12} />}
                        {paused ? "Go Live" : "Pause"}
                      </button>
                      <button type="button" onClick={() => setSelectedKey(null)} title="Close details" className="server-log-details-close rounded-lg p-1 text-[#999] transition-colors hover:bg-[#333] hover:text-white">
                        <Icon icon={Cancel01Icon} size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-4 p-4 text-[11px]">
                    <div className="grid grid-cols-[5rem_1fr] gap-y-2">
                      <span className="server-log-details-label text-[#858585]">Timestamp</span>
                      <span className="server-log-details-value text-[#dedee1]">{formatTimestamp(selectedLog.timestamp)}</span>
                      <span className="server-log-details-label text-[#858585]">Source</span>
                      <span className="server-log-details-value text-[#dedee1]">{sourceName(selectedLog)}</span>
                      <span className="server-log-details-label text-[#858585]">Level</span>
                      <span>{levelBadge(selectedLog.level)}</span>
                    </div>
                    <div className="server-log-details-message border-t border-[#383838] pt-4">
                      <div className="server-log-details-label mb-2 text-[10px] font-medium uppercase tracking-[0.8px] text-[#858585]">Message</div>
                      <p className="server-log-details-copy whitespace-pre-wrap break-words leading-relaxed text-[#e2e2e4]">{displayMessage(selectedLog)}</p>
                    </div>
                  </div>
                </aside>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function LogFilterMenu({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayValue = value === "all" ? label : value;
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePress);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);
  const select = (nextValue: string) => { onChange(nextValue); setOpen(false); };
  return <div ref={menuRef} className="server-log-filter relative"><button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="server-logs-control inline-flex h-8 min-w-28 items-center justify-between gap-2 rounded-xl bg-[#2c2c2c] px-3 text-[11px] text-[#dedee1] transition-colors hover:bg-[#383838]"><span className="max-w-28 truncate capitalize">{displayValue}</span><Icon icon={ArrowDown01Icon} size={14} className={`text-[#929292] transition-transform ${open ? "rotate-180" : ""}`} /></button><AnimatePresence>{open && <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.14 }} className="server-log-filter-menu absolute right-0 top-10 z-30 min-w-full rounded-xl border border-[#454545] bg-[#292929] p-1.5 shadow-xl"><div className="space-y-1"><button type="button" data-active={value === "all"} onClick={() => select("all")} className={`server-log-filter-option block w-full rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${value === "all" ? "bg-[#3a3a3a] text-white" : "text-[#c9c9cd] hover:bg-[#363636]"}`}>{label}</button>{options.map((option) => <button type="button" data-active={value === option} onClick={() => select(option)} key={option} className={`server-log-filter-option block w-full rounded-lg px-2.5 py-2 text-left text-[11px] capitalize transition-colors ${value === option ? "bg-[#3a3a3a] text-white" : "text-[#c9c9cd] hover:bg-[#363636]"}`}>{option}</button>)}</div></motion.div>}</AnimatePresence></div>;
}
function ListPanel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { const count = Array.isArray(children) ? children.length : 1; return <div>{title && <div className="mb-2 uppercase text-[10px] tracking-[1px] text-[#878888]">{title}</div>}<div className="space-y-1 text-sm">{count ? children : <div className="px-2 py-4 text-[#777]">{empty}</div>}</div></div>; }
function EmptyPanel() { return <div className="flex flex-1 items-center justify-center text-sm text-[#777]">Connect to a server, then refresh the dashboard.</div>; }
function LoadingPanel() { return <div className="flex flex-1 items-center justify-center text-sm text-[#777]"><Icon icon={RefreshIcon} size={15} className="mr-2 animate-spin" />Reading server health...</div>; }

function SettingsPanel({ host, onDisconnect, onForgetServer, onManageKeys, onOpenExplorer, onPreferencesChange, onReconnect, onServerNameChange, onWorkspaceChange, port, profile, serverName, username, workspacePath }: ServerViewProps & { onManageKeys: () => void; onReconnect: () => void }) {
  const [nameValue, setNameValue] = useState(serverName);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [workspaceValue, setWorkspaceValue] = useState(workspacePath);
  const [reconnecting, setReconnecting] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [preferenceSaving, setPreferenceSaving] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetError, setForgetError] = useState("");

  useEffect(() => setNameValue(serverName), [serverName]);
  useEffect(() => setWorkspaceValue(workspacePath), [workspacePath]);
  useEffect(() => {
    let active = true;
    setSettings(null);
    setSettingsError("");
    void api.serverSettings().then((value) => {
      if (active) setSettings(value);
    }).catch((error) => {
      if (!active) return;
      const message = messageFromError(error);
      setSettingsError(message.includes("404") || message.includes("Not Found") ? "Restart Coloride to load the updated server settings." : message);
    });
    return () => { active = false; };
  }, [host, port]);

  const saveName = async () => {
    const nextName = nameValue.trim();
    if (!nextName) {
      setNameValue(serverName);
      return;
    }
    if (nextName === serverName || nameSaving) return;

    setNameSaving(true);
    setNameError("");
    try {
      await onServerNameChange(nextName);
      setNameValue(nextName);
    } catch (error) {
      setNameError(messageFromError(error));
    } finally {
      setNameSaving(false);
    }
  };
  const saveWorkspace = async () => {
    const nextPath = workspaceValue.trim();
    if (!nextPath || !nextPath.startsWith("/")) {
      setWorkspaceError("Use an absolute server path.");
      return;
    }
    setWorkspaceSaving(true);
    setWorkspaceError("");
    try {
      await onWorkspaceChange(nextPath);
      setWorkspaceValue(nextPath);
    } catch (error) {
      setWorkspaceError(messageFromError(error));
    } finally {
      setWorkspaceSaving(false);
    }
  };
  const reconnect = async () => {
    setReconnecting(true);
    try { await api.reconnect(); onReconnect(); } finally { setReconnecting(false); }
  };
  const savePreference = async (key: "defaultShell" | "terminalPersistence" | "monitorInterval", value: string | boolean | number) => {
    setPreferenceSaving(key);
    setSettingsError("");
    try {
      await onPreferencesChange({ [key]: value });
    } catch (error) {
      setSettingsError(messageFromError(error));
    } finally {
      setPreferenceSaving("");
    }
  };
  const disconnect = async () => {
    setActionBusy("disconnect");
    try { await onDisconnect(); } catch (error) { setSettingsError(messageFromError(error)); setActionBusy(""); }
  };
  const forgetServer = async () => {
    setActionBusy("forget");
    setForgetError("");
    try {
      await onForgetServer();
    } catch (error) {
      setForgetError(messageFromError(error));
      setActionBusy("");
    }
  };

  return <><div className="mx-auto w-full max-w-3xl py-2 text-[#d0d0d5]"><div className="w-full space-y-1">
    <SettingsRow label="Server Name"><div><input value={nameValue} disabled={nameSaving} onBlur={() => void saveName()} onChange={(event) => { setNameValue(event.target.value); setNameError(""); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="settings-field" aria-label="Server Name" aria-busy={nameSaving} />{nameError && <div className="mt-1.5 text-xs text-[#f19b9b]">{nameError}</div>}</div></SettingsRow>
    <SettingsRow label="Username"><CopyableSettingsValue label="username" value={username || "-"} disabled={!username} /></SettingsRow>
    <SettingsRow label="Connection Details"><CopyableSettingsValue label="connection details" value={`${username}@${host}:${port}`} /></SettingsRow>
    <SettingsRow label={<SettingsHelpLabel label="Default Workspace" help="Coloride copies this folder into /home/coloride/workspaces. The agent works only in that copy." />}><div><div className="flex gap-2"><input value={workspaceValue} onChange={(event) => { setWorkspaceValue(event.target.value); setWorkspaceError(""); }} onKeyDown={(event) => { if (event.key === "Enter") void saveWorkspace(); }} className="settings-field min-w-0 flex-1" aria-label="Default Workspace" /><ActionButton onClick={() => void saveWorkspace()} disabled={workspaceSaving}>{workspaceSaving ? "Preparing" : "Apply"}</ActionButton></div>{workspaceError && <div className="mt-1.5 text-xs text-[#f19b9b]">{workspaceError}</div>}</div></SettingsRow>
    <SettingsRow label="Workspace Folder"><div className="flex justify-end"><ActionButton onClick={onOpenExplorer}>Change Workspace</ActionButton></div></SettingsRow>
    <SettingsRow label={<SettingsHelpLabel label="Default Shell" help="The command shell used when Coloride creates a new terminal. Server default uses the shell configured for this account." />}><SettingsSelect value={profile?.defaultShell ?? "default"} disabled={preferenceSaving === "defaultShell"} options={[{ value: "default", label: "Server default" }, { value: "bash", label: "Bash" }, { value: "zsh", label: "Zsh" }, { value: "fish", label: "Fish" }]} onChange={(value) => void savePreference("defaultShell", value)} /></SettingsRow>
    <SettingsRow label={<SettingsHelpLabel label="Terminal Persistence" help="Keeps terminal sessions running on the server when Coloride closes or temporarily disconnects, so they can be restored later." />}><SettingsSwitch checked={profile?.terminalPersistence ?? true} disabled={preferenceSaving === "terminalPersistence"} onChange={(checked) => void savePreference("terminalPersistence", checked)} /></SettingsRow>
    <SettingsRow label={<SettingsHelpLabel label="Monitoring Interval" help="How often Coloride requests fresh health, process, service, port and log data from this server." />}><SettingsSelect value={String(profile?.monitorInterval ?? 5)} disabled={preferenceSaving === "monitorInterval"} options={[2, 5, 10, 30].map((value) => ({ value: String(value), label: `${value} seconds` }))} onChange={(value) => void savePreference("monitorInterval", Number(value))} /></SettingsRow>
    <div className="my-4 h-px bg-[#313131]" />
    <SettingsRow label={<SettingsHelpLabel label="SSH Keys" help="Authorized SSH keys let trusted devices access this server without sharing the account password." />}><div className="flex justify-end"><ActionButton onClick={onManageKeys}>Manage Keys</ActionButton></div></SettingsRow>
    <SettingsRow label={<SettingsHelpLabel label="Authentication" help="The credential method currently used by Coloride to establish this SSH connection, such as a password or private key." />}><div className="text-right text-sm capitalize text-[#f0f4f8]">{settings?.authenticationMethod.replace("-", " ") ?? (settingsError ? "Unavailable" : "Reading...")}</div></SettingsRow>
    <div className="my-4 h-px bg-[#313131]" />
    <SettingsRow label="Operating System"><CopyableSettingsValue label="operating system" value={settings?.operatingSystem ?? (settingsError ? "Unavailable" : "Reading...")} disabled={!settings?.operatingSystem} /></SettingsRow>
    <SettingsRow label="Hostname"><CopyableSettingsValue label="hostname" value={settings?.hostname ?? "-"} disabled={!settings?.hostname} /></SettingsRow>
    <SettingsRow label={<SettingsHelpLabel label="Architecture" help="The server CPU architecture and operating-system kernel. This determines which software builds can run on the VPS." />}><CopyableSettingsValue label="architecture" value={settings ? `${settings.architecture} · ${settings.kernel}` : "-"} disabled={!settings} /></SettingsRow>
    <SettingsRow label="Uptime"><div className="text-right text-sm text-[#f0f4f8]">{settings ? formatUptime(settings.uptimeSeconds) : "-"}</div></SettingsRow>
    <div className="my-4 h-px bg-[#313131]" />
    <SettingsRow label="Connection"><div className="flex justify-end"><ActionButton onClick={reconnect} disabled={reconnecting}>{reconnecting ? "Reconnecting" : "Reconnect"}</ActionButton></div></SettingsRow>
    <SettingsRow label="Disconnect"><div className="flex justify-end"><ActionButton onClick={() => void disconnect()} disabled={Boolean(actionBusy)}>Disconnect</ActionButton></div></SettingsRow>
    <SettingsRow label="Saved Server"><div className="flex justify-end"><ActionButton danger onClick={() => { setForgetError(""); setForgetOpen(true); }} disabled={Boolean(actionBusy)}>Forget Server</ActionButton></div></SettingsRow>
    {settingsError && <div className="pt-2 text-right text-xs text-[#f19b9b]">{settingsError}</div>}
  </div></div><AnimatePresence>{forgetOpen && <ForgetServerModal busy={actionBusy === "forget"} error={forgetError} serverName={serverName} onClose={() => { if (!actionBusy) setForgetOpen(false); }} onConfirm={() => void forgetServer()} />}</AnimatePresence></>;
}

function ForgetServerModal({ busy, error, onClose, onConfirm, serverName }: { busy: boolean; error: string; onClose: () => void; onConfirm: () => void; serverName: string }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[700] flex items-center justify-center bg-black/45 p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="forget-server-title"
        aria-describedby="forget-server-description"
        className="w-full max-w-md rounded-2xl border border-[#3a3a3a] bg-[#202020] p-5 shadow-2xl"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="forget-server-title" className="text-base font-medium text-white">Forget {serverName}?</h2>
        <p id="forget-server-description" className="mt-2 text-sm leading-6 text-[#a6a6aa]">
          Coloride will disconnect this server and remove its saved profile from this device.
        </p>
        <div className="mt-4 rounded-xl bg-[#181818] px-4 py-3 text-xs leading-5 text-[#a6a6aa]">
          <div>Your saved credential, preferences and trusted host identity will be removed.</div>
          <div className="mt-2 text-[#d8d8dc]">Files, services and authorized SSH keys on the VPS will not be changed.</div>
        </div>
        <p className="mt-3 text-xs leading-5 text-[#858589]">You will need the connection details and credentials to add this server again.</p>
        {error && <div className="mt-3 text-xs leading-5 text-[#f19b9b]">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton onClick={onClose} disabled={busy}>Cancel</ActionButton>
          <ActionButton danger onClick={onConfirm} disabled={busy}>{busy ? "Forgetting" : "Forget Server"}</ActionButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
};

function SettingsSelect({ disabled, onChange, options, value }: { disabled?: boolean; onChange: (value: string) => void; options: { label: string; value: string }[]; value: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return <div ref={ref} className="relative flex justify-end"><button type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen((current) => !current)} className="server-settings-select inline-flex h-8 min-w-36 items-center justify-between gap-3 rounded-xl bg-[#2c2c2c] px-3 text-xs text-[#ededf0] transition-colors hover:bg-[#383838] disabled:opacity-50"><span>{selected.label}</span><Icon icon={ArrowDown01Icon} size={14} className={`text-[#8d8d92] transition-transform ${open ? "rotate-180" : ""}`} /></button><AnimatePresence>{open && <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.14 }} className="server-settings-select-menu absolute right-0 top-10 z-30 min-w-40 rounded-xl bg-[#2c2c2c] p-1.5 shadow-xl">{options.map((option) => <button type="button" key={option.value} data-active={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }} className={`server-settings-select-option flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${option.value === value ? "bg-[#3b3b3b] text-white" : "text-[#c8c8cc] hover:bg-[#373737]"}`}><span>{option.label}</span>{option.value === value && <Icon icon={Tick02Icon} size={13} />}</button>)}</motion.div>}</AnimatePresence></div>;
}

function SettingsSwitch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex justify-end"><button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-5 w-11 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-[#4cae77]" : "bg-[#474747]"}`}><span className={`absolute top-0.5 h-4 w-6 rounded-full bg-white transition-[left,transform] duration-200 ${checked ? "left-[18px]" : "left-0.5"}`} /></button></div>;
}

function SettingsRow({ children, label }: { children: React.ReactNode; label: React.ReactNode }) { return <div className="grid grid-cols-[minmax(10rem,0.7fr)_minmax(0,1.3fr)] items-center gap-[clamp(2rem,8vw,8rem)] py-2"><div className="text-sm text-[#a6a6aa]">{label}</div><div className="min-w-0">{children}</div></div>; }

function SettingsHelpLabel({ help, label }: { help: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <span>{label}</span>
      <span
        className="relative inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          aria-label={`About ${label}`}
          onBlur={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          className="flex rounded-lg p-0.5 text-[#777] transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none"
        >
          <Icon icon={HelpCircleIcon} size={14} />
        </button>
        <span
          aria-hidden="true"
          className="pointer-events-auto absolute top-full h-4 w-10"
          style={{ left: "50%", transform: "translateX(-50%)" }}
        />
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, x: "calc(-50% + 36px)", y: -4, scale: 0.98 }}
              animate={{ opacity: 1, x: "calc(-50% + 36px)", y: 0, scale: 1 }}
              exit={{ opacity: 0, x: "calc(-50% + 36px)", y: -4, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="absolute left-1/2 top-[calc(100%+12px)] z-40 w-64 rounded-2xl bg-white p-3 text-left text-xs leading-relaxed text-[#5d5d5d] shadow-[0_12px_30px_rgba(0,0,0,0.32)]"
            >
              <span
                aria-hidden="true"
                className="absolute z-10 h-4 w-4 rounded-[3px] bg-white"
                style={{ left: "calc(50% - 36px)", top: "-7px", transform: "translateX(-50%) rotate(45deg)" }}
              />
              <div className="relative z-20 font-medium text-[#151515]">{label}</div>
              <p className="relative z-20 mt-1">{help}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}
function ActionButton({ children, danger = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) { return <button {...props} data-danger={danger} className={`server-action-button inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl disabled:opacity-50 text-xs transition-colors ${danger ? "bg-[#3a2828] text-[#efaaaa] hover:bg-[#4a3030] active:bg-[#563535]" : "bg-[#2c2c2c] hover:bg-[#383838] active:bg-[#444]"}`}>{children}</button>; }

function CopyableSettingsValue({ disabled = false, label, value }: { disabled?: boolean; label: string; value: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setCopyState("idle"), 1_600);
  };

  return (
    <div className="group flex min-w-0 items-center justify-end">
      <span className={`truncate text-right text-sm text-[#f0f4f8] transition-transform duration-150 ${disabled ? "" : "group-hover:-translate-x-1 group-focus-within:-translate-x-1"}`}>{value}</span>
      {!disabled && (
        <span className={`flex shrink-0 items-center justify-end overflow-hidden transition-[width,margin,opacity] duration-150 ${copyState === "idle" ? "ml-0 w-0 opacity-0 group-hover:ml-2 group-hover:w-7 group-hover:opacity-100 group-focus-within:ml-2 group-focus-within:w-7 group-focus-within:opacity-100" : copyState === "copied" ? "ml-2 w-7 opacity-100" : "ml-2 w-12 opacity-100"}`}>
          {copyState === "idle" ? (
            <button type="button" title={`Copy ${label}`} aria-label={`Copy ${label}`} onClick={() => void copy()} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#929297] transition-colors hover:bg-[#343434] hover:text-white active:bg-[#404040]">
              <SettingsCopyIcon />
            </button>
          ) : copyState === "copied" ? (
            <span role="status" aria-label="Copied successfully" className="inline-flex h-7 w-7 items-center justify-center text-[#62c98b]"><SettingsCopiedIcon /></span>
          ) : <span role="status" className="w-12 text-right text-[10px] text-[#f19b9b]">Failed</span>}
        </span>
      )}
    </div>
  );
}

function SettingsCopyIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 11V9C7 5.70017 7 4.05025 8.02513 3.02513C9.05025 2 10.7002 2 14 2C17.2998 2 18.9497 2 19.9749 3.02513C21 4.05025 21 5.70017 21 9V11C21 14.2998 21 15.9497 19.9749 16.9749C18.9497 18 17.2998 18 14 18C10.7002 18 9.05025 18 8.02513 16.9749C7 15.9497 7 14.2998 7 11Z" /><path d="M3 6V15C3 18.2998 3 19.9497 4.02513 20.9749C5.05025 22 6.70017 22 10 22H17" /></svg>;
}

function SettingsCopiedIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 10.6667C11 10.6667 11.75 10.6667 12.5 12C12.5 12 14.8824 8.66667 17 8" /><path d="M7 11V9C7 5.70017 7 4.05025 8.02513 3.02513C9.05025 2 10.7002 2 14 2C17.2998 2 18.9497 2 19.9749 3.02513C21 4.05025 21 5.70017 21 9V11C21 14.2998 21 15.9497 19.9749 16.9749C18.9497 18 17.2998 18 14 18C10.7002 18 9.05025 18 8.02513 16.9749C7 15.9497 7 14.2998 7 11Z" /><path d="M3 6V15C3 18.2998 3 19.9497 4.02513 20.9749C5.05025 22 6.70017 22 10 22H17" /></svg>;
}

function ManageKeysModal({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<AuthorizedKey[]>([]);
  const [keyName, setKeyName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setKeys((await api.authorizedKeys()).keys);
      setError("");
    } catch (reason) {
      setError(messageFromError(reason));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const fields = publicKey.trim().split(/\s+/);
    const keyWithName = `${fields[0] ?? ""} ${fields[1] ?? ""} ${keyName.trim()}`.trim();
    setBusy(true);
    try {
      setKeys((await api.addAuthorizedKey(keyWithName)).keys);
      setKeyName("");
      setPublicKey("");
      setError("");
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: AuthorizedKey) => {
    if (!window.confirm(`Remove ${key.comment || key.fingerprint} from this server? This can remove access for someone.`)) return;
    setBusy(true);
    try {
      setKeys((await api.deleteAuthorizedKey(key.id)).keys);
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="fixed inset-0 z-[700] flex items-center justify-center bg-black/45 p-5">
      <motion.div onClick={(event) => event.stopPropagation()} initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18, ease: "easeOut" }} role="dialog" aria-modal="true" className="w-full max-w-xl rounded-2xl border border-[#333333] bg-[#202020] shadow-2xl">
        <div className="border-b border-[#363636] px-4 py-3">
          <div className="font-medium text-white">Authorized SSH keys</div>
          <div className="mt-0.5 text-xs text-[#8a8a8a]">These keys can access this server as the connected user.</div>
        </div>
        <div className="max-h-[45vh] space-y-2 overflow-auto p-4">
          {keys.length ? keys.map((key) => (
            <div key={key.id} className="flex items-center gap-3 rounded-xl bg-[#191919] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-[#eee]">{key.comment || "Unnamed key"}</div>
                <div className="truncate font-mono text-[10px] text-[#888]">{key.algorithm} · {key.fingerprint}</div>
              </div>
              <button disabled={busy} title="Remove key" onClick={() => void remove(key)} className="manage-key-delete rounded-lg p-1.5 text-[#aaa] hover:bg-[#4a2626] hover:text-[#f3a0a0] disabled:opacity-50"><Icon icon={Delete02Icon} size={14} /></button>
            </div>
          )) : <div className="py-4 text-sm text-[#777]">No authorized keys found.</div>}
        </div>
        <div className="border-t border-[#363636] p-4">
          <label className="text-xs text-[#aaa]">Key label</label>
          <input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Development device" className="mt-2 h-9 w-full rounded-xl bg-[#171717] px-3 text-xs text-white outline-none" />
          <label className="mt-3 block text-xs text-[#aaa]">Public key</label>
          <textarea value={publicKey} onChange={(event) => setPublicKey(event.target.value)} placeholder="ssh-ed25519 AAAA..." className="mt-2 h-20 w-full resize-none rounded-xl bg-[#171717] p-2 font-mono text-xs text-white outline-none" />
          {error && <div className="mt-2 text-xs text-[#ef9b9b]">{error}</div>}
          <div className="mt-3 flex justify-end gap-2">
            <ActionButton onClick={onClose}>Close</ActionButton>
            <ActionButton onClick={() => void add()} disabled={busy || !keyName.trim() || publicKey.trim().length < 20}>{busy ? "Saving" : "Add key"}</ActionButton>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
