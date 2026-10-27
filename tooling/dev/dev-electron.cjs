"use strict";

// pnpm/npm set ELECTRON_RUN_AS_NODE, which makes Electron run as Node
// instead of launching the desktop app. `env -u` is Unix-only.
delete process.env.ELECTRON_RUN_AS_NODE;
process.env.COLORIDE_DEV = "1";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const electron = require("electron");
const repoRoot = path.resolve(__dirname, "..", "..");
const main = path.join(repoRoot, "client", "desktop", "src", "main.cjs");
const electronRoot = path.join(repoRoot, "client", "desktop");
const runtimeBundle = path.join(electronRoot, "resources", "agent-runtime", "cline-runtime.mjs");
const runtimeBuild = path.join(electronRoot, "src", "agent-runtime", "build.mjs");
if (!fs.existsSync(runtimeBundle) && fs.existsSync(runtimeBuild)) {
  const built = spawnSync(process.execPath, [runtimeBuild], {
    cwd: electronRoot,
    stdio: "inherit",
  });
  if (built.status !== 0) {
    console.error("[agent-runtime] failed to build cline-runtime.mjs");
    process.exit(built.status ?? 1);
  }
}

const child = spawn(electron, [main], {
  stdio: "inherit",
  env: process.env,
  windowsHide: false,
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
