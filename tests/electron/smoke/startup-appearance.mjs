// Run alone: real native splash/renderer crossfades, using disposable profiles.
import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const source = process.argv[2] === '--source';
const binary = source ? require('electron') : resolve(process.argv[2] ?? 'artifacts/terminal-smoke/package/mac-arm64/Coloride.app/Contents/MacOS/Coloride');
const sandbox = await mkdtemp(join(tmpdir(), 'coloride-startup-appearance-'));
const output = resolve('artifacts/terminal-smoke/startup-appearance');
await mkdir(output, { recursive: true });
const report = { timestamp: new Date().toISOString(), conditions: 'Real Electron, disposable HOME/profile/project; DOM/compositor samples, not an FPS benchmark.', cases: [] };
const delay = ms => new Promise(done => setTimeout(done, ms));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function bounded(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function descendants(parentPid) {
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([parentPid]);
  let count;
  do { count = owned.size; for (const [pid, parent] of processes) if (owned.has(parent)) owned.add(pid); } while (owned.size !== count);
  owned.delete(parentPid);
  return [...owned].reverse();
}
async function terminate(pids) {
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  await delay(250);
  for (const pid of pids) { try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {} }
}

// External SVG images do not expose SMIL getCurrentTime(). Stable document and
// image identities prove continuity; raster samples below verify actual motion.
const nativeProbe = `(() => {
  const image = document.querySelector('.mark img');
  if (!image?.complete || !image.naturalWidth) return null;
  window.__startupSmokeImage ??= image;
  return { timeOrigin: performance.timeOrigin, elapsedMs: performance.now(),
    sameImage: window.__startupSmokeImage === image, src: image.getAttribute('src'),
    opacity: Number(getComputedStyle(document.body).opacity), phase: document.documentElement.dataset.startup,
    theme: document.documentElement.dataset.theme,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    transitionProperty: getComputedStyle(document.body).transitionProperty };
})()`;
const rendererProbe = `(() => {
  const root = document.getElementById('root');
  const app = root?.querySelector('.login-gate-app, .login-gate');
  const marks = [...document.querySelectorAll('.coloride-boot-splash img, .login-gate-boot-mark img')];
  return { phase: document.documentElement.dataset.startup ?? null,
    rootOpacity: root ? Number(getComputedStyle(root).opacity) : null,
    appOpacity: app ? Number(getComputedStyle(app).opacity) : null,
    visibleLoadingMarks: marks.filter(image => image.checkVisibility()).length,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    nativeStartupSplash: window.colorideDesktop?.nativeStartupSplash === true };
})()`;

async function snapshot(app, page) {
  // webContents.executeJavaScript waits for did-finish-load. The main renderer
  // is deliberately gated here, so inspect it through CDP/Playwright instead.
  const renderer = await bounded(page.evaluate(rendererProbe), 3000, 'Renderer frame probe');
  const surface = await bounded(app.evaluate(async ({ BrowserWindow }, script) => {
    const win = BrowserWindow.getAllWindows()[0];
    const splash = win.contentView.children.find(view => view.webContents?.getURL().includes('/splash.html'));
    let native = null;
    if (splash && !splash.webContents.isDestroyed()) {
      try { native = await splash.webContents.executeJavaScript(script); } catch { /* Removed between frames. */ }
    }
    return { native: native ? { id: splash.webContents.id, ...native } : null, background: win.getBackgroundColor() };
  }, nativeProbe), 3000, 'Native frame probe');
  return { renderer, ...surface };
}

async function nativePixels(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const view = win.contentView.children.find(view => view.webContents?.getURL().includes('/splash.html'));
    if (!view) throw new Error('Native splash disappeared during loading.');
    const bounds = view.getBounds();
    const image = await view.webContents.capturePage({ x: Math.floor(bounds.width / 2 - 45), y: Math.floor((bounds.height + 40) / 2 - 45), width: 90, height: 90 });
    const bitmap = image.toBitmap();
    let colorful = 0, hash = 2166136261;
    for (let index = 0; index < bitmap.length; index += 4) {
      // Hash opaque artwork only; translucent backdrop pixels can legitimately
      // change when another desktop window repaints beneath the native blur.
      if (bitmap[index + 3] > 200) {
        if (Math.max(bitmap[index], bitmap[index + 1], bitmap[index + 2]) - Math.min(bitmap[index], bitmap[index + 1], bitmap[index + 2]) > 25) colorful++;
        hash = Math.imul(hash ^ bitmap[index], 16777619) >>> 0;
      }
    }
    return { colorful, hash, cornerAlpha: bitmap[3] };
  });
}

async function capture(app, path) {
  const layers = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const native = win.contentView.children.find(view => view.webContents?.getURL().includes('/splash.html'));
    const primary = (await win.webContents.capturePage()).toPNG();
    let splash = null;
    try { if (native && !native.webContents.isDestroyed()) splash = (await native.webContents.capturePage()).toPNG(); } catch { /* Fade completed during capture. */ }
    return { primary, splash };
  });
  // Preserve the actual layers separately: a page capture is not a recording
  // of macOS WindowServer compositing the transparent child above its parent.
  await writeFile(path, layers.primary);
  if (layers.splash) await writeFile(path.replace(/\.png$/, '-native.png'), layers.splash);
}

async function stopFixtureHost(runtime) {
  if (!runtime) return;
  const headers = { Authorization: `Bearer ${runtime.token}` };
  try {
    const sessions = await (await fetch(`http://${runtime.host}:${runtime.port}/api/term`, { headers, signal: AbortSignal.timeout(2000) })).json();
    for (const session of sessions) await fetch(`http://${runtime.host}:${runtime.port}/api/term/${session.termId}/close`, { method: 'POST', headers, signal: AbortSignal.timeout(2000) });
  } catch { /* The fixture host may have exited already. */ }
  try {
    const pids = execFileSync('/usr/sbin/lsof', ['-tiTCP:' + runtime.port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/);
    const owned = pids.filter(pid => Number(pid) > 0).map(Number);
    await terminate([...owned.flatMap(descendants), ...owned]);
  } catch { /* Only this temporary profile's discovery port is inspected. */ }
}

async function run(appearance, reducedMotion) {
  const name = `${appearance}${reducedMotion ? '-reduced-motion' : ''}`;
  const directory = join(sandbox, name), home = join(directory, 'home'), userData = join(directory, 'user-data'), project = join(directory, 'project');
  await Promise.all([home, userData, project].map(folder => mkdir(folder, { recursive: true })));
  await writeFile(join(userData, 'window-appearance.json'), JSON.stringify({ appearance }));
  await writeFile(join(project, 'startup.txt'), 'Startup appearance fixture\n');
  const env = { ...process.env, HOME: home, COLORIDE_TEST_USER_DATA: userData, COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1', COLORIDE_DEV: '0' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'COLORIDE_WEB_DEV_URL', 'COLORIDE_SIDECAR', 'COLORIDE_PYTHON']) delete env[key];
  const hostGate = join(directory, 'release-host');
  if (source) {
    // Gate only this disposable host through the existing interpreter override.
    // Routes are installed before HTTP navigation even on a very fast startup.
    const wrapper = join(directory, 'python-gate');
    const python = resolveTestPython();
    await writeFile(wrapper, `#!/bin/sh\nwhile [ ! -f ${quote(hostGate)} ]; do sleep 0.02; done\nexec ${quote(python)} "$@"\n`, { mode: 0o700 });
    env.COLORIDE_PYTHON = wrapper;
  }
  const result = { name, appearance, reducedMotion, loading: [], fade: [], status: 'running' };
  report.cases.push(result);
  let app, runtime, releaseRenderer;
  const rendererGate = new Promise(done => { releaseRenderer = done; });
  try {
    app = await _electron.launch({ executablePath: binary, args: source ? [resolve('client/desktop/src/main.cjs')] : [], env, timeout: 60000 });
    result.logs = '';
    app.process().stdout.on('data', data => { result.logs += String(data); });
    app.process().stderr.on('data', data => { result.logs += String(data); });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/assets/*.js', async route => { if (!route.request().url().endsWith('/boot.js')) await rendererGate; await route.continue(); });
    await page.route('https://**/*', route => route.abort());
    if (source) await writeFile(hostGate, '');
    await page.waitForURL('http://**/', { timeout: 60000, waitUntil: 'commit' });
    if (reducedMotion) {
      const nativePage = app.windows().find(window => window.url().includes('/splash.html'));
      assert(nativePage, 'The native loading document must be available for media-preference emulation.');
      await nativePage.emulateMedia({ reducedMotion: 'reduce' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect.poll(async () => (await snapshot(app, page)).native?.src.includes('coloride-loading-reduced.svg')).toBe(true);
      await nativePage.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      result.mediaSetup = 'Reduced motion emulated on both surfaces before the continuity baseline; production loads the static gray artwork.';
    }
    await expect.poll(async () => (await snapshot(app, page)).native?.theme).toBe(appearance);
    await expect(page.locator('#root')).toBeAttached();
    await expect(page.locator('.coloride-boot-splash')).toHaveCount(1);
    // The saved native appearance and renderer preference describe one user
    // profile. Seed both before React reads its preferences under the gate.
    await page.evaluate(theme => localStorage.setItem('coloride.app-preferences.v1', JSON.stringify({ theme })), appearance);
    await expect(page.locator('html')).toHaveAttribute('data-theme', appearance);
    await expect(page.locator('.coloride-boot-splash')).toBeHidden();
    await (await app.browserWindow(page)).evaluate(win => { win.webContents.setBackgroundThrottling(false); win.show(); win.focus(); });
    const initial = await snapshot(app, page);
    assert(initial.renderer.nativeStartupSplash, 'Renderer must use the persistent native startup surface.');
    assert.equal(initial.renderer.rootOpacity, 0, 'Renderer must remain hidden behind the loading mark.');
    assert.equal(initial.native.reducedMotion, reducedMotion);
    assert.equal(initial.renderer.reducedMotion, reducedMotion);
    assert.equal(initial.native.src.includes('coloride-loading-reduced.svg'), reducedMotion, 'Native loading artwork must follow the motion preference.');
    assert.equal(initial.renderer.visibleLoadingMarks, 0, 'A second loading logo must never appear in the app document.');
    assert.equal(initial.native.opacity, 1);
    assert(!initial.native.transitionProperty.includes('backdrop-filter'), 'Startup must not animate full-window blur.');
    await capture(app, join(output, `${name}-loading.png`));

    // Cover a whole sweep regardless of when Playwright attached. This delay
    // belongs only to the smoke's deliberate renderer gate, never production.
    for (let index = 0; index < 20; index++) {
      const frame = await snapshot(app, page);
      assert.equal(frame.native?.id, initial.native.id, 'Loading surface was replaced during renderer navigation.');
      assert.equal(frame.native.timeOrigin, initial.native.timeOrigin, 'The native SVG document restarted.');
      assert(frame.native.sameImage, 'The animated SVG image was replaced.');
      assert.equal(frame.native.opacity, 1);
      result.loading.push({ ...frame.native, pixels: await nativePixels(app) });
      await delay(100);
    }
    assert(result.loading[0].pixels.cornerAlpha > 0 && result.loading[0].pixels.cornerAlpha < 255, 'The native startup layer must remain translucent.');
    assert(result.loading.at(-1).elapsedMs > result.loading[0].elapsedMs + 1500, 'Original splash timeline must keep progressing.');
    if (reducedMotion) {
      assert(result.loading.every(frame => frame.pixels.colorful === 0), 'Reduced motion must keep the mark static and gray.');
      assert.equal(new Set(result.loading.map(frame => frame.pixels.hash)).size, 1, 'Reduced motion must not animate or restart the mark.');
    } else {
      assert(result.loading.some(frame => frame.pixels.colorful > 50), 'Native mark must reveal its original colors.');
      assert(new Set(result.loading.map(frame => frame.pixels.hash)).size > 1, 'The same native SVG must stay animated while loading.');
    }

    const fadeStarted = performance.now();
    const sampling = (async () => {
      let midpointCaptured = false;
      while (performance.now() - fadeStarted < 10000) {
        const frame = await snapshot(app, page);
        result.fade.push({ elapsedMs: performance.now() - fadeStarted, ...frame });
        if (!midpointCaptured && frame.native && frame.native.opacity < 0.8 && frame.native.opacity > 0.2) {
          await capture(app, join(output, `${name}-midpoint.png`)); midpointCaptured = true;
        }
        if (!frame.native && frame.renderer.phase === null) return;
        await delay(16);
      }
      throw new Error('Native splash did not finish within ten seconds.');
    })();
    releaseRenderer();
    await sampling;
    const visibleFrames = result.fade.filter(frame => frame.native);
    for (let index = 0; index < visibleFrames.length; index++) {
      const frame = visibleFrames[index];
      assert.equal(frame.native.id, initial.native.id, 'Native surface changed during editor reveal.');
      assert.equal(frame.native.timeOrigin, initial.native.timeOrigin);
      assert(frame.native.sameImage);
      assert.equal(frame.renderer.visibleLoadingMarks, 0, 'Renderer flashed a duplicate loading mark.');
      if (index > 0) {
        assert(frame.native.opacity <= visibleFrames[index - 1].native.opacity + 0.025, 'Departing mark blinked back to a higher opacity.');
        assert(frame.renderer.rootOpacity >= visibleFrames[index - 1].renderer.rootOpacity - 0.025, 'Editor faded back out during startup.');
      }
    }
    if (!reducedMotion) {
      assert(visibleFrames.some(frame => frame.native.opacity > 0.1 && frame.native.opacity < 0.9), 'Expected intermediate native opacity during crossfade.');
      assert(visibleFrames.some(frame => frame.renderer.rootOpacity > 0.1 && frame.renderer.rootOpacity < 0.9), 'Expected intermediate editor opacity during the same crossfade.');
    }
    const settled = result.fade.at(-1);
    assert.equal(settled.native, null);
    assert.equal(settled.renderer.rootOpacity, 1, 'Native mark was removed before editor became opaque.');
    assert.equal(settled.background.toLowerCase(), appearance === 'light' ? '#ffffff' : '#171717');
    await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toBeVisible();
    const brand = page.getByRole('img', { name: 'Coloride', exact: true });
    await expect(brand).toBeVisible();
    await expect.poll(() => brand.evaluate(image => image.complete && image.naturalWidth > 0 && image.src.includes('coloride-wordmark'))).toBe(true);
    for (const selector of ['.desktop-titlebar', 'nav[aria-label="Primary"]', '.app-canvas', '.app-status-bar']) {
      await expect(page.locator(selector).first()).toHaveCSS('background-color', appearance === 'light' ? 'rgb(255, 255, 255)' : 'rgb(23, 23, 23)');
    }
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', { detail: 'open-local-folder' })));
    const tree = page.getByLabel('Workspace file tree');
    await expect(tree).toBeVisible();
    await tree.getByText('startup.txt', { exact: true }).click();
    const editor = page.locator('.cm-content[contenteditable="true"]').first();
    await expect(editor).toContainText('Startup appearance fixture');
    await editor.click(); await page.keyboard.press('Meta+a');
    const edited = `Startup appearance fixture\n${name} editor ready\n`;
    await page.keyboard.insertText(edited); await page.keyboard.press('Meta+s');
    await expect.poll(() => readFile(join(project, 'startup.txt'), 'utf8')).toBe(edited);
    assert.deepEqual(pageErrors, []);
    await capture(app, join(output, `${name}-editor.png`));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).not.toHaveAttribute('data-startup');
    assert.equal(await page.evaluate(() => window.colorideDesktop.nativeStartupSplash), false, 'Reload must not reuse the retired native startup flag.');
    assert.equal((await snapshot(app, page)).native, null, 'Reload must not recreate a native startup child.');
    await expect(page.locator('.cm-content[contenteditable="true"]').first()).toContainText(`${name} editor ready`);
    result.reloadWithoutNativeSplash = true;
    result.status = 'passed';
    console.log(`${name}: continuous SVG, monotonic crossfade, native backing and real editor PASS`);
  } catch (error) {
    result.status = 'failed'; result.error = error.stack || String(error);
    console.error(`${name}: ${error.message}`);
    try {
      result.debug = await bounded(app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const views = win.contentView.children.filter(view => view.webContents && !view.webContents.isDestroyed()).map(view => ({ id: view.webContents.id, url: view.webContents.getURL(), loading: view.webContents.isLoading() }));
        return { renderer: win.webContents.getURL(), views };
      }), 2000, 'Failure diagnostics');
    } catch {}
    try { if (app) await bounded(capture(app, join(output, `${name}-failure.png`)), 3000, 'Failure capture'); } catch {}
    throw error;
  } finally {
    releaseRenderer();
    if (source) await writeFile(hostGate, '');
    let owned = [];
    try { if (app) owned = descendants(app.process().pid); } catch {}
    try { if (app) await bounded(app.close(), 4000, 'Fixture app close'); }
    catch { try { process.kill(app.process().pid, 'SIGKILL'); } catch {} }
    try { runtime = JSON.parse(await readFile(join(userData, 'terminal-host.json'), 'utf8')); } catch {}
    await stopFixtureHost(runtime);
    await terminate(owned);
  }
}

try {
  await run('dark', true);
  await run('light', false);
  await run('dark', false);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack || String(error);
  console.error(report.error); process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`Report: ${join(output, 'report.json')}`);
}
