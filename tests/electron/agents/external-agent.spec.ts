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
const modelOption = { id: "model", name: "Model", category: "model", type: "select", currentValue: "fixture-model", options: [{ value: "fixture-model", name: "Fixture model" }] };
const accessOption = { id: "mode", name: "Access", category: "mode", type: "select", currentValue: "default", options: [{ value: "read-only", name: "Read-only" }, { value: "default", name: "Auto review" }] };
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
          update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Analyze this project" } },
        }, {
          sessionId: "codex-1",
          sequence: 2,
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
          options: [modelOption, accessOption, { id: "thought", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }],
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
        configOptions: [modelOption, accessOption, { id: "thought", name: "Thinking", category: "thought_level", type: "select", currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }],
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
  const topInset = () => page.locator(".agent-user-message").first().evaluate((message) => {
    const timeline = message.closest(".agent-timeline")!;
    timeline.scrollTop = 0;
    return message.getBoundingClientRect().top - timeline.getBoundingClientRect().top;
  });
  await expect.poll(topInset).toBe(14);
  await page.locator("main").evaluate((element) => element.classList.add("agent-view-sidebar"));
  await expect.poll(topInset).toBe(2);
  await page.screenshot({ path: "artifacts/external-agent-top-inset.png" });
  await page.locator("main").evaluate((element) => element.classList.remove("agent-view-sidebar"));
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "Low", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "High", exact: true }).click();
  await expect.poll(() => configChanges).toEqual([{ configId: "thought", value: "high" }]);
  await expect(page.getByRole("menuitemradio", { name: "High", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.getByLabel("Message Codex").fill("Change thinking and edit the file");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Message Codex")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("ready Codex chat stays empty until the first message", async () => {
  let sent = false;
  await page.route(/\/api\/external-agents\/sessions\/[^/]+\/prompts$/, (route) => {
    sent = true;
    return route.fulfill({ status: 202, json: { accepted: true, sessionId: "codex-1", turnId: "turn-1" } });
  });
  await page.route(/\/api\/external-agents\/sessions\/[^/]+\/events(?:\?.*)?$/, (route) => route.fulfill({ json: sent ? [{ sessionId: "codex-1", sequence: 1, createdAt: "2026-10-29T00:00:00Z", update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Analyze the project" } } }] : [] }));
  await page.goto(base + "/tests/external-agent.html");
  await expect(page.getByLabel("Message Codex")).toBeEnabled();
  await page.locator("main").evaluate((element) => element.classList.add("agent-view-sidebar"));
  await page.evaluate(() => { document.body.dataset.theme = "light"; });
  const composerGeometry = () => page.locator(".agent-composer").evaluate((element) => {
    const view = element.closest(".external-agent-view")!.getBoundingClientRect();
    const card = element.getBoundingClientRect();
    const input = element.querySelector("textarea")!.getBoundingClientRect();
    return { left: card.left - view.left, right: view.right - card.right, top: card.top - view.top, bottom: view.bottom - card.bottom, inputHeight: input.height };
  });
  await expect.poll(composerGeometry).toMatchObject({ left: 6, right: 6, top: 2, inputHeight: 110 });
  await expect(page.getByText("Codex is ready in this project.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Access level", exact: true }).click();
  const menuDirection = () => page.getByText("Read-only", { exact: true }).evaluate((element) => {
    const trigger = document.querySelector('[aria-label="Access level"]')!;
    return element.getBoundingClientRect().top >= trigger.getBoundingClientRect().bottom;
  });
  await expect.poll(menuDirection).toBe(true);
  await expect.poll(composerGeometry).toMatchObject({ top: 2, inputHeight: 110 });
  await page.screenshot({ path: "artifacts/codex-empty-access-menu.png" });
  await page.keyboard.press("Escape");
  await page.getByLabel("Message Codex").fill("Analyze the project");
  await expect.poll(composerGeometry).toMatchObject({ top: 2, inputHeight: 110 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect.poll(composerGeometry).toMatchObject({ left: 6, right: 6, bottom: 6, inputHeight: 22 });
  await page.getByRole("button", { name: "Access level", exact: true }).click();
  await expect.poll(menuDirection).toBe(false);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "artifacts/codex-docked-composer.png" });
});

test("Codex uses native thinking, command and file rows", async () => {
  let running = true;
  let updates: Record<string, unknown>[] = [
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Inspect the project" } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Reviewing the project structure" } },
  ];
  await page.route(/\/api\/external-agents\/sessions\/codex-1$/, (route) => route.fulfill({ json: {
    id: "codex-1", title: "Codex", phase: "ready", turn: running ? "running" : "idle", configOptions: [], authMethods: [],
  } }));
  await page.route(/\/api\/external-agents\/sessions\/[^/]+\/events(?:\?.*)?$/, (route) => route.fulfill({ json: updates.map((update, i) => ({ sessionId: "codex-1", sequence: i + 1, createdAt: "2026-10-29T00:00:00Z", update })) }));
  await page.goto(base + "/tests/external-agent.html");
  await page.locator("main").evaluate((element) => element.classList.add("agent-view-sidebar"));
  await expect(page.locator(".agent-thinking.is-running")).toContainText("Thinking");
  updates = [updates[0]!];
  await page.reload();
  await expect(page.locator(".agent-thinking.is-running")).toContainText("Thinking");
  running = false;
  updates.push(
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Reviewing the project structure" } },
    { sessionUpdate: "tool_call", toolCallId: "exec-1", kind: "execute", title: "pwd && ls", rawInput: { command: "pwd && ls" }, content: [{ type: "terminal", terminalId: "exec-1" }] },
    { sessionUpdate: "tool_call_update", toolCallId: "exec-1", title: "Ran command pwd", status: "completed" },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Checking files next." } },
    { sessionUpdate: "tool_call", toolCallId: "list-1", kind: "read", title: "List files", status: "completed" },
    { sessionUpdate: "turn_complete" },
  );
  await page.reload();
  await page.locator("main").evaluate((element) => element.classList.add("agent-view-sidebar"));
  await page.evaluate(() => { document.body.dataset.theme = "light"; });
  await expect(page.locator(".agent-thinking-toggle").first()).toContainText("Thought");
  await expect(page.locator(".agent-tool-row.is-command")).toContainText("pwd && ls");
  await expect(page.getByText('"terminalId"', { exact: false })).toHaveCount(0);
  await expect(page.locator(".agent-list-files-row")).toBeVisible();
  const aligned = await page.locator(".agent-turn-body").evaluate((body) => {
    const left = body.getBoundingClientRect().left;
    return [...body.querySelectorAll(".agent-thinking, .agent-tool-row")].every((row) => Math.abs(row.getBoundingClientRect().left - left) <= 1);
  });
  expect(aligned).toBe(true);
  await page.screenshot({ path: "artifacts/codex-native-tools.png" });
});

test("intermediate replies keep activity visible and edits/reviews use native presentation", async () => {
  let running = true;
  const updates: Record<string, unknown>[] = [
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Build the page" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "I will create the page and styles." } },
  ];
  await page.route(/\/api\/external-agents\/sessions\/codex-1$/, (route) => route.fulfill({ json: {
    id: "codex-1", title: "Codex", phase: "ready", turn: running ? "running" : "idle", configOptions: [], authMethods: [],
  } }));
  await page.route(/\/api\/external-agents\/sessions\/[^/]+\/events(?:\?.*)?$/, (route) => route.fulfill({ json: updates.map((update, i) => ({ sessionId: "codex-1", sequence: i + 1, createdAt: "2026-10-29T00:00:00Z", update })) }));
  const open = async () => {
    await page.goto(base + "/tests/external-agent.html");
    await page.locator("main").evaluate(element => element.classList.add("agent-view-sidebar"));
    await page.evaluate(() => { document.body.dataset.theme = "light"; });
  };
  await open();
  await expect(page.locator(".agent-thinking.is-running")).toContainText("Thinking");
  updates.push({ sessionUpdate: "tool_call", toolCallId: "edit-1", kind: "edit", title: "Editing files", status: "in_progress", content: [
    { type: "diff", path: "/fixture/index.html", oldText: null, newText: "<main>Hello</main>\n" },
    { type: "diff", path: "/fixture/styles.css", oldText: "a { color: red; }\n", newText: "a { color: blue; }\n" },
  ] });
  await open();
  await expect(page.locator(".agent-edit-card.is-running")).toHaveCount(2);
  await expect(page.locator(".agent-edit-card").first()).toContainText("index.html");
  await expect(page.locator(".agent-edit-card").first()).toContainText("<main>Hello</main>");
  updates.push(
    { sessionUpdate: "tool_call_update", toolCallId: "edit-1", status: "completed" },
    { sessionUpdate: "tool_call", toolCallId: "guardian_assessment:review-1", kind: "think", title: "Guardian Review", status: "in_progress", content: [{ type: "content", content: { type: "text", text: "Status: In progress" } }] },
  );
  await open();
  await expect(page.locator(".agent-review-row.is-running")).toBeVisible();
  updates.push(
    { sessionUpdate: "tool_call_update", toolCallId: "guardian_assessment:review-1", status: "completed", content: [{ type: "content", content: { type: "text", text: "Status: Approved\nRisk: low\nRationale: Preview requested by the user" } }] },
    { sessionUpdate: "turn_complete" },
  );
  running = false;
  await open();
  await expect(page.locator(".agent-edit-card")).toHaveCount(2);
  await expect(page.locator(".agent-edit-card").first()).toContainText("+1");
  await expect(page.locator(".agent-review-row")).toContainText("Approved");
  const review = page.locator(".agent-review-row .agent-thinking-toggle");
  await expect(review).toHaveAttribute("aria-expanded", "false");
  await review.click();
  await expect(page.getByText("Status: Approved", { exact: false })).toBeVisible();
  await expect(page.getByText("Rationale: Preview requested by the user", { exact: false })).toBeVisible();
  await expect.poll(() => page.locator(".agent-review-row .agent-thinking-detail").evaluate(element => element.closest(".agent-collapse")!.getBoundingClientRect().height >= element.scrollHeight - 1)).toBe(true);
  await page.screenshot({ path: "artifacts/codex-native-edits-review.png" });
});

test("command expansion streams terminal output and restores it from history", async () => {
  let running = true;
  const updates: Record<string, unknown>[] = [
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "List project files" } },
    { sessionUpdate: "tool_call", toolCallId: "exec-output", kind: "execute", title: "pwd && ls", status: "in_progress", rawInput: { command: "pwd && ls" }, content: [{ type: "terminal", terminalId: "exec-output" }] },
  ];
  await page.route(/\/api\/external-agents\/sessions\/codex-1$/, (route) => route.fulfill({ json: {
    id: "codex-1", title: "Codex", phase: "ready", turn: running ? "running" : "idle", configOptions: [], authMethods: [],
  } }));
  await page.route(/\/api\/external-agents\/sessions\/[^/]+\/events(?:\?.*)?$/, (route) => route.fulfill({ json: updates.map((update, i) => ({ sessionId: "codex-1", sequence: i + 1, createdAt: "2026-10-29T00:00:00Z", update })) }));
  await page.goto(base + "/tests/external-agent.html");
  const command = page.locator(".agent-tool-row.is-command").first();
  await command.locator(".agent-tool-header").click();
  await expect(command).toContainText("Waiting for command output…");
  updates.push(
    { sessionUpdate: "tool_call_update", toolCallId: "exec-output", _meta: { terminal_output_delta: { terminal_id: "exec-output", data: "/fixture\n" } } },
    { sessionUpdate: "tool_call_update", toolCallId: "exec-output", _meta: { terminal_output_delta: { terminal_id: "exec-output", data: "index.html\n" } } },
  );
  await expect(command.locator(".agent-terminal-output")).toHaveText("/fixture\nindex.html\n");
  updates.push(
    { sessionUpdate: "tool_call_update", toolCallId: "exec-output", status: "failed", _meta: { terminal_exit: { terminal_id: "exec-output", exit_code: 130 } } },
    { sessionUpdate: "tool_call", toolCallId: "exec-empty", kind: "execute", title: "true", rawInput: { command: "true" }, status: "completed" },
    { sessionUpdate: "tool_call", toolCallId: "exec-failed", kind: "execute", title: "npm run dev", rawInput: { command: "npm run dev" }, status: "failed", _meta: { terminal_output_delta: { terminal_id: "exec-failed", data: "Error: listen EPERM: operation not permitted 127.0.0.1:5173\n" }, terminal_exit: { terminal_id: "exec-failed", exit_code: 1 } } },
    { sessionUpdate: "turn_complete" },
  );
  running = false;
  await expect(page.locator(".agent-tool-row.is-command")).toHaveCount(3);
  await page.reload();
  await command.locator(".agent-tool-header").click();
  await expect(command.locator(".agent-terminal-output")).toHaveText("/fixture\nindex.html\n");
  await expect(command).toContainText("Stopped command");
  await expect(command).toContainText("Exit code 130");
  await expect(command).not.toHaveClass(/is-failed/);
  const failure = page.locator(".agent-tool-row.is-command").last();
  await failure.locator(".agent-tool-header").click();
  await expect(failure).toHaveClass(/is-failed/);
  await expect(failure).toContainText("listen EPERM");
  await expect(failure).toContainText("Exit code 1");
  const empty = page.locator(".agent-tool-row.is-command").nth(1);
  await empty.locator(".agent-tool-header").click();
  await expect(empty).toContainText("Command finished without output.");
});

test("Codex accepts image-only prompts from picker, paste and drop, retaining failed drafts", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const sent: Array<{ text: string; images: Array<{ data: string; mimeType: string; name: string }> }> = [];
  let accepted = false;
  let supportsImages = true;
  await page.route(/\/api\/external-agents\/sessions\/codex-1$/, route => route.fulfill({ json: {
    id: "codex-1", title: "Codex", phase: "ready", turn: accepted ? "running" : "idle", supportsImages, configOptions: [modelOption], authMethods: [],
  } }));
  await page.route(/\/api\/external-agents\/sessions\/[^/]+\/events(?:\?.*)?$/, route => route.fulfill({ json: accepted ? sent.at(-1)!.images.map((image, i) => ({ sessionId: "codex-1", sequence: i + 1, createdAt: "2026-10-29T00:00:00Z", update: { sessionUpdate: "user_message_chunk", content: { type: "image", ...image } } })) : [] }));
  await page.route(/\/api\/external-agents\/sessions\/[^/]+\/prompts$/, route => {
    sent.push(route.request().postDataJSON());
    accepted = sent.length > 1;
    return route.fulfill({ status: accepted ? 202 : 503, json: accepted ? { accepted: true, sessionId: "codex-1", turnId: "image-turn" } : { message: "Try again" } });
  });
  await page.goto(base + "/tests/external-agent.html");
  await page.getByRole("button", { name: "Choose mode", exact: true }).click();
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Add images", exact: true }).click();
  await (await picker).setFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.getByRole("button", { name: "Remove reference.png", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove reference.png", exact: true }).click();
  await page.getByLabel("Message Codex").evaluate((input, data) => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, png);
  await page.locator(".agent-composer").evaluate((surface, data) => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    surface.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
  }, png);
  await expect(page.getByRole("list", { name: "Attached files", exact: true }).getByRole("listitem")).toHaveCount(2);
  await page.locator("main").evaluate(element => element.classList.add("agent-view-sidebar"));
  await page.evaluate(() => { document.body.dataset.theme = "light"; });
  await page.screenshot({ path: "artifacts/codex-image-attachments.png" });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Remove pasted.png", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]?.text).toBe("");
  expect(sent[1]?.images.map(image => [image.name, image.mimeType, image.data])).toEqual([["pasted.png", "image/png", png], ["dropped.png", "image/png", png]]);
  await expect(page.getByRole("button", { name: "Remove pasted.png", exact: true })).toHaveCount(0);
  await expect(page.locator(".agent-user-attachments img")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".agent-user-attachments img")).toHaveCount(2);
  await expect.poll(() => page.locator(".agent-user-attachments img").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  accepted = false;
  supportsImages = false;
  await page.reload();
  await expect(page.getByLabel("Message Codex")).toBeEnabled();
  await page.getByRole("button", { name: "Choose mode", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Add images", exact: true })).toHaveCount(0);
});
