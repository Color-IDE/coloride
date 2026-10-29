// Prepare a reproducible cross-editor experiment. Never substitute DOM timing for pixels.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { comparisonSchedule } from './protocol.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { resolveTestPython } = createRequire(import.meta.url)('../support/python.cjs');
const output = resolve(process.argv[2] ?? join(root, 'artifacts/performance/comparison'));
assert.equal(process.platform, 'darwin', 'The native visual protocol currently targets macOS.');
await mkdir(output, { recursive: true });
// Keep the workload outside this repository: otherwise editors can discover
// its ancestor .git and include unrelated repository work in the measurement.
const project = await realpath(await mkdtemp(join(os.tmpdir(), 'coloride-comparison-fixture-')));
const files = [];
for (let id = 0; id <= 20; id++) {
  const name = `${String(id).padStart(3, '0')}-${id ? 'sample' : 'warmup'}.txt`;
  const marker = `COLORIDE_FILE_OPEN_${String(id).padStart(3, '0')}`;
  const content = Buffer.from((marker + '\n' + 'Ordinary local text file for editor opening latency.\n'.repeat(400)).slice(0, 16384));
  const path = join(project, name);
  await writeFile(path, content);
  files.push({ id, name, marker, path, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
}
const schedule = comparisonSchedule();
// VS Code's macOS IPC socket lives below user-data and has a 103-byte limit.
// Repository-local profiles can exceed that even before adding the socket name.
const profileRoot = await realpath(await mkdtemp('/tmp/cide-bench-'));
const settings = {
  coloride: { theme: 'dark', codeFontFamily: 'menlo', codeFontSize: 16, editorMinimap: false, editorWordWrap: 'off',
    editorAutoSave: false, checkForUpdatesAutomatically: false, editorInlayHints: false },
  vscode: { 'workbench.colorTheme': 'Default Dark Modern', 'editor.fontFamily': 'Menlo', 'editor.fontSize': 16,
    'editor.minimap.enabled': false, 'editor.wordWrap': 'off', 'files.autoSave': 'off', 'telemetry.telemetryLevel': 'off',
    'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.ignoreRecommendations': true,
    'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'chat.disableAIFeatures': true,
    'git.enabled': false },
};
const versions = {
  coloride: { version: JSON.parse(await readFile(join(root, 'package.json'))).version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    build: 'checkout Electron + production renderer + source Python; not a packaged release',
    python: execFileSync(resolveTestPython(), ['--version'], { encoding: 'utf8' }).trim() },
  vscode: { version: execFileSync('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', ['--version'], { encoding: 'utf8' }).trim() },
};
for (const entry of schedule) {
  const profile = join(profileRoot, entry.profile);
  const home = join(profile, 'home');
  for (const folder of [home, join(profile, 'user-data'), join(profile, 'extensions')]) await mkdir(folder, { recursive: true });
  const settingsPath = entry.editor === 'vscode'
    ? join(profile, 'user-data/User/settings.json')
    : join(profile, 'desired-app-preferences.json');
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings[entry.editor], null, 2) + '\n');
  Object.assign(entry, { profile: resolve(profile), home: resolve(home), settingsPath: resolve(settingsPath),
    settingsVerifiedInApp: false, extensionsVerifiedInApp: false, status: 'pending' });
}
const displayData = JSON.parse(execFileSync('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' }));
const displays = displayData.SPDisplaysDataType.flatMap(gpu => (gpu.spdisplays_ndrvs ?? []).map(display => ({
  name: display._name, mode: display._spdisplays_resolution, pixels: display._spdisplays_pixels,
  main: display.spdisplays_main === 'spdisplays_yes', connection: display.spdisplays_connection_type,
})));
const toolDir = join(root, 'artifacts/performance/tools');
await mkdir(toolDir, { recursive: true });
const recorder = join(toolDir, 'native-capture');
execFileSync('/usr/bin/swiftc', ['-O', join(root, 'tests/electron/benchmarks/native-capture.swift'), '-o', recorder]);
const permissions = JSON.parse(execFileSync(recorder, ['--check'], { encoding: 'utf8' }));
const plan = {
  protocol: 'cross-editor-visible-file-open-v1', createdAt: new Date().toISOString(),
  status: permissions.screenRecording && permissions.accessibility ? 'prepared-needs-verified-editor-adapters' : 'blocked-permissions',
  editors: versions, environment: { platform: os.platform(), osRelease: os.release(),
    osVersion: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
    osBuild: execFileSync('/usr/bin/sw_vers', ['-buildVersion'], { encoding: 'utf8' }).trim(),
    arch: os.arch(), cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), displays },
  design: { rounds: 2, filesPerRound: 20, samplesPerEditor: 40, order: 'both editor orders; one appearance per position',
    fileOrder: 'rotated by round, identical across both editors within a round',
    independentRuns: 'new profile, new application process and no measured files opened before each execution',
    cache: 'warm OS filesystem cache, not flushed; application buffers are fresh; files remain byte-identical',
    warmup: 'only 000-warmup.txt may be opened before timing',
    window: 'same display, 1400×900 logical points, fixed crop at native scale; verify before each execution',
    services: 'plain text, no accounts, no active AI or LSP, no external extensions, minimap and wrapping off, Menlo 16; record all built-in services and process roots',
    failurePolicy: 'retain failed/timed-out samples and invalidate the comparison; never silently drop outliers',
    measurement: 'trusted native mouse-down to first matching visible ScreenCaptureKit frame; offline OCR; same capture helper for all editors',
    statistics: 'nearest-rank p50/p95/p99 pooled and per independent run, retain every sample and frame gap',
    resources: 'same process-tree sampler for every editor, include the ColorIDE Python host, 2-second idle baseline and active block; summed RSS and CPU-time deltas at 250 ms',
    limitations: ['40 samples give a coarse p99 estimate; report per-run variability and frame quantization.',
      'RSS sums can double-count shared memory; report this limitation instead of calling it unique physical RAM.',
      'The ColorIDE checkout is not a packaged release. Do not claim release-to-release superiority.'] },
  permissions, recorder, files, settings, schedule, profileRoot,
  isolation: { verified: false, note: 'Verify a separate editor process and profile. Never close or attach fixtures to the user’s existing instance automatically.' },
  prerequisites: ['Screen Recording and Accessibility granted to the recording process',
    'Editor adapters must verify isolated profile, built-in services, screen/window geometry and first-line crop',
    'Native click/frame clocks and OCR must be validated on a known visible transition before the first timed block'],
  results: [],
};
await writeFile(join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
console.log(`Prepared ${schedule.length} independent executions: 40 openings/editor, 80 total.`);
console.log(`Plan: ${join(output, 'plan.json')}`);
console.log(`Status: ${plan.status}. No editor comparison has been executed.`);
