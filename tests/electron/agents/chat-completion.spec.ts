import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../../..");
let app: ElectronApplication, page: Page, vite: ChildProcess, sandbox: string;
const errors: string[] = [];

test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "coloride-chat-"));
  const net = await import("node:net");
  const port = await new Promise<number>((res) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const n = (server.address() as any).port;
      server.close(() => res(n));
    });
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  vite = spawn(
    process.execPath,
    [join(root, "client/ide/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: join(root, "client/ide"), env, stdio: "ignore" }
  );
  await expect.poll(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/tests/chat-completion.html`)).ok;
      } catch {
        return false;
      }
    },
    { timeout: 30000 }
  ).toBe(true);
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [join(root, "tests/electron/support/electron-main.cjs")],
    env: {
      ...env,
      COLORIDE_TEST_USER_DATA: join(sandbox, "data"),
      COLORIDE_TEST_URL: `http://127.0.0.1:${port}/tests/chat-completion.html`,
      COLORIDE_TEST_CONFIG: "{}",
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator("h2")).toContainText("Chat Completion & Availability Harness");
});

test.afterAll(async () => {
  await app?.close();
  vite?.kill("SIGTERM");
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

test("composer placeholder and submit reflect provider availability states", async () => {
  const input = page.locator('[data-testid="composer-input"]');
  const errorMsg = page.locator('[data-testid="error-message"]');

  // 1. Loading
  await page.locator('[data-testid="btn-avail-loading"]').click();
  await expect(input).toHaveAttribute("placeholder", "Checking model availability…");
  await page.locator('[data-testid="btn-submit"]').click();
  await expect(errorMsg).toContainText("Checking model availability");

  // 2. Missing credentials
  await page.locator('[data-testid="btn-avail-missing_credentials"]').click();
  await expect(input).toHaveAttribute("placeholder", "Configure API key to start");
  await page.locator('[data-testid="btn-submit"]').click();
  await expect(errorMsg).toContainText("Configure an OpenAI API key");

  // 3. Auth expired
  await page.locator('[data-testid="btn-avail-auth_expired"]').click();
  await expect(input).toHaveAttribute("placeholder", "Sign in to resume agent");
  await page.locator('[data-testid="btn-submit"]').click();
  await expect(errorMsg).toContainText("Your Coloride session has expired");

  // 4. Incompatible (model without tools in Act mode)
  await page.locator('[data-testid="btn-avail-incompatible"]').click();
  await expect(input).toHaveAttribute("placeholder", "Model does not support tools for Act mode");
  await page.locator('[data-testid="btn-submit"]').click();
  await expect(errorMsg).toContainText("does not support tools for autonomous implementation");

  // 5. Connection error
  await page.locator('[data-testid="btn-avail-connection_error"]').click();
  await expect(input).toHaveAttribute("placeholder", "Connection error — verify provider");
  await page.locator('[data-testid="btn-submit"]').click();
  await expect(errorMsg).toContainText("Could not connect to OpenAI");

  // 6. Available
  await page.locator('[data-testid="btn-avail-available"]').click();
  await expect(input).toHaveAttribute("placeholder", "Ask Coloride to build, inspect, or fix something");

  expect(errors).toEqual([]);
});

test("configuration renewal race prevention: stale responses do not overwrite newer user selection", async () => {
  await page.locator('[data-testid="btn-race"]').click();
  // Wait for both async timeouts (30ms and 150ms) to complete
  await page.waitForTimeout(250);
  const activeModel = page.locator('[data-testid="active-model"]');
  // Stale model-A-late must NOT overwrite model-B-fast
  await expect(activeModel).toHaveText("model-B-fast");
  expect(errors).toEqual([]);
});

test("recovery simulation preserves events without duplicate tool calls or edits", async () => {
  await page.locator('[data-testid="btn-run-recovery"]').click();

  const toolCount = page.locator('[data-testid="timeline-tool-count"]');
  await expect(toolCount).toHaveText("Tool Calls: 2");

  const outcome = page.locator('[data-testid="task-outcome-display"]');
  await expect(outcome).toHaveText("Outcome: completed");

  // Verify recovery event exists
  const recoveryEvt = page.locator('[data-testid="event-task_recovery"]');
  await expect(recoveryEvt).toBeVisible();

  expect(errors).toEqual([]);
});

test("user stop immediately clears queued follow-ups and prevents continuations", async () => {
  await page.locator('[data-testid="btn-test-stop"]').click();

  const queued = page.locator('[data-testid="queued-count"]');
  await expect(queued).toHaveText("0");

  const stopped = page.locator('[data-testid="stopped-status"]');
  await expect(stopped).toHaveText("stopped");

  expect(errors).toEqual([]);
});

test("completion proposals stay hidden until the authoritative summary arrives", async () => {
  await page.locator('[data-testid="btn-test-complete-task"]').click();

  const toolCount = page.locator('[data-testid="complete-task-tool-count"]');
  await expect(toolCount).toHaveText("0");

  const assistantText = page.locator('[data-testid="complete-task-assistant-text"]');
  await expect(assistantText).toHaveText("");
  await page.locator('[data-testid="btn-accept-complete-task"]').click();
  await expect(assistantText).toHaveText("Resolved the build issue and verified tests pass clean.");

  expect(errors).toEqual([]);
});


test("folder review dots clear for missing files and stay for valid collapsed descendants", async () => {
  const tree = page.getByTestId("review-tree");
  const dots = tree.locator(".filetree-agent-review-dot");
  await page.getByTestId("review-seed").click();
  await expect(dots).toHaveCount(2); // workspace + collapsed src
  await page.getByTestId("review-refresh").click();
  await expect(dots).toHaveCount(0);
  await page.getByTestId("review-current").click();
  await expect(dots).toHaveCount(2);
  await page.getByTestId("review-refresh").click();
  await expect(dots).toHaveCount(2);
  await page.getByTestId("review-accept").click();
  await expect(dots).toHaveCount(0);
  expect(errors).toEqual([]);
});
