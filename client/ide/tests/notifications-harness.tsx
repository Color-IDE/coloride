import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NotificationViewport } from "../src/shared/ui/NotificationViewport";
import { notify } from "../src/shared/ui/notifications";
import "../src/app/styles.css";

function Harness() {
  const [theme, setTheme] = useState("dark");
  const [actions, setActions] = useState(0);
  const examples = () => {
    notify({ id: "saved", title: "File saved", description: "All changes to App.tsx are saved.", kind: "success", duration: 0 });
    notify({ id: "connection", title: "Connection interrupted", description: "Your terminal session is preserved. Reconnect when you are ready.", kind: "warning",
      action: { label: "Reconnect", onClick: () => setActions(value => value + 1) } });
    notify({ id: "failed", title: "Unable to save file", description: "The folder is read-only. Choose another location and try again.", kind: "error" });
  };
  return (
    <main className="login-gate-root" style={{ height: "100vh", background: "var(--ui-surface)", color: "var(--ui-text-primary)", padding: 24 }}>
      <h1>Notification preview</h1>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={examples}>Show examples</button>
        <button onClick={() => notify({ title: "Temporary notice", duration: 600 })}>Temporary</button>
        <button onClick={() => notify({ title: "Update available", kind: "info", description: "A new version is ready to install.", duration: 0 })}>Add notification</button>
        <button onClick={() => notify({ id: "saved", title: "File saved again", kind: "success", duration: 0 })}>Replace saved</button>
        <button onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          document.body.dataset.theme = next;
          document.documentElement.dataset.theme = next;
          setTheme(next);
        }}>Toggle theme</button>
      </div>
      <output aria-label="Action count">{actions}</output>
      <NotificationViewport />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
