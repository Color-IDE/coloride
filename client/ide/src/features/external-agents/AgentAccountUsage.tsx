import type { ExternalAgentAccountUsage } from "@coloride/contracts";
import { useEffect, useState } from "react";
import { useConnectedAccounts } from "./connectedAccounts";
import { externalAgentsApi } from "./api";
import { AgentMark, ChatGPTMark } from "./marks";
import "./account-usage.css";

function windowLabel(minutes: number) {
  if (minutes === 10080) return "Week";
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function AgentAccountUsage() {
  const connected = useConnectedAccounts();
  const activeAgentIds = connected.map(account => account.agentId).sort().join(",");
  const [accounts, setAccounts] = useState<ExternalAgentAccountUsage[]>([]);
  useEffect(() => {
    if (!activeAgentIds) return;
    let disposed = false;
    let pending = false;
    let refreshAgain = false;
    const refresh = async () => {
      if (disposed || document.visibilityState === "hidden") return;
      if (pending) { refreshAgain = true; return; }
      pending = true;
      try {
        const next = await externalAgentsApi.usage();
        if (!disposed) setAccounts(next);
      } catch {
        if (!disposed) setAccounts(current => current.map(account => ({...account, status:"unavailable", windows:[]})));
      } finally {
        pending = false;
        if (refreshAgain && !disposed) {
          refreshAgain = false;
          void refresh();
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("coloride:agent-account-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("coloride:agent-account-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeAgentIds]);
  const visible = connected.map(account => accounts.find(item => item.agentId === account.agentId) ?? {
    ...account, status:"unavailable", windows:[], updatedAt:null,
  } as ExternalAgentAccountUsage);
  if (!visible.length) return null;
  return <div className="agent-account-usage" aria-label="Connected agent usage">
    {visible.map(account => <div className="agent-account-usage-provider" key={account.agentId}>
      <span className="agent-account-usage-icon" title={account.name}>
        {account.agentId === "codex-acp" || account.agentId === "codex" ? <ChatGPTMark /> : <AgentMark agentId={account.agentId} />}
      </span>
      {(account.status === "available" && account.windows.length
        ? account.windows
        : account.agentId === "codex-acp" || account.agentId === "codex"
          ? [{windowMinutes:300, usedPercent:null, resetsAt:null}, {windowMinutes:10080, usedPercent:null, resetsAt:null}]
          : [{windowMinutes:0, usedPercent:null, resetsAt:null}]
      ).map(window => {
        const label = window.windowMinutes ? windowLabel(window.windowMinutes) : "Usage";
        const percent = window.usedPercent === null ? null : Math.round(window.usedPercent);
        const reset = window.resetsAt ? ` · Resets ${new Date(window.resetsAt * 1000).toLocaleString()}` : "";
        const description = percent === null
          ? `${account.name} ${label}: account limits unavailable`
          : `${account.name}: ${percent}% used in ${label}${reset}`;
        return <span className="agent-account-usage-window" key={window.windowMinutes} title={description}>
          <span>{label}</span>
          <span className={`agent-account-usage-track${percent === null ? " is-unavailable" : ""}`}
            role={percent === null ? "img" : "meter"} aria-label={description}
            aria-valuemin={percent === null ? undefined : 0} aria-valuemax={percent === null ? undefined : 100}
            aria-valuenow={window.usedPercent ?? undefined}
            aria-valuetext={percent === null ? undefined : `${percent}% used`}>
            {percent === null ? null : <span style={{width:`${window.usedPercent}%`}} />}
          </span>
          <span className="agent-account-usage-percent">{percent ?? "—"}%</span>
        </span>;
      })}
    </div>)}
  </div>;
}
