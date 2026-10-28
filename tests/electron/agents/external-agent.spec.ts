import { expect, test, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
let app: ElectronApplication;
let page: Page;
let vite: ChildProcess;
let sandbox = "";
let base = "";
const errors: string[] = [];
const configChanges: Array<{ configId: string; value: string | boolean }> = [];

test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "coloride-codex-acp-"));
  const port = await new Promise<number>((resolvePort) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const chosen = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(chosen));
    });
  });
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  vite = spawn(process.execPath, [join(root, "client/ide/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: join(root, "client/ide"),
    env,
    stdio: "ignore",
  });
  await expect.poll(async () => {
    try { return (await fetch(base + "/tests/external-agent.html")).ok; } catch { return false; }
  }, { timeout: 30_000 }).toBe(true);
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [join(root, "tests/electron/support/electron-main.cjs")],
    env: {
      ...env,
      COLORIDE_TEST_USER_DATA: sandbox,
      COLORIDE_TEST_URL: "about:blank",
      COLORIDE_TEST_CONFIG: JSON.stringify({ port, token: "test-token", host: "127.0.0.1" }),
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^http:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path.endsWith("/events")) {
      return route.fulfill({
        headers,
        json: [{
          sessionId: "codex-1",
          sequence: 1,
          createdAt: "2026-10-29T00:00:00Z",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Recovered Codex reply" } },
        }],
      });
    }
    if (path.endsWith("/config") && request.method() === "PATCH") {
      configChanges.push(request.postDataJSON());
      return route.fulfill({
        headers,
        json: {
          sessionId: "codex-1",
          pending: {},
          options: [{ id: "thought", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }],
        },
      });
    }
    if (path.endsWith("/prompts")) return route.fulfill({ status: 202, headers, json: { accepted: true, sessionId: "codex-1", turnId: "turn-1" } });
    if (path.endsWith("/cancel") || path.endsWith("/close")) return route.fulfill({ headers, json: { ok: true } });
    return route.fulfill({
      headers,
      json: {
        id: "codex-1",
        agentId: "codex-acp",
        installationVersion: "2.3.0",
        acpSessionId: "acp-1",
        workspacePath: "/fixture/project",
        executionTarget: "local",
        installationId: "codex-acp@2.3.0",
        title: "Codex",
        phase: "ready",
        turn: "idle",
        processId: null,
        supportsLoad: true,
        authMethods: [{ id: "codex-login", name: "Sign in", type: "agent" }],
        configOptions: [{ id: "thought", name: "Thinking", category: "thought_level", type: "select", currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }],
        updatedAt: "2026-10-29T00:00:00Z",
      },
    });
  });
});

test.afterAll(async () => {
  await app?.close();
  vite?.kill("SIGTERM");
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

test("restored Codex conversation sends through the external composer", async () => {
  await page.goto(base + "/tests/external-agent.html");
  await expect(page.getByLabel("Codex conversation")).toContainText("Recovered Codex reply");
  await expect(page.getByLabel("Thinking")).toHaveValue("low");
  await page.getByLabel("Thinking").selectOption("high");
  await page.getByLabel("Message").fill("Change thinking and edit the file");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Message")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  expect(errors).toEqual([]);
});
