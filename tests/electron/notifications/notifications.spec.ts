import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
let app: ElectronApplication, page: Page, vite: ChildProcess, sandbox: string, url: string;
const errors: string[] = [];
test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "coloride-notifications-"));
  const port = await new Promise<number>(done => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
  url = `http://127.0.0.1:${port}/tests/notifications.html`;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  vite = spawn(process.execPath, [join(root, "client/ide/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: join(root, "client/ide"), env, stdio: "ignore" });
  await expect.poll(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
  app = await _electron.launch({ executablePath: require("electron"), args: [join(root, "tests/electron/support/electron-main.cjs")],
    env: { ...env, COLORIDE_TEST_USER_DATA: join(sandbox, "data"), COLORIDE_TEST_URL: url, COLORIDE_TEST_CONFIG: "{}" } });
  page = await app.firstWindow();
  page.on("pageerror", error => errors.push(error.message));
});
test.beforeEach(async () => { errors.length = 0; await page.goto(url); });
test.afterEach(() => expect(errors).toEqual([]));
test.afterAll(async () => { await app?.close(); vite?.kill("SIGTERM"); if (sandbox) await rm(sandbox, { recursive: true, force: true }); });

test("stack preserves queued notices, deduplicates ids and runs actions", async () => {
  await page.getByRole("button", { name: "Show examples" }).click();
  await expect(page.locator(".notification-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Add notification" }).click();
  await expect(page.getByText("1 more notification", { exact: true })).toBeVisible();
  await expect(page.locator(".notification-title").filter({ hasText: "Update available" })).toHaveCount(0);
  await page.getByRole("button", { name: "Replace saved" }).click();
  await expect(page.getByText("File saved again", { exact: true })).toBeVisible();
  await expect(page.locator(".notification-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.getByLabel("Action count")).toHaveText("1");
  await expect(page.getByText("Update available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss: Unable to save file", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.locator(".notification-card")).toHaveCount(0);
});

test("auto-dismiss pauses for hover and keyboard focus", async () => {
  await page.getByRole("button", { name: "Temporary", exact: true }).click();
  const card = page.locator(".notification-card");
  await card.hover();
  await page.waitForTimeout(750);
  await expect(card).toBeVisible();
  await card.getByRole("button").focus();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(750);
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Temporary", exact: true }).focus();
  await expect(card).toHaveCount(0);
});

test("replacements survive an old timer and failed actions remain retryable", async () => {
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this module in the running renderer.
    const { notify } = await import("/src/shared/ui/notifications.ts");
    notify({ id: "job", title: "Starting", duration: 200 });
    setTimeout(() => notify({ id: "job", title: "Still working", duration: 0 }), 100);
  });
  await expect(page.getByText("Still working", { exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  await expect(page.getByText("Still working", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this module in the running renderer.
    const { notify } = await import("/src/shared/ui/notifications.ts");
    notify({ id: "retry", title: "Connection unavailable", action: {
      label: "Try reconnecting", onClick: async () => { throw new Error("Server is offline"); },
    } });
  });
  await page.getByRole("button", { name: "Try reconnecting", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Server is offline");
  await expect(page.getByRole("alert").getByRole("button", { name: "Try reconnecting", exact: true })).toBeEnabled();
  await expect(page.locator(".notification-card")).toHaveCount(2);
});

test("bottom-right layout, narrow windows, themes and reduced motion", async () => {
  await page.getByRole("button", { name: "Show examples" }).click();
  for (const item of await page.locator(".notification-stack > li").all()) {
    await expect(item).toHaveCSS("opacity", "1");
  }
  await mkdir(resolve("artifacts/notifications"), { recursive: true });
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator(".notification-card").first()).toHaveCSS("background-color", theme === "dark" ? "rgb(48, 48, 48)" : "rgb(255, 255, 255)");
    await page.screenshot({ path: resolve(`artifacts/notifications/${theme}.png`) });
    await page.locator(".notification-viewport").screenshot({ path: resolve(`artifacts/notifications/${theme}-stack.png`) });
  }
  await (await app.browserWindow(page)).evaluate(win => win.setSize(340, 620));
  await expect.poll(() => page.locator(".notification-viewport").evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 11 && Math.abs(innerWidth - rect.right - 12) < 1 && Math.abs(innerHeight - rect.bottom - 46) < 1;
  })).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByRole("button", { name: "Add notification" }).click();
  await expect(page.getByText("Update available", { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve("artifacts/notifications/narrow.png") });
});
