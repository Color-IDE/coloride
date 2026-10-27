import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export const EDITORS = ['coloride', 'vscode', 'zed'];
export function comparisonSchedule() {
  // All six permutations balance each editor's position and preceding editor.
  const orders = [
    ['coloride', 'vscode', 'zed'], ['vscode', 'zed', 'coloride'],
    ['zed', 'coloride', 'vscode'], ['coloride', 'zed', 'vscode'],
    ['zed', 'vscode', 'coloride'], ['vscode', 'coloride', 'zed'],
  ];
  return orders.flatMap((order, round) => order.map((editor, position) => ({
    round: round + 1, position: position + 1, editor, samples: 20,
    profile: `${editor}/round-${round + 1}`,
    fileOrder: Array.from({ length: 20 }, (_, index) => (index + round * 3) % 20 + 1),
  })));
}
export function distribution(values) {
  assert(values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0), 'Invalid sample distribution');
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
  return { count: sorted.length, min: sorted[0], p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1), method: 'nearest-rank' };
}
export function parseCpuSeconds(value) {
  const [days, clock] = value.includes('-') ? value.split('-') : ['0', value];
  const parts = clock.split(':').map(Number);
  assert(parts.length >= 2 && parts.length <= 3 && parts.every(Number.isFinite), `Invalid process CPU time: ${value}`);
  return Number(days) * 86400 + parts.reverse().reduce((sum, part, index) => sum + part * 60 ** index, 0);
}
export function processTree(rows, roots) {
  const included = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (included.has(row.ppid) && !included.has(row.pid)) { included.add(row.pid); changed = true; }
  }
  return rows.filter(row => included.has(row.pid));
}
export async function sampleProcesses(roots) {
  // No process command lines, environment variables or unrelated process data are retained.
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,rss=,time=']);
  const rows = stdout.trim().split('\n').map(line => {
    const [pid, ppid, rss, cpu] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), rssBytes: Number(rss) * 1024, cpuSeconds: parseCpuSeconds(cpu) };
  });
  return { timeSeconds: Number(process.hrtime.bigint()) / 1e9, processes: processTree(rows, roots) };
}
export async function startResourceSampler(roots, intervalMs = 250) {
  assert(roots.length && roots.every(pid => Number.isInteger(pid) && pid > 0), 'Fixture process roots required');
  const snapshots = [];
  let stopped = false, phase = 'idle', timer, pending;
  const poll = async () => {
    const snapshot = await sampleProcesses(roots);
    snapshots.push({ phase, ...snapshot });
    if (!stopped) timer = setTimeout(() => { pending = poll(); }, intervalMs);
  };
  pending = poll(); await pending;
  return {
    markPhase(next) { phase = next; },
    async stop() {
      stopped = true; clearTimeout(timer); await pending;
      const summary = {};
      for (const name of new Set(snapshots.map(snapshot => snapshot.phase))) {
        const rss = snapshots.filter(snapshot => snapshot.phase === name).map(snapshot => snapshot.processes.reduce((sum, row) => sum + row.rssBytes, 0));
        const intervals = [];
        for (let index = 1; index < snapshots.length; index++) {
          const previous = snapshots[index - 1], current = snapshots[index];
          if (previous.phase !== name || current.phase !== name) continue;
          const earlier = new Map(previous.processes.map(row => [row.pid, row.cpuSeconds]));
          const cpuSeconds = current.processes.reduce((sum, row) => sum + Math.max(0, row.cpuSeconds - (earlier.get(row.pid) ?? 0)), 0);
          const wallSeconds = current.timeSeconds - previous.timeSeconds;
          intervals.push({ cpuSeconds, wallSeconds, percentOfOneCore: cpuSeconds / wallSeconds * 100 });
        }
        summary[name] = { rssBytes: distribution(rss), cpu: intervals.length ? {
          meanPercentOfOneCore: intervals.reduce((sum, row) => sum + row.cpuSeconds, 0) / intervals.reduce((sum, row) => sum + row.wallSeconds, 0) * 100,
          intervalPercent: distribution(intervals.map(row => row.percentOfOneCore)),
        } : null };
      }
      return { intervalMs, roots, snapshots, summary,
        method: 'Summed process-tree RSS (shared memory may be counted more than once); observed process CPU-time deltas, 100% = one core. Short-lived processes between samples may be missed. Recorder and automation processes are excluded.' };
    },
  };
}
export function visualSamples(capture, cases, fileOrder) {
  assert(capture.clicks.length === fileOrder.length, 'Exactly one observed click per file is required');
  assert(capture.frames.length > 1, 'Visual frame evidence required');
  const normalize = text => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const frames = [...capture.frames].sort((a, b) => a.timeSeconds - b.timeSeconds);
  return capture.clicks.map((click, index) => {
    const file = cases.find(item => item.id === fileOrder[index]);
    assert(file, 'Unknown fixture file');
    const before = frames.filter(frame => frame.timeSeconds <= click.timeSeconds).at(-1);
    assert(before, 'Capture must begin before the input event');
    assert(!normalize(before.text).includes(normalize(file.marker)), 'Target content was already visible before the click');
    const nextClick = capture.clicks[index + 1]?.timeSeconds ?? Infinity;
    const after = frames.find(frame => frame.timeSeconds >= click.timeSeconds && frame.timeSeconds < nextClick && normalize(frame.text).includes(normalize(file.marker)));
    assert(after, `No matching visible frame for file ${file.id}; do not discard this sample`);
    const previousFrame = frames.filter(frame => frame.timeSeconds < after.timeSeconds).at(-1);
    return { fileId: file.id, sha256: file.sha256, durationMs: (after.timeSeconds - click.timeSeconds) * 1000,
      frameGapMs: previousFrame ? (after.timeSeconds - previousFrame.timeSeconds) * 1000 : null,
      frame: after.frame, clickTimeSeconds: click.timeSeconds, visibleTimeSeconds: after.timeSeconds };
  });
}
export function summarizeComparison(executions) {
  const schedule = comparisonSchedule();
  assert.equal(executions.length, schedule.length, 'All 18 scheduled executions are required; partial runs cannot rank editors');
  assert.equal(new Set(executions.map(run => run.profile)).size, executions.length, 'Each execution requires a fresh profile');
  const environments = new Set(executions.map(run => run.environmentFingerprint));
  assert(environments.size === 1 && !environments.has(undefined), 'Machine, OS, screen and window geometry must match');
  for (const expected of schedule) {
    const run = executions.find(run => run.editor === expected.editor && run.round === expected.round);
    assert(run && run.method === 'native-visible-frame-v1', 'Missing execution or incompatible visual measurement');
    assert(run.configurationVerified && run.captureCalibrated, 'Runtime configuration and capture clocks must be verified');
    assert.equal(run.samples.length, 20, 'Each execution must retain all 20 first openings');
    assert.deepEqual(run.samples.map(sample => sample.fileId), expected.fileOrder, 'Unexpected file order');
    assert(run.resources?.summary?.active?.cpu, 'Active CPU and memory evidence required');
    const peer = executions.find(other => other.round === run.round);
    for (const sample of run.samples) {
      const corresponding = peer.samples.find(other => other.fileId === sample.fileId);
      assert(sample.sha256 && corresponding?.sha256 === sample.sha256, 'Editors must open byte-identical files');
      assert(Number.isFinite(sample.frameGapMs), 'Frame quantization must be reported');
    }
  }
  return Object.fromEntries(EDITORS.map(editor => {
    const runs = executions.filter(run => run.editor === editor);
    const samples = runs.flatMap(run => run.samples);
    assert(samples.length >= 100, 'At least 100 samples per editor');
    return [editor, { latencyMs: distribution(samples.map(sample => sample.durationMs)),
      perRun: runs.map(run => ({ round: run.round, latencyMs: distribution(run.samples.map(sample => sample.durationMs)),
        resources: run.resources.summary, profile: run.profile })),
      frameGapsMs: distribution(samples.map(sample => sample.frameGapMs)),
    }];
  }));
}
