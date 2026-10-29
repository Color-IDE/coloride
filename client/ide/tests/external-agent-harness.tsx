import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExternalAgentView } from "../src/features/external-agents/ExternalAgentView";
import "../src/app/styles.css";

function Harness() {
  const [workspace, setWorkspace] = useState("/fixture/project");
  useEffect(() => {
    const change = (event: Event) => setWorkspace((event as CustomEvent<string>).detail);
    window.addEventListener("test-editor-workspace", change);
    return () => window.removeEventListener("test-editor-workspace", change);
  }, []);
  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <output aria-label="Editor opened file" />
      <ExternalAgentView key={workspace} active sessionId="codex-1" workspaceKind="local" workspacePath={workspace}
        onOpenExplorerFile={path => { document.querySelector('[aria-label="Editor opened file"]')!.textContent = path; }} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
