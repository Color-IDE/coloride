import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
let app: ElectronApplication, page: Page, vite: ChildProcess, sandbox: string, base: string;
const errors: string[] = [];
let tokenWrites = 0, configReads = 0;
let restoredProviderFailure = false;
const config = {
  provider: "xai", model: "grok-4.5", configured: true, availability: "available",
  credentialSource: "user", managedLlm: false, capabilities: { tools: true },
};
const mockCloud = `
export * from "/src/features/auth/cloud/session.ts";
export * from "/src/features/auth/cloud/payload.ts";
export { CloudAuthHttpError } from "/src/features/auth/cloud/errors.ts";
window.agentRestoreTest = {pending: []};
export const getValidAccessToken = () => new Promise(resolve => window.agentRestoreTest.pending.push(resolve));
`;

test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "coloride-agent-restore-"));
  const port = await new Promise<number>(resolvePort => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  vite = spawn(process.execPath,
    [join(root, "client/ide/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: join(root, "client/ide"), env, stdio: "ignore" });
  await expect.poll(async () => {
    try { return (await fetch(base + "/tests/agent-restore.html")).ok; } catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  app = await _electron.launch({ executablePath: require("electron"),
    args: [join(root, "tests/electron/support/electron-main.cjs")],
    env: { ...env, COLORIDE_TEST_USER_DATA: join(sandbox, "user-data"),
      COLORIDE_TEST_URL: "about:blank", COLORIDE_TEST_CONFIG: "{}" } });
  page = await app.firstWindow();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/src/features/auth/cloudAuth.ts*", route =>
    route.fulfill({ contentType: "application/javascript", body: mockCloud }));
  await page.route(/^http:\/\/[^/]+\/api\//, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let json: unknown = [];
    if (path === "/api/agents/config") {
      configReads++;
      json = request.method() === "PUT"
        ? { ...config, ...request.postDataJSON(), configured: false, availability: "missing_credentials" }
        : config;
    }
    else if (path === "/api/cloud-auth/agent-token") { tokenWrites++; json = { ok: true }; }
    else if (path === "/api/agents/sessions") json = [{ sessionId: "restored", task: "Local task", agent: "coloride",
      mode: "ask", state: "idle", cwd: "/fixture/project", workspaceKind: "local", filesystemScope: "workspace",
      startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", spentUsd: 0,
      ...(restoredProviderFailure ? { guardPause: { reason: "provider-errors", message: "Provider is temporarily unavailable" } } : {}),
    }];
    else if (path.endsWith("/events")) json = [{ id: "message", sessionId: "restored", sequence: 1,
      type: "user_message", data: { text: "Restored local conversation" }, createdAt: "2026-01-01T00:00:00Z" }];
    else if (path.endsWith("/plan")) json = null;
    await route.fulfill({ headers, json });
  });
});

test.afterAll(async () => {
  await app?.close();
  vite?.kill("SIGTERM");
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

test.afterEach(() => expect(errors).toEqual([]));

test("local conversation and composer restore while cloud refresh stays pending", async () => {
  await page.goto(base + "/tests/agent-restore.html");
  await expect.poll(() => page.evaluate(() => (window as any).agentRestoreTest?.pending.length ?? 0)).toBeGreaterThan(0);
  const restoredMessage = page.locator(".agent-user-message-text").filter({ hasText: "Restored local conversation" });
  await expect(restoredMessage).toBeVisible();
  const composer = page.locator("textarea.agent-composer-input");
  await expect(composer).toBeEnabled();
  await composer.fill("Continue this local conversation");
  await expect(composer).toHaveValue("Continue this local conversation");
  expect(tokenWrites).toBe(0);
  expect(configReads).toBe(1);
  expect(errors).toEqual([]);

  // The independent provider hook must still refresh availability when auth recovers.
  await page.evaluate(() => {
    for (const resolve of (window as any).agentRestoreTest.pending.splice(0)) resolve("renewed-token");
  });
  await expect.poll(() => tokenWrites).toBeGreaterThan(0);
  await expect.poll(() => configReads).toBeGreaterThan(1);
  await expect(composer).toHaveValue("Continue this local conversation");
  await expect(restoredMessage).toBeVisible();
  expect(errors).toEqual([]);
});

test("agent configuration errors use shared notifications instead of the composer banner", async () => {
  await page.goto(base + "/tests/agent-restore.html");
  await expect(page.locator(".agent-composer-model-trigger")).toContainText("Grok 4.5");
  const selectGemini = async () => {
    await page.locator(".agent-composer-model-trigger").click();
    await page.getByRole("menuitem", { name: /Grok 4.5|Gemini 3.8 Flash/ }).click();
    await page.getByRole("menuitemradio", { name: "Gemini 3.8 Flash", exact: true }).click();
  };
  await selectGemini();
  const notices = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notices.getByRole("alert")).toContainText("Configure a Gemini API key");
  await expect(page.locator(".agent-error, .agent-composer-retry-error")).toHaveCount(0);
  await expect(notices.locator(".notification-card")).toHaveCount(1);
  await notices.getByRole("button", { name: "Dismiss: Agent", exact: true }).click();
  await expect(notices.locator(".notification-card")).toHaveCount(0);
  await selectGemini();
  await expect(notices.getByRole("alert")).toContainText("Gemini 3.8 Flash");
  await expect(notices.locator(".notification-card")).toHaveCount(1);
  await expect(notices.locator("li")).toHaveCSS("opacity", "1");
  await mkdir(resolve("artifacts/agent-notifications"), { recursive: true });
  await page.screenshot({ path: resolve("artifacts/agent-notifications/provider-error.png") });
});

test("restored provider failures keep the retry draft and show one shared notice", async () => {
  restoredProviderFailure = true;
  await page.goto(base + "/tests/agent-restore.html");
  const notices = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notices.getByRole("alert")).toContainText("Provider is temporarily unavailable");
  await expect(page.locator("textarea.agent-composer-input")).toHaveValue("Restored local conversation");
  await expect(page.locator(".agent-composer-retry-error")).toHaveCount(0);
  await expect(notices.locator(".notification-card")).toHaveCount(1);
  restoredProviderFailure = false;
});

test("an unconfigured model keeps an empty sidebar composer in place", async () => {
  await page.route(/^http:\/\/[^/]+\/api\/agents\/sessions(?:\?.*)?$/, route =>
    route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: [] }));
  await page.goto(base + "/tests/agent-restore.html");
  await expect(page.locator(".agent-chat-column.is-empty-chat")).toBeVisible();
  const input = page.locator("textarea.agent-composer-input");
  await input.fill("Keep this draft");
  const geometry = () => input.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const before = await geometry();
  await page.locator(".agent-composer-model-trigger").click();
  await page.locator(".agent-model-submenu-trigger").click();
  await page.getByRole("menuitemradio", { name: "Gemini 3.8 Flash", exact: true }).click();
  const notice = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notice).toContainText("Configure a Gemini API key");
  const after = await geometry();
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
  await expect(input).toHaveValue("Keep this draft");
  await notice.getByRole("button", { name: "Dismiss: Agent", exact: true }).click();
  await expect(notice.locator(".notification-card")).toHaveCount(0);
  expect((await geometry()).y).toBeCloseTo(before.y, 0);
});
