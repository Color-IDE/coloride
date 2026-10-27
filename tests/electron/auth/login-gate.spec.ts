import {
  test,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../../..");
let app: ElectronApplication,
  page: Page,
  vite: ChildProcess,
  sandbox: string,
  base: string;
const errors: string[] = [];

// Mock only the cloud session boundary; render the production LoginGate.
const mockAuth = `
const query = new URLSearchParams(location.search);
const remembered = {user:{id:"account",email:"test@example.com"},accessToken:"",pendingRefresh:true};
const session = query.get("session") === "none" ? null
  : query.get("session") === "valid" ? {...remembered,accessToken:"access-token",pendingRefresh:false}
  : remembered;
const listeners = new Set();
window.authGateTest = {
  session,
  emit(next) { this.session = next; for (const listener of listeners) listener(next); },
  native(next) { this.session = next; window.dispatchEvent(new CustomEvent("coloride:cloud-auth-changed",{detail:next})); },
};
export const getSessionSnapshot = () => window.authGateTest.session;
export const subscribeCloudAuth = (listener) => {
  listeners.add(listener);
  listener(getSessionSnapshot());
  return () => listeners.delete(listener);
};
export const bootstrapCloudAuth = () => query.get("bootstrap") === "hang"
  ? new Promise(() => {})
  : Promise.resolve(getSessionSnapshot());
export const startBrowserLinkLogin = () => { throw new Error("Sign-in was not requested"); };
`;

test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "coloride-login-gate-"));
  const port = await new Promise<number>((resolvePort) => {
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
  vite = spawn(
    process.execPath,
    [
      join(root, "client/ide/node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: join(root, "client/ide"), env, stdio: "ignore" },
  );
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${base}/tests/login-gate.html`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [join(root, "tests/electron/support/electron-main.cjs")],
    env: {
      ...env,
      COLORIDE_TEST_USER_DATA: join(sandbox, "user-data"),
      COLORIDE_TEST_URL: base + "/tests/login-gate.html?local=1&session=none",
      COLORIDE_TEST_CONFIG: JSON.stringify({
        cloudConfig: {
          enabled: true,
          appBase: "https://coloride.test",
          apiBase: "https://api.coloride.test",
        },
      }),
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/src/features/auth/cloudAuth.ts*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: mockAuth }),
  );
});

test.afterAll(async () => {
  await app?.close();
  vite?.kill("SIGTERM");
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

test.afterEach(() => expect(errors).toEqual([]));

test("a cached profile stays behind the cloud gate until a token arrives", async () => {
  await page.goto(base + "/tests/login-gate.html");
  await expect(
    page.getByLabel("Loading Coloride", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main", { name: "Workspace" })).toHaveCount(0);
  await page.evaluate(() =>
    (window as any).authGateTest.emit({
      user: { id: "account", email: "test@example.com" },
      accessToken: "access-token",
      pendingRefresh: false,
    }),
  );
  await expect(page.getByRole("main", { name: "Workspace" })).toBeVisible();
});

test("revocation goes from the splash to login without mounting the workspace", async () => {
  await page.goto(base + "/tests/login-gate.html");
  await expect(
    page.getByLabel("Loading Coloride", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).authGateTest.native(null));
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main", { name: "Workspace" })).toHaveCount(0);
});

test("a hung cloud bootstrap reaches login after the bounded splash", async () => {
  await page.goto(base + "/tests/login-gate.html?bootstrap=hang");
  await expect(
    page.getByLabel("Loading Coloride", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("main", { name: "Workspace" })).toHaveCount(0);
});

test("local editing stays available without an account or a cloud response", async () => {
  await page.goto(
    base + "/tests/login-gate.html?local=1&session=none&bootstrap=hang",
  );
  await expect(page.getByRole("main", { name: "Workspace" })).toBeVisible();
  await expect(
    page.getByLabel("Loading Coloride", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => (window as any).authGateTest.native(null));
  await expect(page.getByRole("main", { name: "Workspace" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toHaveCount(0);
});

test("a valid cached session opens immediately and logout returns to login", async () => {
  await page.goto(base + "/tests/login-gate.html?session=valid");
  await expect(page.getByRole("main", { name: "Workspace" })).toBeVisible();
  await page.evaluate(() => (window as any).authGateTest.emit(null));
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main", { name: "Workspace" })).toHaveCount(0);
});
