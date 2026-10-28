import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {resolveTestPython} = require("../support/python.cjs");
const root = resolve(import.meta.dirname, "../../..");
let sandbox: string, sidecar: ChildProcess, vite: ChildProcess, runtime: any, vitePort: number;
let app: ElectronApplication, page: Page;
const errors: string[] = [];
const cleanEnv = () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  return env as Record<string, string>;
};
async function waitFor(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function launch(session: string, renderer?: "webgl") {
  app = await _electron.launch({ executablePath: require("electron"),
    args: [join(root, "tests/electron/support/electron-main.cjs")],
    env: { ...cleanEnv(), COLORIDE_TEST_USER_DATA: join(sandbox, "electron"),
      COLORIDE_TEST_CONFIG: JSON.stringify(runtime),
      COLORIDE_TEST_URL: `http://127.0.0.1:${vitePort}/tests/terminal.html?cwd=${encodeURIComponent(sandbox)}&session=terminal-${session}&renderer=${renderer ?? "default"}` },
  });
  page = await app.firstWindow();
  page.on("pageerror", e => errors.push(e.message));
  await expect(page.locator("[data-terminal-status]")).toHaveAttribute("data-terminal-status", "ready");
}
async function text() {
  return page.evaluate(() => {
    const term = (window as any).terminalUnderTest;
    const b = term.buffer.active;
    return Array.from({length: b.length}, (_, i) => b.getLine(i)?.translateToString(true) ?? "").join("\n");
  });
}
async function command(command: string, marker: string) {
  await page.locator(".xterm-helper-textarea").focus();
  // Real key input, not term.write: the bytes must travel through the PTY.
  await page.keyboard.insertText(command);
  await page.keyboard.press("Enter");
  await expect.poll(text).toContain(marker);
}
async function terminals() {
  return (await fetch(`http://${runtime.host}:${runtime.port}/api/term`, { headers: { Authorization: `Bearer ${runtime.token}` } })).json();
}

test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "coloride-terminal-"));
  await mkdir(join(sandbox, "home"));
  const launchFile = join(sandbox, "host.json");
  const binary = process.env.COLORIDE_TEST_SIDECAR_BINARY;
  const python = binary ?? resolveTestPython();
  sidecar = spawn(python, [...(binary ? [] : ["-m", "coloride_desktop.sidecar"]), "--no-frontend", "--launch-file", launchFile], {
    cwd: root, env: { ...cleanEnv(), HOME: join(sandbox, "home"), PYTHONPATH: join(root, "core/ide-host/src"),
      COLORIDE_TERMINAL_STATE_DIR: join(sandbox, "sessions"), COLORIDE_MANAGED_LLM: "0", SHELL: process.env.COLORIDE_TEST_SHELL ?? "/bin/zsh" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  sidecar.stderr?.on("data", data => { if (process.env.COLORIDE_TEST_VERBOSE) process.stderr.write(data); });
  await waitFor(async () => { try { runtime = JSON.parse(await readFile(launchFile, "utf8")); return true; } catch { return false; } }, "isolated host discovery");
  await waitFor(async () => { try { return (await fetch(`http://${runtime.host}:${runtime.port}/api/health`, { headers: { Authorization: `Bearer ${runtime.token}` } })).ok; } catch { return false; } }, "isolated host health");
  const net = await import("node:net");
  vitePort = await new Promise<number>(res => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = (server.address() as any).port; server.close(() => res(port)); }); });
  vite = spawn(process.execPath, [join(root, "client/ide/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: join(root, "client/ide"), env: cleanEnv(), stdio: "ignore" });
  await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${vitePort}/tests/terminal.html`)).ok; } catch { return false; } }, "test Vite server");
});
test.afterAll(async () => {
  await app?.close().catch(() => {});
  if (runtime) for (const t of await terminals()) await fetch(`http://${runtime.host}:${runtime.port}/api/term/${t.termId}/close`, { method: "POST", headers: { Authorization: `Bearer ${runtime.token}` } });
  sidecar?.kill("SIGTERM"); vite?.kill("SIGTERM");
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && page && !page.isClosed()) {
    await page.screenshot({path: info.outputPath("terminal.png")}).catch(() => {});
  }
  expect(errors.splice(0)).toEqual([]);
  await app?.close().catch(() => {});
});

test("PTY input, signals, repeated paste and geometry", async () => {
  await launch("input");
  await command("printf '\\nHELLO_%s\\n' '世界'", "HELLO_世界");
  await command("printf '\\nPID_%s\\n' $$", "PID_");
  // Two deliberate identical pastes must not be deduplicated by a time window.
  await app.evaluate(({clipboard}) => clipboard.writeText("printf '\\nPASTE_%s\\n' OK"));
  await page.getByText("Paste", {exact: true}).click();
  await page.keyboard.press("Enter");
  await page.getByText("Paste", {exact: true}).click();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await text()).match(/^PASTE_OK$/gm)?.length ?? 0).toBe(2);
  await command("sh -c 'printf \"RUNNING_%s\\n\" JOB; exec sleep 30'", "RUNNING_JOB");
  await page.keyboard.press("Control+c");
  await command("printf '\\nAFTER_%s\\n' SIGNAL", "AFTER_SIGNAL");
  for (const [width,height] of [[800,500],[1200,800],[900,600],[1100,700]]) await app.browserWindow(page).then(w => w.evaluate((win, size) => win.setSize(size[0],size[1]), [width,height]));
  await page.getByText("Zoom in", {exact: true}).click();
  await command("printf '\\nSIZE_%s\\n' \"$(stty size)\"", "SIZE_");
  await expect.poll(async () => {
    const lines = await text();
    const match = [...lines.matchAll(/SIZE_(\d+) (\d+)/g)].at(-1);
    const size = await page.evaluate(() => { const t = (window as any).terminalUnderTest; return [t.rows, t.cols]; });
    return Boolean(match && Number(match[1]) === size[0] && Number(match[2]) === size[1]);
  }).toBe(true);
  await expect.poll(async () => page.evaluate(async () => {
    const t = (window as any).terminalUnderTest;
    return t.cols > 20 && t.rows > 5;
  })).toBe(true);
});

test("50,000 lines remain ordered; scroll, selection and visibility", async () => {
  test.setTimeout(180_000);
  await launch("output");
  await page.evaluate(() => {
    (window as any).terminalUnderTest.options.scrollback = 60000;
  });
  // The file proves the PTY emitted every row in order. The screen must keep
  // them too: scrollback is raised before the burst, above the 5,000 default.
  await command("awk 'BEGIN {for(i=1;i<=50000;i++) printf \"ROW_%05d\\n\",i}' | tee rows.txt", "ROW_50000");
  const rows = (await readFile(join(sandbox, "rows.txt"), "utf8")).split("\n").filter(x => /^ROW_\d{5}$/.test(x));
  expect(rows).toEqual(Array.from({length: 50000}, (_,i) => `ROW_${String(i+1).padStart(5,"0")}`));
  await expect.poll(async () => (await text()).split("\n").filter(x => /^ROW_\d{5}$/.test(x)).length, { timeout: 60_000 }).toBe(50000);
  const scroll = page.locator('.xterm-viewport');
  const position = () => scroll.evaluate(el => el.scrollTop);
  const before = await position();
  await page.locator('.xterm-screen').hover(); await page.mouse.wheel(0,-400);
  await expect.poll(position).toBeLessThan(before);
  await expect(scroll).toHaveCSS('cursor','default');
  await expect(scroll).toHaveCSS('outline-style','none');
  // Drag Chromium's native scrollbar thumb from bottom to top.
  await scroll.evaluate(el => {el.scrollTop=el.scrollHeight;});
  const track = (await scroll.boundingBox())!;
  await page.mouse.move(track.x+track.width-3,track.y+track.height-10);
  await page.mouse.down();
  await page.mouse.move(track.x+track.width-3,track.y+10,{steps:12});
  await page.mouse.up();
  await expect.poll(position).toBeLessThan(before/2);
  await scroll.evaluate(el => {el.scrollTop=el.scrollHeight;});
  // Release background output only after both the terminal buffer and native
  // viewport have reached the top; runner speed must not decide event order.
  await command("(while [ ! -f release-async-output ]; do sleep 0.05; done; printf '\\nASYNC_%s\\n' OUTPUT) & printf '\\nWAIT_%s\\n' READY", "WAIT_READY");
  await page.evaluate(() => (window as any).terminalUnderTest.scrollToTop());
  await expect.poll(() => page.evaluate(() => (window as any).terminalUnderTest.buffer.active.viewportY)).toBe(0);
  await expect.poll(position).toBe(0);
  await writeFile(join(sandbox, "release-async-output"), "ready");
  await expect.poll(async () => (await text()).split("\n").includes("ASYNC_OUTPUT")).toBe(true);
  await expect.poll(position).toBe(0);
  await page.getByText("Toggle terminal", {exact:true}).click();
  await page.getByText("Toggle terminal", {exact:true}).click();
  await command("printf '\\nVISIBLE_%s\\n' OK", "VISIBLE_OK");
});

test("reload and IDE reopen keep the shell PID without repeating commands", async () => {
  await launch("persistent");
  await command("printf '%s' $$ > shell.pid; printf run >> executed; printf '\\nRUN_%s\\n' ONCE", "RUN_ONCE");
  const pid = await readFile(join(sandbox,"shell.pid"),"utf8");
  await page.evaluate(() => (window as any).terminalSockets.at(-1).close());
  await expect(page.locator("[data-terminal-status]")).toHaveAttribute("data-terminal-status", "disconnected");
  await page.keyboard.insertText("touch must-not-run; ");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-terminal-status]")).toHaveAttribute("data-terminal-status", "ready");
  await command("printf '\\nRECONNECTED_%s\\n' OK", "RECONNECTED_OK");
  expect((await text()).split("\n").filter(x => x === "RUN_ONCE")).toHaveLength(1);
  await page.getByText("Remount terminal", {exact: true}).click();
  await expect(page.locator("[data-terminal-status]")).toHaveAttribute("data-terminal-status", "ready");
  await page.reload();
  await expect(page.locator("[data-terminal-status]")).toHaveAttribute("data-terminal-status", "ready");
  await command("printf '\\nRECOVER_%s\\n' $$", `RECOVER_${pid}`);
  await app.close();
  await launch("persistent");
  await command("printf '\\nREOPEN_%s\\n' $$", `REOPEN_${pid}`);
  expect(await readFile(join(sandbox,"executed"),"utf8")).toBe("run");
  const { existsSync } = await import("node:fs");
  expect(existsSync(join(sandbox, "must-not-run"))).toBe(false);
});

test("job control, history, errors, ANSI, less and EOF", async () => {
  await launch("shell-features");
  await command("false; printf '\\nEXIT_%s\\n' $?", "EXIT_1");
  await command("printf '\\033[31mCOLOR_%s\\033[0m\\n' RED", "COLOR_RED");
  await command("printf 'OLD_VALUE\\r\\033[2KUPDATED_%s\\n' LINE", "UPDATED_LINE");
  expect((await text()).split("\n")).toContain("UPDATED_LINE");
  await command("clear; printf '\\nANSI_CLEAR_%s\\n' OK", "ANSI_CLEAR_OK");
  expect((await text()).split("\n")).not.toContain("COLOR_RED");
  await command("printf '\\nHISTORY_%s\\n' OK", "HISTORY_OK");
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await text()).split("\n").filter(x => x === "HISTORY_OK").length).toBe(2);
  await command("sh -c 'printf \"JOB_%s_READY\\n\" CONTROL; exec sleep 30'", "JOB_CONTROL_READY");
  await page.keyboard.press("Control+z");
  await command("jobs; printf '\\nSTOPPED_%s\\n' OK", "STOPPED_OK");
  expect(await text()).toMatch(/suspended|Stopped/);
  await command("bg; printf '\\nBACKGROUND_%s\\n' OK", "BACKGROUND_OK");
  await page.keyboard.insertText("fg"); await page.keyboard.press("Enter");
  // Wait until the foreground job owns the terminal, not just command echo.
  await expect.poll(async () => {
    const session = (await terminals()).find((x: any) => x.sessionId === "terminal-shell-features");
    const result = await fetch(`http://${runtime.host}:${runtime.port}/api/term/${session.termId}/info`, { headers: { Authorization: `Bearer ${runtime.token}` } });
    return (await result.json()).foreground;
  }).toBe("sleep");
  await page.keyboard.press("Control+c");
  await command("printf '\\nFOREGROUND_%s\\n' OK", "FOREGROUND_OK");
  await page.keyboard.insertText("awk 'BEGIN {for(i=1;i<=100;i++) print i}' > pager.txt; less pager.txt");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).terminalUnderTest.buffer.active.type)).toBe("alternate");
  await page.keyboard.press("q");
  await expect.poll(() => page.evaluate(() => (window as any).terminalUnderTest.buffer.active.type)).toBe("normal");
  await command("printf '\\nPAGER_%s\\n' OK", "PAGER_OK");
  await page.keyboard.press("Control+d");
  await expect(page.locator("[data-terminal-status]")).toHaveAttribute("data-terminal-status", "exited");
});

test("clear, wrapped Unicode, completion, selection and GPU fallback", async () => {
  await launch("display-features", "webgl");
  await command("mkdir -p 'space dir'; printf 'FILE_OK\\n' > 'space dir'/completion.txt; printf '\\nSETUP_%s\\n' OK", "SETUP_OK");
  await page.keyboard.insertText("cat 'space dir'/complet");
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await expect.poll(text).toContain("FILE_OK");
  const long = "界".repeat(200);
  await command(`printf '\\nLONG_%s_END\\n' '${long}'`, "_END");
  // Buffer lines wrap, but every wide glyph must survive.
  await expect.poll(async () => (await text()).replace(/\s/g, "")).toContain(`LONG_${long}_END`);
  await page.evaluate(() => { const term = (window as any).terminalUnderTest; term.selectAll(); });
  await page.keyboard.press("Meta+c");
  await expect.poll(() => app.evaluate(({clipboard}) => clipboard.readText())).toContain("FILE_OK");
  await page.keyboard.press("Control+c");
  await command("printf '\\nCOPY_%s\\n' OK", "COPY_OK");
  const lostContext = await page.evaluate(() => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(".xterm-screen canvas")) {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (extension) { extension.loseContext(); return true; }
    }
    return false;
  });
  expect(lostContext, "Exercise a real WebGL context loss, not an optional no-op").toBe(true);
  await command("printf '\\nGPU_%s\\n' OK", "GPU_OK");
  await page.getByText("Clear terminal", {exact: true}).click();
  await command("printf '\\nCLEAR_%s\\n' OK", "CLEAR_OK");
  expect(await text()).not.toContain("FILE_OK");
});


test("closing a terminal stops its background job", async () => {
  await launch("close-processes");
  await command("sleep 60 & printf '%s' $! > background.pid; printf '\\nSTARTED_%s\\n' JOB", "STARTED_JOB");
  const pid = Number(await readFile(join(sandbox, "background.pid"), "utf8"));
  const session = (await terminals()).find((x: any) => x.sessionId === "terminal-close-processes");
  await fetch(`http://${runtime.host}:${runtime.port}/api/term/${session.termId}/close`, {
    method: "POST", headers: { Authorization: `Bearer ${runtime.token}` },
  });
  await expect.poll(() => { try { process.kill(pid, 0); return true; } catch { return false; } }).toBe(false);
});


test("Vite keeps running until interrupted and returns to the same shell", async () => {
  await launch("vite-process");
  const net = await import("node:net");
  const port = await new Promise<number>(res => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const n = (server.address() as any).port; server.close(() => res(n)); }); });
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  await command(`${quote(process.execPath)} ${quote(join(root,"client/ide/node_modules/vite/bin/vite.js"))} --host 127.0.0.1 --port ${port} --strictPort`, "Local:");
  expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBeLessThan(500);
  await page.keyboard.press("Control+c");
  await command("printf '\\nVITE_STOPPED_%s\\n' OK", "VITE_STOPPED_OK");
});

test("split panes isolate input and multiline paste executes once", async () => {
  await launch("split-panes");
  await page.getByText("Split terminal", {exact: true}).click();
  await expect(page.locator("[data-terminal-status=ready]")).toHaveCount(2);
  await page.locator(".xterm-helper-textarea").nth(0).focus();
  await page.keyboard.insertText("printf '\\nFIRST_%s\\n' PANE"); await page.keyboard.press("Enter");
  await page.locator(".xterm-helper-textarea").nth(1).focus();
  await page.keyboard.insertText("printf '\\nSECOND_%s\\n' PANE"); await page.keyboard.press("Enter");
  const buffers = () => page.evaluate(() => (window as any).terminalInstances.map((t: any) =>
    Array.from({length:t.buffer.active.length},(_,i)=>t.buffer.active.getLine(i).translateToString(true)).join("\n")));
  await expect.poll(buffers).toEqual([expect.stringContaining("FIRST_PANE"), expect.stringContaining("SECOND_PANE")]);
  const values = await buffers();
  expect(values[0]).not.toContain("SECOND_PANE"); expect(values[1]).not.toContain("FIRST_PANE");
  await app.evaluate(({clipboard}) => clipboard.writeText("printf '\\nMULTI_%s\\n' ONE\r\nprintf '\\nMULTI_%s\\n' TWO"));
  await page.keyboard.press("Meta+v"); await page.keyboard.press("Enter");
  await expect.poll(async () => ((await buffers())[1].match(/^MULTI_(ONE|TWO)$/gm) ?? [])).toEqual(["MULTI_ONE","MULTI_TWO"]);
});


test("link decorations open the expected URL and leave shell input intact", async () => {
  await launch("link-decorations");
  const url = "https://example.com/terminal-check";
  await command(`printf '\\n%s\\n' '${url}'`, url);
  await expect.poll(async () => (await text()).split("\n").includes(url)).toBe(true);
  const position = await page.evaluate((url) => {
    const t = (window as any).terminalUnderTest;
    const b = t.buffer.active;
    const rect = document.querySelector(".xterm-screen")!.getBoundingClientRect();
    for (let i = b.viewportY; i < b.length; i++) {
      if (b.getLine(i).translateToString(true) === url) return {
        x: rect.x + rect.width / t.cols * 5.5,
        y: rect.y + rect.height / t.rows * (i - b.viewportY + 0.5),
      };
    }
    throw new Error("URL output line missing");
  }, url);
  await page.mouse.move(position.x, position.y);
  await page.keyboard.down("Meta");
  await page.mouse.click(position.x, position.y);
  await page.keyboard.up("Meta");
  await expect.poll(() => page.evaluate(() => (window as any).openedTerminalLinks ?? [])).toContain(url);
  await command("printf '\\nLINK_INPUT_%s\\n' OK", "LINK_INPUT_OK");
});


test("npm run dev keeps scroll usable without selecting terminal text", async () => {
  await launch("npm-scroll");
  await command("awk 'BEGIN {for(i=1;i<=200;i++) print \"SCROLL_HISTORY_\" i}'", "SCROLL_HISTORY_200");
  const scroll = page.locator('.xterm-viewport');
  await page.locator(".xterm-screen").hover();
  expect(await scroll.evaluate(el => getComputedStyle(el,'::-webkit-scrollbar').display)).not.toBe('none');
  expect(await page.evaluate(() => (window as any).terminalUnderTest.hasSelection())).toBe(false);
  const net = await import("node:net");
  const port = await new Promise<number>(resolve => { const server = net.createServer(); server.listen(0,"127.0.0.1",() => {const n = (server.address() as any).port; server.close(() => resolve(n));}); });
  const quote = (s: string) => "'" + s.replace(/'/g,"'\\''") + "'";
  await writeFile(join(sandbox,"package.json"), JSON.stringify({private:true,scripts:{dev:`${quote(process.execPath)} ${quote(join(root,"client/ide/node_modules/vite/bin/vite.js"))} --host 127.0.0.1 --port ${port} --strictPort`}}));
  await command("npm run dev", "Local:");
  await page.locator(".xterm-screen").hover();
  expect(await scroll.evaluate(el => getComputedStyle(el,'::-webkit-scrollbar').display)).not.toBe('none');
  expect(await page.evaluate(() => (window as any).terminalUnderTest.hasSelection())).toBe(false);
  await scroll.evaluate(el => {el.scrollTop=0;});
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0);
  expect(await text()).toContain("SCROLL_HISTORY_1");
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+c");
  await command("printf '\\nNPM_STOPPED_%s\\n' OK", "NPM_STOPPED_OK");
});


test("local output is painted without selecting text, including clear and panel reveal", async () => {
  await launch("paint-without-selection");
  const assertPainted = async (marker: string) => {
    await expect.poll(async () => {
      const clip = await page.evaluate(marker => {
        const t = (window as any).terminalUnderTest;
        if (t.hasSelection()) throw new Error("Paint must not depend on selection");
        const b = t.buffer.active;
        const rect = document.querySelector(".xterm-screen")!.getBoundingClientRect();
        for (let i = b.viewportY; i < b.viewportY + t.rows; i++) {
          if (b.getLine(i)?.translateToString(true) === marker) return {
            x: Math.ceil(rect.x), y: Math.ceil(rect.y + (i - b.viewportY) * rect.height / t.rows),
            width: Math.floor(rect.width / t.cols * marker.length), height: Math.floor(rect.height / t.rows),
          };
        }
        return null;
      }, marker);
      if (!clip) return 0;
      const win = await app.browserWindow(page);
      return win.evaluate(async (win, clip) => {
        const pixels = (await win.capturePage(clip)).toBitmap();
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) > 100) ink++;
        }
        return ink;
      }, clip);
    }).toBeGreaterThan(30);
  };
  await command("printf '\\nPAINT_%s\\n' BEFORE", "PAINT_BEFORE");
  await assertPainted("PAINT_BEFORE");
  // Fault injection in the optional GPU text atlas: a valid context can
  // retain a blank glyph texture without emitting a context-loss event.
  await page.evaluate(() => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(".xterm-screen canvas")) {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl?.getParameter(gl.TEXTURE_BINDING_2D)) continue;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    const t = (window as any).terminalUnderTest;
    t.refresh(0, t.rows - 1);
  });
  await assertPainted("PAINT_BEFORE");
  await command("printf '\\033[H\\033[2J\\033[37mPAINT_%s\\033[0m\\n' AFTER_CLEAR", "PAINT_AFTER_CLEAR");
  await assertPainted("PAINT_AFTER_CLEAR");
  await page.getByText("Toggle terminal", {exact:true}).click();
  await page.getByText("Toggle terminal", {exact:true}).click();
  await assertPainted("PAINT_AFTER_CLEAR");
  await page.getByText("Zoom in", {exact:true}).click();
  await assertPainted("PAINT_AFTER_CLEAR");
  await command("printf '\\nPAINT_%s\\n' AFTER_REVEAL", "PAINT_AFTER_REVEAL");
  await assertPainted("PAINT_AFTER_REVEAL");
});


test("reset followed by immediate teardown does not access a disposed renderer", async () => {
  await launch("teardown-race");
  await page.evaluate(() => (window as any).probeTerminalTeardown());
  expect(errors).toEqual([]);
  await command("printf '\\nTEARDOWN_%s\\n' OK", "TEARDOWN_OK");
});


test("unchanged layout does not repaint the entire terminal", async () => {
  await launch("no-layout-flicker");
  await command("printf '\\nSTEADY_%s\\n' TEXT", "STEADY_TEXT");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const term=(window as any).terminalUnderTest;
    const original=term.refresh.bind(term);
    (window as any).fullRefreshes=0;
    term.refresh=(start:number,end:number) => { (window as any).fullRefreshes++; original(start,end); };
  });
  await page.getByText("Repeat fit",{exact:true}).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => (window as any).fullRefreshes)).toBe(0);
  expect(await text()).toContain("STEADY_TEXT");
});
