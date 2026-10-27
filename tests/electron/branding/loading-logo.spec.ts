import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../../..");
let sandbox: string, vite: ChildProcess, port: number;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "coloride-branding-"));
  const net = await import("node:net");
  port = await new Promise<number>(done => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const selected = (server.address() as any).port;
      server.close(() => done(selected));
    });
  });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  vite = spawn(process.execPath, [join(root, "client/ide/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: join(root, "client/ide"), env, stdio: "ignore" });
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/tests/branding.html`)).ok; } catch { return false; }
  }).toBe(true);
});

test.afterEach(async () => { await app?.close(); });
test.afterAll(async () => {
  vite?.kill("SIGTERM");
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

async function launch(url: string) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: require("electron"), args: [join(root, "tests/electron/support/electron-main.cjs")], env: {
    ...env, COLORIDE_TEST_USER_DATA: join(sandbox, `electron-${test.info().testId}`), COLORIDE_TEST_URL: url, COLORIDE_TEST_CONFIG: "{}",
  } });
  page = await app.firstWindow();
}

async function loaded(selector: string) {
  await expect.poll(() => page.locator(selector).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 539)).toBe(true);
}

// Sample the actual SVG image: a white shimmer could never satisfy this check.
async function colorfulPixels() {
  return page.locator('[data-testid="loading-mark"] img').evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement("canvas"); canvas.width = 180; canvas.height = 180;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0, 180, 180);
    const data = context.getImageData(0, 0, 180, 180).data;
    let colorful = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 200 && Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 25) colorful++;
    }
    return colorful;
  });
}

test("native splash loads the shared Coloride artwork", async () => {
  await launch(pathToFileURL(join(root, "client/desktop/src/splash.html")).href);
  await loaded(".mark img");
  await expect(page.locator(".mark img")).toHaveAttribute("src", "../resources/branding/coloride-loading.svg");
  await expect(page.locator(".mark path")).toHaveCount(0);
});

test("HTML first paint loads the same mark before React mounts", async () => {
  await launch(`http://127.0.0.1:${port}/tests/branding.html`);
  await page.route("**/src/main.tsx", route => route.abort());
  await page.goto(`http://127.0.0.1:${port}/`);
  await loaded(".coloride-boot-splash-mark img");
  await expect(page.locator(".coloride-boot-splash-mark img")).toHaveAttribute("src", /coloride-loading\.svg/);
});

test("React loading reveals original colors and reduced motion stays gray", async () => {
  await launch(`http://127.0.0.1:${port}/tests/branding.html`);
  await loaded('[data-testid="loading-mark"] img');
  await expect.poll(colorfulPixels, { timeout: 5_000 }).toBeGreaterThan(1_500);
  await page.screenshot({ path: join(root, "artifacts/branding/coloride-color-reveal.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await loaded('[data-testid="loading-mark"] img');
  await expect.poll(colorfulPixels).toBe(0);
  await page.waitForTimeout(300);
  expect(await colorfulPixels()).toBe(0);
  await page.screenshot({ path: join(root, "artifacts/branding/coloride-reduced-motion.png") });
});

test("saved light theme paints before React and the frosted overlay fades gradually", async () => {
  await launch(`http://127.0.0.1:${port}/tests/branding.html`);
  await page.addInitScript(() => localStorage.setItem("coloride.app-preferences.v1", JSON.stringify({ theme: "light" })));
  await page.route("**/src/main.tsx", route => route.abort());
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const overlay = page.locator(".coloride-boot-splash");
  await expect(overlay).toHaveCSS("background-color", "rgba(247, 248, 249, 0.2)");
  await expect(overlay).toHaveCSS("backdrop-filter", "blur(18px)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module during the integration test.
    const { installStartupTransition } = await import("/src/app/startup.ts");
    installStartupTransition();
    document.getElementById("root")!.innerHTML = '<main class="login-gate-app" style="height:100vh;background:repeating-linear-gradient(45deg,#ddd 0 20px,#aaa 20px 40px)">Ready</main>';
  });
  await expect.poll(() => overlay.evaluate(el => Number(getComputedStyle(el).opacity))).toBeLessThan(0.9);
  const midpoint = await overlay.evaluate(el => ({ opacity: Number(getComputedStyle(el).opacity), blur: Number.parseFloat(getComputedStyle(el).backdropFilter.replace("blur(", "")) }));
  expect(midpoint.opacity).toBeGreaterThan(0);
  // Only opacity animates; interpolating a full-window blur repaints every frame.
  expect(midpoint.blur).toBe(18);
  await page.screenshot({ path: join(root, "artifacts/branding/startup-light-transition.png") });
  await expect(overlay).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-startup");
});

test("native loading respects the light appearance", async () => {
  await launch(`${pathToFileURL(join(root, "client/desktop/src/splash.html")).href}?theme=light`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgba(247, 248, 249, 0.2)");
  await expect(page.locator(".mark img")).toHaveCSS("filter", "none");
});
