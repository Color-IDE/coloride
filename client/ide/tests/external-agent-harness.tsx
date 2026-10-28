import React from "react";
import { createRoot } from "react-dom/client";
import { ExternalAgentView } from "../src/features/external-agents/ExternalAgentView";
import "../src/app/styles.css";

createRoot(document.getElementById("root")!).render(
  <main style={{ height: "100vh", display: "flex" }}>
    <ExternalAgentView active sessionId="codex-1" workspaceKind="local" />
  </main>,
);
