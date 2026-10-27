import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonSchedule, distribution, parseCpuSeconds, processTree, startResourceSampler, visualSamples } from './protocol.mjs';
test('the comparison balances editor positions and uses 120 first opens per editor in fresh profiles', () => {
  const schedule = comparisonSchedule();
  assert.equal(new Set(schedule.map(row => row.profile)).size, 18);
  for (let i = 1; i < schedule.length; i++) assert.notEqual(schedule[i - 1].editor, schedule[i].editor);
  for (const editor of ['coloride', 'vscode', 'zed']) {
    const entries = schedule.filter(row => row.editor === editor);
    assert.equal(entries.reduce((sum, row) => sum + row.samples, 0), 120);
    for (const position of [1, 2, 3]) assert.equal(entries.filter(row => row.position === position).length, 2);
    for (const entry of entries) assert.deepEqual([...entry.fileOrder].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  }
  for (let round = 1; round <= 6; round++) assert.equal(new Set(schedule.filter(row => row.round === round).map(row => row.fileOrder.join(','))).size, 1);
});
test('latency percentiles preserve outliers and CPU time supports long-lived processes', () => {
  const stats = distribution(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual([stats.p50, stats.p95, stats.p99, stats.max], [50, 95, 99, 100]);
  assert.equal(parseCpuSeconds('1-02:03:04.50'), 93784.5);
  assert.throws(() => distribution([NaN]));
});
test('resource collection includes the fixture descendants but excludes unrelated apps', async () => {
  const rows = [{ pid: 1, ppid: 0 }, { pid: 2, ppid: 1 }, { pid: 3, ppid: 2 }, { pid: 9, ppid: 0 }];
  assert.deepEqual(processTree(rows, [1]).map(row => row.pid), [1, 2, 3]);
  const sampler = await startResourceSampler([process.pid], 50);
  await new Promise(done => setTimeout(done, 130));
  const result = await sampler.stop();
  assert(result.snapshots.length >= 2);
  assert(result.summary.idle.rssBytes.p50 > 0);
  assert(Number.isFinite(result.summary.idle.cpu.meanPercentOfOneCore));
});
test('a visual result needs matching post-click pixels and cannot use stale content', () => {
  const cases = [{ id: 1, marker: 'COLORIDE_FILE_OPEN_001', sha256: 'fixture' }];
  const capture = { clicks: [{ timeSeconds: 10 }], frames: [{ frame: 0, timeSeconds: 9.99, text: 'warmup' }, { frame: 1, timeSeconds: 10.05, text: 'COLORIDE_FILE_OPEN_001' }] };
  assert(Math.abs(visualSamples(capture, cases, [1])[0].durationMs - 50) < .001);
  assert.throws(() => visualSamples({ ...capture, frames: capture.frames.map(frame => ({ ...frame, text: cases[0].marker })) }, cases, [1]));
  assert.throws(() => visualSamples({ ...capture, clicks: [] }, cases, [1]));
});
test('comparative summaries refuse partial or renderer-only evidence', async () => {
  const { summarizeComparison } = await import('./protocol.mjs');
  assert.throws(() => summarizeComparison([]), /All 18/);
  const schedule = comparisonSchedule();
  assert.throws(() => summarizeComparison(schedule.map(run => ({ ...run, environmentFingerprint: 'one-machine' }))), /incompatible visual measurement/);
});
