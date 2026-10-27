import React from "react";
import { createRoot } from "react-dom/client";
import { AgentView } from "../src/features/agents/AgentView";
import { NotificationViewport } from "../src/shared/ui/NotificationViewport";
import "../src/app/styles.css";

createRoot(document.getElementById("root")!).render(
  <><main style={{ height: "100vh", display: "flex" }}>
    <AgentView
      active connected presentation="sidebar" sessionPane="agent"
      workspaceKind="local" connectionId="local" workspacePath="/fixture/project"
      serverName="Local" sidePanelOpen sidePanelWidth={280} onResizeStart={() => {}}
    />
  </main><NotificationViewport /></>,
);
