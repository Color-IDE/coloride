import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname,"../../..");
let app: ElectronApplication, page: Page, vite: ChildProcess, sandbox: string;
const errors: string[] = [];
test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(),"coloride-math-"));
  const net = await import("node:net");
  const port = await new Promise<number>(res => {const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const n=(server.address() as any).port;server.close(()=>res(n));});});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  vite=spawn(process.execPath,[join(root,"client/ide/node_modules/vite/bin/vite.js"),"--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:join(root,"client/ide"),env,stdio:"ignore"});
  await expect.poll(async () => {try{return (await fetch(`http://127.0.0.1:${port}/tests/markdown.html`)).ok;}catch{return false;}},{timeout:30000}).toBe(true);
  app=await _electron.launch({executablePath:require("electron"),args:[join(root,"tests/electron/support/electron-main.cjs")],env:{...env,COLORIDE_TEST_USER_DATA:join(sandbox,"data"),COLORIDE_TEST_URL:`http://127.0.0.1:${port}/tests/markdown.html`,COLORIDE_TEST_CONFIG:"{}"}});
  page=await app.firstWindow();page.on("pageerror",error=>errors.push(error.message));
  await expect(page.locator(".agent-markdown")).toBeVisible();
});
test.afterAll(async () => {await app?.close();vite?.kill("SIGTERM");if(sandbox)await rm(sandbox,{recursive:true,force:true});});
async function render(source: string) {await page.getByLabel("Markdown source").fill(source);await page.getByText("Render message",{exact:true}).click();await expect(page.locator(".agent-markdown")).toHaveAttribute("data-text-pending","false");}

test("inline and block LaTeX render with local fonts and stay intact while streaming",async () => {
  await expect(page.locator(".katex")).toHaveCount(5);
  await expect(page.locator(".katex-display")).toHaveCount(1);
  expect(await page.locator(".katex math").count()).toBe(5);
  await page.getByText("Toggle streaming",{exact:true}).click();
  await expect(page.locator(".katex .t-stream-w")).toHaveCount(0);
  expect(await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('16px KaTeX_Main');})).toBe(true);
  await expect(page.locator(".t-stream-w").last()).toHaveCSS("opacity","1");
  await page.screenshot({path:resolve("artifacts/terminal-smoke/latex-chat.png"),animations:"disabled"});
  await render(String.raw`Partial: $\frac{1}{`);
  await expect(page.locator(".katex")).toHaveCount(0);
  await render(String.raw`Completed: $\frac{1}{2}$.`);
  await expect(page.locator(".katex")).toHaveCount(1);
  await expect(page.locator(".katex .t-stream-w")).toHaveCount(0);
  await render("```math\nx^2+y^2=z^2\n```");
  await expect(page.locator(".katex-display")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("code, escaped dollars, invalid math and unsafe links remain safe",async () => {
  await render('Literal `$M_\\odot$` and \\$5.\n\n```ts\nconst price = "$10";\n```\n\nBad: $\\frac{1}{$. Good: $x^2$.\n\n$\\href{javascript:alert(1)}{bad}$');
  await expect(page.locator(".agent-markdown code").first()).toContainText('$M_\\odot$');
  await expect(page.locator(".agent-markdown code .katex")).toHaveCount(0);
  await expect(page.locator(".katex-error")).toHaveCount(1);
  await expect(page.locator('.agent-markdown a[href^="javascript:"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("display equations scroll inside narrow panels without widening the page",async () => {
  await (await app.browserWindow(page)).evaluate(win=>win.setSize(390,650));
  await render('$$\n'+String.raw`\underbrace{a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a}_{\text{long equation}}`+'\n$$');
  const display=page.locator(".katex-display");
  await expect(display).toHaveCSS("overflow-x","auto");
  expect(await display.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("provider bursts reveal progressively, keep existing words and finish after done", async () => {
  // A slow commit can leave the previous test's 230-character formula in the
  // DOM for a frame. Exercise that scheduling gap without sampling another message.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 6});
  try {
    await page.emulateMedia({reducedMotion: "no-preference"});
    const first = Array.from({length: 80}, (_, i) => `word${i}`).join(" ") + " ";
    const final = first + "Final chunk stays intact: español, مرحبا, 👩‍💻.";
    await page.evaluate(first => {
      (window as any).streamFrames = [];
      const previous = document.querySelector('[data-test-message-key]');
      if (!previous) throw new Error('Missing markdown message fixture');
      const nextKey = Number(previous.getAttribute('data-test-message-key')) + 1;
      const streamSelector = `[data-test-message-key="${nextKey}"] .agent-markdown`;
      const record = () => {
        (window as any).streamFrames.push(document.querySelector(streamSelector)?.textContent ?? '');
        (window as any).streamRaf = requestAnimationFrame(record);
      };
      window.dispatchEvent(new CustomEvent('coloride:test-stream', {detail: {text: first, streaming: true, reset: true}}));
      requestAnimationFrame(record);
    }, first);
    await expect(page.locator('.t-stream-w').first()).toBeVisible();
    await page.evaluate(() => { (window as any).firstStreamWord = document.querySelector('.t-stream-w'); });
    await page.evaluate(final => window.dispatchEvent(new CustomEvent('coloride:test-stream', {detail: {text: final, streaming: false}})), final);
    await expect(page.locator('.agent-markdown')).toHaveText(final.trim());
    await expect(page.locator('.t-stream-w').last()).toHaveCSS('opacity', '1');
    const result = await page.evaluate(() => {
      cancelAnimationFrame((window as any).streamRaf);
      return {frames: (window as any).streamFrames as string[], sameWord: (window as any).firstStreamWord === document.querySelector('.t-stream-w')};
    });
    expect(result.sameWord).toBe(true);
    expect(result.frames.some(text => text.length > 0 && text.length < first.length)).toBe(true);
    expect(new Set(result.frames.map(text => text.length)).size).toBeGreaterThan(5);
    for (let i = 1; i < result.frames.length; i++) expect(result.frames[i].length).toBeGreaterThanOrEqual(result.frames[i - 1].length);
    await page.screenshot({path: resolve('artifacts/terminal-smoke/smooth-streaming.png')});
    expect(errors).toEqual([]);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
    await cdp.detach();
  }
});

test("live cards expand gradually and reduced motion shows complete text immediately", async () => {
  const heights = await page.evaluate(async () => {
    window.dispatchEvent(new CustomEvent('coloride:test-stream', {detail: {text: 'Completed history', streaming: false, reset: true, card: true}}));
    const samples: number[] = [];
    const start = performance.now();
    await new Promise<void>(resolve => {
      const record = () => {
        const card = document.querySelector('.agent-timeline-reveal');
        if (card) samples.push(card.getBoundingClientRect().height);
        if (performance.now() - start < 400) requestAnimationFrame(record); else resolve();
      };
      requestAnimationFrame(record);
    });
    return samples;
  });
  expect(heights.length).toBeGreaterThan(3);
  expect(heights.some(height => height > 0 && height < heights.at(-1)! - 1)).toBe(true);
  await page.emulateMedia({reducedMotion: 'reduce'});
  const text = 'Reduced motion: texto completo 👩‍💻 مرحبا';
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('coloride:test-stream', {detail: {text, streaming: true, reset: true}})), text);
  await expect(page.locator('.agent-markdown')).toHaveText(text);
  await expect(page.locator('.t-stream-w').last()).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});
