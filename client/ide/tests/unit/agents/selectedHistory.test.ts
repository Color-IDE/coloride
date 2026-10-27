import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { AgentEvent, AgentSessionSummary } from '@coloride/contracts';
(globalThis as any).window = {};
const { api } = await import('../../../src/shared/api/client');
const { startSelectedHistoryLoad } = await import('../../../src/features/agents/useAgentSelectedHistory');
const originalPage = api.agentEventsPage, originalApprovals = api.agentApprovals;
afterEach(() => { api.agentEventsPage = originalPage; api.agentApprovals = originalApprovals; });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const loaded: string[] = [], errors: string[] = [];
  const pending = new Map<string, (events: AgentEvent[]) => void>();
  api.agentEventsPage = id => new Promise(resolve => pending.set(id, resolve));
  api.agentApprovals = async () => [];
  const dependencies: Parameters<typeof startSelectedHistoryLoad>[0] = {
    selectedSessionId: 'a', selectedSession: { sessionId: 'a' } as AgentSessionSummary,
    selectedSessionIdRef: { current: 'a' }, historyFetchGenRef: { current: 0 },
    bufferedEventsRef: { current: new Map() }, historyHydratedRef: { current: new Set() },
    historyHasOlderRef: { current: new Map() }, setHistoryHasOlder() { }, setHistoryLoading() { },
    rememberSessionEvents(id, events) { loaded.push(id); return events; }, setEvents() { },
    setError(value) { errors.push(String(value)); }, messageFromError: String,
  };
  return { dependencies, pending, loaded, errors };
}

test('rapid conversation changes accept only the newest history response', async () => {
  const f = fixture();
  startSelectedHistoryLoad(f.dependencies);
  startSelectedHistoryLoad({ ...f.dependencies, selectedSessionId: 'b', selectedSession: { sessionId: 'b' } as AgentSessionSummary });
  f.pending.get('b')!([]); await tick();
  f.pending.get('a')!([]); await tick();
  assert.deepEqual(f.loaded, ['b']);
  assert.equal(f.dependencies.historyHydratedRef.current.has('a'), false);
  assert.deepEqual(f.errors, []);
});

test('cleanup discards a response even if the same conversation stays selected', async () => {
  const f = fixture();
  const cancel = startSelectedHistoryLoad(f.dependencies);
  cancel!();
  f.pending.get('a')!([]); await tick();
  assert.deepEqual(f.loaded, []);
  assert.equal(f.dependencies.historyHydratedRef.current.size, 0);
});

test('a response cannot leak into a selection changed before effect cleanup', async () => {
  const f = fixture();
  startSelectedHistoryLoad(f.dependencies);
  f.dependencies.selectedSessionIdRef.current = null;
  f.pending.get('a')!([]); await tick();
  assert.deepEqual(f.loaded, []);
});
