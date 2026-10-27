// Real Electron performance benchmarks. Run alone: windows compete for focus.
import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const options = { scenario: 'startup', runs: 20, budgetMs: 2000, output: join(root, 'artifacts/performance/startup.json') };
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i];
  if (name === '--scenario') options.scenario = process.argv[++i];
  else if (name === '--runs') options.runs = Number(process.argv[++i]);
  else if (name === '--profile') options.profile = true;
  else if (name === '--output') options.output = resolve(process.argv[++i]);
  else if (name === '--help') {
    console.log('pnpm bench:startup | pnpm bench:file-open [--runs 20] [--output report.json]');
    process.exit(0);
  } else throw new Error(`Unknown option: ${name}`);
}
assert(['startup', 'file-open'].includes(options.scenario), 'Unknown benchmark scenario.');
if (options.scenario === 'file-open') {
  options.budgetMs = 100;
  if (!process.argv.includes('--output')) options.output = join(root, 'artifacts/performance/file-open.json');
}
assert(Number.isInteger(options.runs) && options.runs >= 20, 'At least 20 samples are required for the p95 gate.');
await readFile(join(root, 'client/ide/dist/index.html')); // Fail before launching if build:web is missing.
const sandbox = await realpath(await mkdtemp(join(os.tmpdir(), 'coloride-startup-benchmark-')));
const project = join(sandbox, 'project with spaces');
const userData = join(sandbox, 'user-data');
const home = join(sandbox, 'home');
const original = '# ColorIDE startup benchmark\n\nA restored editor must accept a real edit.\n';
const marker = 'BENCHMARK_INPUT_OK';
const samples = [];
let runtime, app;
const env = { ...process.env, HOME: home, COLORIDE_TEST_USER_DATA: userData,
  COLORIDE_DEV: '0', COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1',
  COLORIDE_VOICE_PREWARM: '0', SHELL: '/bin/bash' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'COLORIDE_WEB_DEV_URL', 'COLORIDE_SIDECAR']) delete env[key];
env.COLORIDE_PYTHON = resolveTestPython();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const report = {
  benchmark: options.scenario === 'startup' ? 'warm-start-to-edit' : 'local-file-open', budgetMs: options.budgetMs, requestedRuns: options.runs,
  timestamp: new Date().toISOString(),
  environment: { platform: os.platform(), release: os.release(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(),
    node: process.version, electron: require('electron/package.json').version },
  revision: { commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')) },
  build: { mode: 'checkout Electron + production renderer + source Python',
    htmlSha256: createHash('sha256').update(await readFile(join(root, 'client/ide/dist/index.html'))).digest('hex') },
  conditions: { warmupRuns: 1, host: 'persistent fixture host reused, PID verified',
    profile: 'same isolated profile; restore-session default', voiceModelPrewarm: false,
    project: '10,000 generated JavaScript files across 100 directories, plus README.md; no dependencies',
    clock: 'Node monotonic performance.now before _electron.launch through native splash dismissal and visible accepted edit',
    limitations: 'Includes Playwright launch/interaction overhead. OS caches are not flushed. Not a packaged build, cold start, SSH or AI latency result.' },
  samples, status: 'running',
};
async function launch() {
  const started = performance.now();
  app = await _electron.launch({ executablePath: require('electron'),
    args: [join(root, 'client/desktop/src/main.cjs')], env, timeout: 60000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  return { page, started, attachedMs: performance.now() - started };
}
async function readRuntime() {
  runtime = JSON.parse(await readFile(join(userData, 'terminal-host.json'), 'utf8'));
  return runtime;
}
function hostPid() {
  // Only the port from this newly created profile is inspected; never user sessions.
  const pids = execFileSync('/usr/sbin/lsof', ['-tiTCP:' + runtime.port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/);
  assert.equal(pids.length, 1, 'Expected one isolated fixture host.');
  return Number(pids[0]);
}
async function editorReady(page) {
  await page.waitForFunction(text => {
    // DOM hit testing cannot see the native WebContentsView above the page.
    // Startup completes only after that view has faded and been disposed.
    if (document.documentElement.hasAttribute('data-startup')) return false;
    const editor = document.querySelector('.cm-content[contenteditable="true"]');
    if (!editor || !editor.textContent.includes(text) || !editor.checkVisibility()) return false;
    const rect = editor.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 8, rect.top + 8);
    return Boolean(hit && editor.contains(hit));
  }, 'ColorIDE startup benchmark', { polling: 'raf', timeout: 30000 });
}
try {
  assert.equal(process.platform, 'darwin', 'This benchmark currently supports macOS fixture cleanup only.');
  await mkdir(project); await mkdir(home);
  await writeFile(join(project, 'README.md'), original);
  for (let group = 0; group < 100; group++) {
    const folder = join(project, `module-${String(group).padStart(3, '0')}`);
    await mkdir(folder);
    await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(folder, `file-${i}.js`), `export const value${i} = ${group * 100 + i};\n`)));
  }
  const fileCases = [];
  if (options.scenario === 'file-open') {
    const folder = join(project, 'benchmark-files');
    await mkdir(folder);
    for (let index = 0; index <= options.runs; index++) {
      const name = `${String(index).padStart(3, '0')}-${index ? 'sample' : 'warmup'}.txt`;
      const marker = `COLORIDE_FILE_OPEN_${String(index).padStart(3, '0')}`;
      const content = (marker + '\n' + 'Ordinary local text file for editor opening latency.\n'.repeat(400)).slice(0, 16384);
      const path = join(folder, name);
      await writeFile(path, content);
      fileCases.push({ name, marker, path, bytes: Buffer.byteLength(content) });
    }
    report.conditions = { ...report.conditions,
      workload: `${options.runs} distinct previously unopened 16 KiB plain-text files; editor and filesystem caches are separate`,
      clock: 'Renderer performance.now from trusted pointerdown on the file row through correct content and the next animation frame',
      limitations: 'Plain-text baseline: syntax parsing, LSP, large files, cold disk and remote files require separate workloads. OS filesystem caches are not flushed.' };
  }
  const warmup = await launch();
  await warmup.page.getByRole('button', { name: 'Open a local folder', exact: true }).waitFor();
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
  await warmup.page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', { detail: 'open-local-folder' })));
  const tree = warmup.page.getByLabel('Workspace file tree');
  await tree.getByText('module-000', { exact: true }).waitFor();
  // Folders sort before files; scroll the virtualized tree to the root README.
  await tree.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await tree.getByText('README.md', { exact: true }).click();
  await editorReady(warmup.page);
  await warmup.page.waitForFunction(path => {
    const last = JSON.parse(localStorage.getItem('coloride.session.last.v1') || '{}');
    return last.profileId === 'local' && last.selectedPath === path;
  }, join(project, 'README.md'));
  await readRuntime();
  const expectedPid = hostPid();
  report.warmupMs = performance.now() - warmup.started;
  if (options.scenario === 'file-open') {
    const page = warmup.page;
    await tree.evaluate(element => { element.scrollTop = 0; });
    await tree.getByText('benchmark-files', { exact: true }).click();
    await tree.getByText(fileCases[0].name, { exact: true }).click();
    await page.waitForFunction(marker => document.querySelector('.cm-content')?.textContent.includes(marker), fileCases[0].marker);
    let profiler;
    if (options.profile) {
      profiler = await page.context().newCDPSession(page);
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.start');
      report.conditions.cpuProfilerEnabled = true;
    }
    const requests = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/files/read')) requests.push(request.postDataJSON()?.path);
    });
    for (const [index, file] of fileCases.slice(1).entries()) {
      await page.evaluate(file => {
        window.__fileOpenResult = null;
        const listener = event => {
          if (event.target.closest('[data-tree-path]')?.getAttribute('data-tree-path') !== file.path) return;
          document.removeEventListener('pointerdown', listener, true);
          const started = performance.now();
          const trusted = event.isTrusted;
          const check = () => {
            const editor = document.querySelector('.cm-content[contenteditable="true"]');
            const rect = editor?.getBoundingClientRect();
            const hit = rect && document.elementFromPoint(rect.left + 8, rect.top + 8);
            if (editor?.textContent.includes(file.marker) && editor.checkVisibility() && hit && editor.contains(hit)) {
              const domReadyMs = performance.now() - started;
              requestAnimationFrame(() => {
                window.__fileOpenResult = { durationMs: performance.now() - started, domReadyMs, trusted,
                  resources: performance.getEntriesByType('resource').filter(entry => entry.startTime >= started && entry.name.includes('/api/files/')).map(entry => ({ route: new URL(entry.name).pathname, startMs: entry.startTime - started, durationMs: entry.duration })) };
              });
            } else if (performance.now() - started > 10000) {
              window.__fileOpenResult = { error: 'Correct editable content did not appear within 10 seconds.' };
            } else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        };
        document.addEventListener('pointerdown', listener, true);
      }, file);
      const requestOffset = requests.length;
      await tree.getByText(file.name, { exact: true }).click();
      await page.waitForFunction(() => window.__fileOpenResult !== null, null, { polling: 'raf', timeout: 15000 });
      const measured = await page.evaluate(() => window.__fileOpenResult);
      assert(!measured.error, measured.error);
      assert(measured.trusted, 'The benchmark must start from a real pointer input.');
      const reads = requests.slice(requestOffset).filter(path => path === file.path).length;
      assert(reads > 0, 'Opening must read the file through the production API, not reuse an editor buffer.');
      const sample = { run: index + 1, file: file.name, bytes: file.bytes, reads, ...measured };
      samples.push(sample);
      console.log(`File open ${index + 1}/${options.runs}: ${sample.durationMs.toFixed(1)} ms (DOM ${sample.domReadyMs.toFixed(1)} ms)`);
      if (index === 0) await page.screenshot({ path: join(sandbox, 'editor-ready.png') });
    }
    if (profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output + '.cpuprofile', JSON.stringify(profile));
      await profiler.detach();
    }
    assert.equal(hostPid(), expectedPid, 'Fixture host unexpectedly restarted.');
  } else {
    await app.close(); app = null;
    for (let index = 0; index < options.runs; index++) {
      const { page, started, attachedMs } = await launch();
      await editorReady(page);
      const editorReadyMs = performance.now() - started;
      const editor = page.locator('.cm-content[contenteditable="true"]').first();
      await editor.click();
      await page.keyboard.insertText(marker);
      await page.waitForFunction(text => document.querySelector('.cm-content')?.textContent.includes(text), marker, { polling: 'raf' });
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const durationMs = performance.now() - started;
      await readRuntime();
      assert.equal(hostPid(), expectedPid, 'Warm-start fixture host unexpectedly restarted.');
      const sample = { run: index + 1, durationMs, attachedMs, editorReadyMs };
      samples.push(sample);
      console.log(`Warm startup ${index + 1}/${options.runs}: ${durationMs.toFixed(1)} ms (editor ${editorReadyMs.toFixed(1)} ms)`);
      if (index === 0) await page.screenshot({ path: join(sandbox, 'editor-ready.png') });
      // Restore a known saved fixture outside the timed interval.
      await editor.fill(original);
      await page.waitForFunction(text => !document.querySelector('.cm-content')?.textContent.includes(text), marker, { polling: 'raf' });
      await editor.press('Meta+s');
      await expect.poll(() => readFile(join(project, 'README.md'), 'utf8')).toBe(original);
      await app.close(); app = null;
    }
  }
  const sorted = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
  report.summary = { minMs: sorted[0], medianMs: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
  report.status = report.summary.p95Ms <= options.budgetMs ? 'passed' : 'failed';
  console.log(`${report.status.toUpperCase()}: p95 ${report.summary.p95Ms.toFixed(1)} ms / ${options.budgetMs} ms budget`);
  if (report.status === 'failed') process.exitCode = 1;
} catch (error) {
  report.status = 'error'; report.error = error.stack || String(error);
  try { await app?.windows().at(-1)?.screenshot({ path: join(sandbox, 'editor-ready.png') }); } catch {}
  try { report.renderer = await app?.windows().at(-1)?.evaluate(() => ({ title: document.title, editor: document.querySelector('.cm-content')?.outerHTML, text: document.body.innerText.slice(-1500) })); } catch {}
  console.error(report.error); process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  if (!runtime) { try { await readRuntime(); } catch {} }
  if (runtime) {
    try {
      const pid = hostPid();
      process.kill(pid, 'SIGTERM');
      // A closed listener does not prove detached background tasks have exited.
      await new Promise(done => setTimeout(done, 250));
      try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ }
    } catch {}
  }
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${options.output}`);
  // Screenshot retained alongside the report, outside the timed interval.
  try { await writeFile(options.output.replace(/\.json$/, '') + '.png', await readFile(join(sandbox, 'editor-ready.png'))); } catch {}
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
