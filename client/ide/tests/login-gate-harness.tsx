import React from "react";
import { createRoot } from "react-dom/client";
import { LoginGate } from "../src/features/auth/LoginGate";
import "../src/app/styles.css";

const allowLocal = new URLSearchParams(location.search).get("local") === "1";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LoginGate allowLocal={allowLocal}>
      <main aria-label="Workspace">Local editor and terminals</main>
    </LoginGate>
  </React.StrictMode>,
);
