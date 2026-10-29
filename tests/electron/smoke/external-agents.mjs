// Production UI/source host, disposable HOME/profile. Real registry and npm;
// conversation transport uses the deterministic ACP fixture, never an account.
import { _electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
const { resolveTestPython } = require("../support/python.cjs");
const sandbox = await realpath(
  await mkdtemp(join(tmpdir(), "coloride-acp-ui-")),
);
const home = join(sandbox, "home"),
  profile = join(sandbox, "profile"),
  project = join(sandbox, "project");
const output = resolve("artifacts/external-agents");
await Promise.all(
  [home, profile, project, output].map((folder) =>
    mkdir(folder, { recursive: true }),
  ),
);
await writeFile(join(project, "fixture.txt"), "ACP UI smoke\n");
const env = {
  ...process.env,
  HOME: home,
  CODEX_HOME: join(home, "codex"),
  npm_config_cache: join(sandbox, "npm-cache"),
  COLORIDE_TEST_USER_DATA: profile,
  COLORIDE_PYTHON: resolveTestPython(),
  COLORIDE_DEV: "0",
  COLORIDE_CLOUD_ENABLED: "0",
  COLORIDE_SENTRY_DISABLED: "1",
  COLORIDE_SKIP_UPDATE_CHECK: "1",
};
await mkdir(env.CODEX_HOME);
for (const key of Object.keys(env))
  if (
    key.startsWith("OPENAI_") ||
    key.startsWith("CODEX_API_") ||
    [
      "ELECTRON_RUN_AS_NODE",
      "COLORIDE_WEB_DEV_URL",
      "COLORIDE_SIDECAR",
      "COLORIDE_NODE",
      "COLORIDE_NPM",
    ].includes(key)
  )
    delete env[key];
let app, page, settings, runtime;
const errors = [];
const reports = [];
const launch = async () => {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [resolve("client/desktop/src/main.cjs")],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".app-workspace-region")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-startup", /.+/);
  runtime = await page.evaluate(() => window.colorideDesktop.getRuntime());
};
const openSettings = async () => {
  const waiting = app.waitForEvent("window");
  await page.evaluate(() =>
    window.colorideDesktop.openSettings("external-agents"),
  );
  settings = await waiting;
  settings.on("pageerror", (error) => errors.push(error.message));
  await expect(
    settings.getByRole("region", { name: "ACP Registry", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", {
      name: "Refresh agent catalog",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 45000 });
};
const api = async (path, body) => {
  const response = await fetch(
    `http://${runtime.host}:${runtime.port}/api/external-agents${path}`,
    {
      headers: {
        Authorization: `Bearer ${runtime.token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    },
  );
  assert(
    response.ok,
    `${path}: ${response.status} ${response.ok ? "" : await response.text()}`,
  );
  return response.json();
};
try {
  await launch();
  await openSettings();
  const liveCatalog = await api("/registry");
  assert(liveCatalog.length > 1);
  await expect(settings.locator(".acp-agent-card")).toHaveCount(
    liveCatalog.length,
  );
  reports.push("Live ACP catalog renders with search and filters");
  await settings.getByLabel("Search agents", { exact: true }).fill("Codex");
  await expect(settings.locator(".acp-agent-card")).toHaveCount(1);
  const card = settings.getByRole("article", { name: "Codex", exact: true });
  await card.getByRole("button", { name: "Install", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Remove", exact: true }),
  ).toBeVisible({ timeout: 180000 });
  await expect(
    card.getByRole("button", { name: "Remove", exact: true }),
  ).toBeEnabled();
  const installed = await api("/installations");
  assert(
    installed.some(
      (item) => item.agentId === "codex-acp" && item.status === "installed",
    ),
  );
  await settings
    .getByRole("button", { name: "Installed", exact: true })
    .click();
  await expect(settings.locator(".acp-agent-card")).toHaveCount(1);
  reports.push(
    "Real Codex installation from one button persists in the isolated profile",
  );
  await settings.screenshot({ path: join(output, "registry-dark.png") });
  const nav = settings.getByRole("navigation", { name: "Settings sections" });
  await nav
    .locator(".settings-nav-label")
    .filter({ hasText: /^Appearance$/ })
    .click();
  await settings
    .getByRole("radio", { name: "Light theme", exact: true })
    .click();
  await nav
    .locator(".settings-nav-label")
    .filter({ hasText: /^External Agents$/ })
    .click();
  await settings
    .getByRole("button", { name: "Refresh agent catalog", exact: true })
    .waitFor({ state: "visible" });
  await expect(settings.locator(".acp-agent-card").first()).toBeVisible();
  await settings.screenshot({ path: join(output, "registry-light.png") });
  await (
    await app.browserWindow(settings)
  ).evaluate((win) => win.setSize(760, 700));
  assert(
    await settings
      .locator(".settings-workbench")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  await settings.screenshot({ path: join(output, "registry-narrow.png") });
  reports.push("Dark/light themes and narrow Settings layout");
  await settings.close();
  settings = null;
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, project);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("coloride:app-menu-action", {
        detail: "open-local-folder",
      }),
    ),
  );
  await expect(page.getByLabel("Workspace file tree")).toBeVisible();
  // Confirm the genuine Codex adapter starts without using or initiating login.
  const codex = await api("/sessions", {
    agentId: "codex-acp",
    workspacePath: project,
    executionTarget: "local",
  });
  assert.equal(codex.phase, "needs-login");
  assert(codex.authMethods.some((method) => method.id === "chat-gpt"));
  await api(`/sessions/${codex.id}/close`, {});
  reports.push(
    "Installed Codex initializes ACP and announces ChatGPT authentication",
  );
  // Install a fixture entry only into this isolated profile for real stdio prompts.
  const stateRoot = join(profile, "external-agents");
  const records = JSON.parse(
    await readFile(join(stateRoot, "installations.json"), "utf8"),
  );
  records.installations.push({
    id: "test-acp@1",
    agentId: "test-acp",
    name: "Test ACP",
    version: "1",
    distribution: "binary",
    status: "installed",
    executable: resolveTestPython(),
    args: [resolve("core/ide-host/tests/external_agents/fake_agent.py")],
    location: join(stateRoot, "packages/test-acp/1"),
  });
  await writeFile(
    join(stateRoot, "installations.json"),
    JSON.stringify(records),
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("coloride:external-agents-changed")),
  );
  // Open the full Agents screen; sidebar menus use the same installed entries.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("coloride:app-menu-action", { detail: "open-agents" }),
    ),
  );
  await page.getByRole("button", { name: "Add tab", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Codex", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Test ACP", exact: true }).click();
  const view = page.getByRole("region", {
    name: "Test ACP agent",
    exact: true,
  });
  await expect(view).toBeVisible();
  const opened = await page.evaluate((projectPath) => {
    const namespace = JSON.stringify(["local", projectPath, "full"]);
    return {
      id: JSON.parse(
        localStorage.getItem("coloride.external-agent.tabs.v1:" + namespace),
      ).selectedId,
    };
  }, project);
  await view.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(view.getByRole("button", { name: "Thinking", exact: true })).toContainText("Low");
  await view.getByRole("button", { name: "Thinking", exact: true }).click();
  await view.getByRole("menuitemradio", { name: "High", exact: true }).click();
  await expect(view.getByRole("button", { name: "Thinking", exact: true })).toContainText("High");
  await view
    .getByRole("textbox", { name: "Message Test ACP", exact: true })
    .fill("hello from the real UI");
  await view.getByRole("button", { name: "Send", exact: true }).click();
  await view.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(view.getByText("Edited README", { exact: true })).toBeVisible();
  assert.equal(
    await readFile(join(project, "README.md"), "utf8"),
    "Edited through ACP\n",
  );
  await expect(
    view.getByText("hello from the real UI", { exact: true }),
  ).toHaveCount(1);
  await expect(
    view.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(output, "external-conversation.png") });
  const snapshots = await api(`/sessions/${opened.id}/events`);
  assert(
    snapshots.some(
      (item) => item.update.sessionUpdate === "permission_resolved",
    ),
  );
  reports.push(
    "Real stdio ACP login, thinking, prompt, permission and file write through the production composer",
  );
  // Force a fresh process; replay must not duplicate stored messages.
  await api(`/sessions/${opened.id}/close`, {});
  await page.reload();
  await expect(
    page.getByText("hello from the real UI", { exact: true }),
  ).toHaveCount(1, { timeout: 60000 });
  await expect(page.getByText("Edited README", { exact: true })).toHaveCount(1);
  reports.push(
    "Lazy reconnection preserves the conversation without duplicate replay",
  );
  await app.close();
  app = null;
  assert.equal((await api(`/sessions/${opened.id}`)).phase, "closed");
  await launch();
  await expect(
    page.getByText("hello from the real UI", { exact: true }),
  ).toHaveCount(1, { timeout: 60000 });
  await expect(page.getByText("Edited README", { exact: true })).toHaveCount(1);
  await page
    .getByRole("button", { name: "Close test-acp tab", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Close test-acp tab", exact: true })).toHaveCount(0);
  assert.equal((await api(`/sessions/${opened.id}`)).phase, "closed");
  reports.push(
    "Installed + menu, selected tab, app restart and explicit tab closure preserve history and stop execution",
  );
  // Verify removing through Settings, and the unavailable-host recovery state.
  await openSettings();
  await settings.getByLabel("Search agents", { exact: true }).fill("Codex");
  await settings
    .getByRole("article", { name: "Codex", exact: true })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(
    settings
      .getByRole("article", { name: "Codex", exact: true })
      .getByRole("button", { name: "Install", exact: true }),
  ).toBeEnabled();
  await settings.route("**/api/external-agents/registry", (route) =>
    route.fulfill({ status: 404, json: { detail: "Not Found" } }),
  );
  await settings
    .getByRole("button", { name: "Refresh agent catalog", exact: true })
    .click();
  await expect(settings.getByRole("alert")).toContainText(
    "The running host needs an update.",
  );
  await expect(
    settings.getByRole("button", {
      name: "Restart host and close terminals",
      exact: true,
    }),
  ).toBeVisible();
  reports.push("Remove button and explicit recovery message for a stale host");
  assert.deepEqual(errors, []);
  console.log("PASS:", reports.join("; "));
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ status: "passed", checks: reports }, null, 2),
  );
} catch (error) {
  await settings
    ?.screenshot({ path: join(output, "failure-settings.png") })
    .catch(() => {});
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(
    await page
      ?.locator("body")
      .innerText()
      .catch(() => ""),
  );
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      { status: "failed", checks: reports, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  try {
    runtime ||= JSON.parse(
      await readFile(join(profile, "terminal-host.json"), "utf8"),
    );
    const parents = execFileSync(
      "/usr/sbin/lsof",
      ["-tiTCP:" + runtime.port, "-sTCP:LISTEN"],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .map(Number);
    const processes = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const owned = new Set(parents.filter((pid) => pid > 0));
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, parent] of processes)
        if (owned.has(parent) && !owned.has(pid)) {
          owned.add(pid);
          changed = true;
        }
    }
    for (const pid of [...owned].reverse()) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  } catch {}
  await rm(sandbox, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
