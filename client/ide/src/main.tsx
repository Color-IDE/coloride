import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { captureMessage, init as initSentry } from "@sentry/electron/renderer";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import { App } from "./app/App";
import { installStartupTransition } from "./app/startup";
import { hydrateRuntimeFromDesktop } from "./shared/api/client";
import "./app/styles.css";

const SettingsWindow = lazy(() => import("./app/SettingsWindow"));
const isSettingsWindow = new URLSearchParams(location.search).get("window") === "settings";

// Renderer-side Sentry (pairs with main-process init). DSN is configured in main.
initSentry({
  // Keep light in UI; main owns the project DSN / release.
  sendDefaultPii: true,
});

window.addEventListener("coloride:terminal-telemetry", (event) => {
  const detail = (event as CustomEvent<{ event?: string; workspaceKind?: string }>).detail;
  if (!detail?.event) return;
  captureMessage(`terminal.${detail.event}`, {
    level: detail.event === "failed" ? "error" : "info",
    tags: { workspaceKind: detail.workspaceKind || "unknown" },
  });
});

hydrateRuntimeFromDesktop()
  .catch(() => undefined)
  .finally(() => {
    if (isSettingsWindow) {
      document.querySelector(".coloride-boot-splash")?.remove();
      delete document.documentElement.dataset.startup;
      delete document.documentElement.dataset.startupSurface;
    } else {
      installStartupTransition();
    }
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        {isSettingsWindow ? <Suspense fallback={null}><SettingsWindow /></Suspense> : <App />}
      </React.StrictMode>
    );
  });
