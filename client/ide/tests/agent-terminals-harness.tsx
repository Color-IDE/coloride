// Test-only entrypoint: real workspace panel, terminal transport and host events.
import { Terminal } from "@xterm/xterm";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentWorkspacePanel } from "../src/features/agents/AgentWorkspacePanel";
import { AgentTimelineTurn, type AgentTimelineEntry } from "../src/features/agents/AgentTimeline";
import { api, hydrateRuntimeFromDesktop } from "../src/shared/api/client";
import type { AgentTerminalReference } from "../src/shared/api/types";
import "../src/app/styles.css";
const originalOpen = Terminal.prototype.open;
Terminal.prototype.open = function(parent) {
  ((window as any).agentTerminals ??= []).push(this);
  originalOpen.call(this, parent);
};
await hydrateRuntimeFromDesktop();
const params = new URLSearchParams(location.search);
const cwd = params.get("cwd")!;
const sessionId = params.get("session")!;
function Harness() {
  const [request, setRequest] = useState<{kind: "terminal"; nonce: number; terminal: AgentTerminalReference} | null>(null);
  const [recovery, setRecovery] = useState<AgentTerminalReference[]>([]);
  const [processEntry, setProcessEntry] = useState<AgentTimelineEntry | null>(null);
  useEffect(() => {
    const socket = api.events((event) => {
      if (event.event === "term:reveal" && event.payload.agentSessionId === sessionId) {
        setRequest({kind: "terminal", nonce: Date.now(), terminal: event.payload as AgentTerminalReference});
      }
    });
    void api.listTerminals({workspaceKind: "local"}).then((all) => setRecovery(all.filter(t => t.agentSessionId === sessionId && t.revealed !== false)));
    const showProcess = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      setProcessEntry({
        id: "hidden-process",
        kind: "tool",
        itemId: "hidden-process",
        tool: "start_process",
        title: "Start process",
        arguments: {command: String(detail.command || "npm run dev")},
        output: "Started process. Output stays available in chat.",
        metadata: detail,
        diff: "",
        preview: "",
        complete: true,
        failed: false,
        waitingApproval: false,
      });
    };
    window.addEventListener("show-agent-process", showProcess);
    return () => { socket.close(); window.removeEventListener("show-agent-process", showProcess); };
  }, []);
  return <div className="agent-view" style={{height: "100vh", display: "flex"}}>
    <div style={{width: 430, padding: 20}}>
      {processEntry ? <AgentTimelineTurn items={[processEntry]} onOpenTerminal={(terminal) => setRequest({kind: "terminal", nonce: Date.now(), terminal})} turnActive={false} user={null} /> : null}
    </div>
    <div style={{flex: 1, minWidth: 0}}>
      <AgentWorkspacePanel active connected sessionId={sessionId} workspacePath={cwd} workspaceKind="local" connectionId="local"
        openRequest={request} terminalRecovery={recovery} openFileRequest={null} openBrowserRequest={null} gitAvailable={false} />
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
