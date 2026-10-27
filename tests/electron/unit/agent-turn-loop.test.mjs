import test from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, validateArguments } from '../../../client/desktop/src/agent-runtime/turn-loop.mjs';
const config = { tools: [{ name: 'edit', parameters: { type: 'object' } }], retryDelayMs: 0 };
const signal = () => new AbortController().signal;

test('does not echo text already streamed by the provider', async () => {
  const emitted = [];
  const result = await runTurn(config, async () => ({ text: 'Answer', streamed: true }), (...args) => emitted.push(args), signal());
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Answer');
  assert.deepEqual(emitted, []);
});

test('cancellation during a callback prevents subsequent effects', async () => {
  const controller = new AbortController();
  const ops = [];
  await assert.rejects(runTurn(config, async op => {
    ops.push(op);
    controller.abort('Stopped');
    return { tool_calls: [{ call_id: 'a', name: 'edit', arguments: {} }] };
  }, () => {}, controller.signal), /Stopped/);
  assert.deepEqual(ops, ['model']);
});

test('unknown tools receive results without reaching the execution callback', async () => {
  let model = 0;
  const ops = [];
  const result = await runTurn(config, async (op, payload) => {
    ops.push(op);
    if (op === 'model') return ++model === 1 ? { tool_calls: [{ call_id: 'a', name: 'unknown', arguments: {} }] } : { text: 'Blocked' };
    assert.equal(payload.skipped, true);
    assert.equal(payload.failed, true);
    return {};
  }, () => {}, signal());
  assert.equal(result.status, 'completed');
  assert.deepEqual(ops, ['model', 'tool-result', 'model']);
});

test('empty model responses cannot silently complete a turn', async () => {
  let requests = 0;
  const result = await runTurn(config, async () => { requests++; return {}; }, () => {}, signal());
  assert.equal(result.status, 'failed');
  assert.equal(requests, 4);
});

test('completion evidence remains required after mutations', async () => {
  const result = await runTurn(config, async () => ({ text: 'Done', completionRequired: true }), () => {}, signal());
  assert.equal(result.status, 'failed');
  assert.match(result.error, /not verified/);
});

test('validates required and nested arguments', () => {
  const schema = { type: 'object', required: ['path'], properties: { path: { type: 'string' }, lines: { type: 'array', items: { type: 'integer' } } } };
  assert.match(validateArguments({}, schema), /Missing required/);
  assert.match(validateArguments({ path: 'x', lines: ['wrong'] }, schema), /Invalid type/);
  assert.equal(validateArguments({ path: 'x', lines: [1] }, schema), '');
});
