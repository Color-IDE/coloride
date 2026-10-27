// Test-only entrypoint; excluded from the application build.
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { XTerminal, type XTerminalHandle } from "../src/features/terminal/XTerminal";
import { disposeTerminalView } from "../src/features/terminal/terminalTeardown";
import { hydrateRuntimeFromDesktop } from "../src/shared/api/client";
import "../src/app/styles.css";

const originalOpen = Terminal.prototype.open;
Terminal.prototype.open = function (parent) {
  (window as any).terminalUnderTest = this;
  ((window as any).terminalInstances ??= []).push(this);
  originalOpen.call(this, parent);
};
const OriginalSocket = window.WebSocket;
(window as any).terminalSockets = [];
window.WebSocket = class extends OriginalSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    if (String(url).includes("/ws/term/")) (window as any).terminalSockets.push(this);
  }
};
// Exercise public open/reset/dispose in one turn, before xterm's deferred
// viewport sync runs. This reproduces the reported dimensions teardown race.
(window as any).probeTerminalTeardown = async () => {
  for (let i = 0; i < 12; i++) {
    const host = document.createElement("div");
    host.style.cssText = "width:400px;height:200px";
    document.body.append(host);
    const term = new Terminal({cols:40,rows:10});
    originalOpen.call(term, host);
    term.reset();
    disposeTerminalView(term);
    host.remove();
  }
  await new Promise(resolve => setTimeout(resolve, 100));
};
await hydrateRuntimeFromDesktop();
const params = new URLSearchParams(location.search);
function Harness() {
  const [split, setSplit] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [shown, setShown] = useState(true);
  const ref = useRef<XTerminalHandle>(null);
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <div style={{height: 40, flexShrink: 0}}>
      <button onClick={() => setSplit(!split)}>Split terminal</button>
      <button onClick={() => setEpoch(epoch + 1)}>Remount terminal</button>
      <button onClick={() => setShown(!shown)}>Toggle terminal</button>
      <button onClick={() => ref.current?.clear()}>Clear terminal</button>
      <button onClick={() => ref.current?.zoomIn()}>Zoom in</button>
      <button onClick={() => { for (let i=0;i<50;i++) ref.current?.fit(); }}>Repeat fit</button>
      <button onClick={() => ref.current?.zoomOut()}>Zoom out</button>
      <button onClick={() => ref.current?.pasteFromClipboard()}>Paste</button>
    </div>
    <div style={{ flex: 1, minHeight: 0, display: shown ? "flex" : "none" }}>
      <div style={{ flex: 1, minWidth: 0 }}><XTerminal key={epoch} ref={ref} active={shown} focused connected workspaceKind="local"
        renderer={params.get("renderer") === "webgl" ? "webgl" : undefined}
        workspaceId={params.get("cwd")!} cwd={params.get("cwd")!}
        sessionId={params.get("session") ?? "terminal-test"}
        onOpenBrowserUrl={(url) => { ((window as any).openedTerminalLinks ??= []).push(url); }} /></div>
      {split && <div style={{ flex: 1, minWidth: 0 }}><XTerminal active={shown} focused connected workspaceKind="local"
        renderer={params.get("renderer") === "webgl" ? "webgl" : undefined}
        workspaceId={params.get("cwd")!} cwd={params.get("cwd")!} sessionId={`${params.get("session")}-split`} /></div>}
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
