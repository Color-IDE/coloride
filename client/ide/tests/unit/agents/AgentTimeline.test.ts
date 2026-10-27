import assert from 'node:assert/strict';
import { test } from 'node:test';
(globalThis as any).window = {};
const { buildAgentTimeline } = await import('../../../src/features/agents/AgentTimeline');
const { presentTurnItems } = await import('../../../src/features/agents/presentAgentTimeline');

test('retry replaces provisional narration without adding a heartbeat thinking row', () => {
  let sequence = 0;
  const event = (type: string, data: object) => ({type, data, id: `e${++sequence}`, sequence, createdAt: '2026-09-25T11:00:00Z'} as any);
  const events = [
    event('tool_call', {itemId: 'r1', tool: 'read_file'}),
    event('tool_call', {itemId: 'r2', tool: 'read_file'}),
    event('activity', {activityId: 'a', state: 'running'}),
    event('text_delta', {activityId: 'a', text: 'Provisional'}),
    event('activity', {activityId: 'a', state: 'running', heartbeat: true}),
    event('text_delta', {activityId: 'a', text: 'Recovered'}),
    event('text_replace', {activityId: 'a', text: 'Recovered'}),
    event('activity', {activityId: 'a', state: 'completed'}),
    event('tool_call', {itemId: 'w', tool: 'replace_in_file'}),
  ];
  const items = presentTurnItems(buildAgentTimeline(events), 'normal', true);
  assert.deepEqual(items.map(x => x.kind), ['explore_group', 'assistant', 'tool']);
  assert.equal((items[1] as any).text, 'Recovered');
  assert.deepEqual(buildAgentTimeline(events), buildAgentTimeline(JSON.parse(JSON.stringify(events))));
});

test('identical chunks within one stream are preserved rather than deduplicated by text', () => {
  const events = [1, 2].map(sequence => ({id: String(sequence), sequence, type: 'text_delta', data: {text: 'ha', activityId: 'a'}} as any));
  assert.equal((buildAgentTimeline(events)[0] as any).text, 'haha');
});


test('heartbeats and completion do not split punctuation or paragraphs', () => {
  let sequence = 0;
  const event = (type: string, data: object) => ({type, data, id: `e${++sequence}`, sequence, createdAt: '2026-09-26T11:00:00Z'} as any);
  const events = [
    event('activity', {activityId: 'a', state: 'running'}),
    event('reasoning_delta', {activityId: 'a', text: 'Checking the code'}),
    event('text_delta', {activityId: 'a', text: 'The pipeline is correct'}),
    event('activity', {activityId: 'a', state: 'running', heartbeat: true}),
    event('text_delta', {activityId: 'a', text: '. The order'}),
    event('activity', {activityId: 'a', state: 'running', heartbeat: true}),
    event('activity', {activityId: 'a', state: 'completed', durationMs: 36000}),
    event('text_delta', {activityId: 'a', text: ' matters.'}),
    event('activity', {activityId: 'a', state: 'running', heartbeat: true}),
  ];
  const entries = buildAgentTimeline(events);
  assert.equal(entries.filter(x => x.kind === 'assistant').length, 1);
  assert.equal((entries.find(x => x.kind === 'assistant') as any).text, 'The pipeline is correct. The order matters.');
  const activities = entries.flatMap((x: any) => x.kind === 'explore_group' ? x.items : [x]).filter(x => x.kind === 'activity');
  assert.equal(activities.length, 1);
  assert.equal(activities[0].state, 'completed');
  assert.equal(activities[0].durationMs, 36000);
  assert.equal(activities[0].detail, 'Checking the code');
  assert.deepEqual(buildAgentTimeline(JSON.parse(JSON.stringify(events))), entries);
});

test('a new model step still separates narration from its next answer', () => {
  const events = [
    {type: 'activity', data: {activityId: 'a', state: 'running'}},
    {type: 'text_delta', data: {activityId: 'a', text: 'I will inspect it.'}},
    {type: 'activity', data: {activityId: 'a', state: 'completed'}},
    {type: 'tool_call', data: {itemId: 'read', tool: 'read_file'}},
    {type: 'activity', data: {activityId: 'b', state: 'running'}},
    {type: 'text_delta', data: {activityId: 'b', text: 'Here is the result.'}},
  ].map((e, i) => ({...e, id: String(i), sequence: i + 1, createdAt: '2026-09-26T11:00:00Z'} as any));
  assert.deepEqual(buildAgentTimeline(events).filter(x => x.kind === 'assistant').map((x: any) => x.text), ['I will inspect it.', 'Here is the result.']);
});

test('file_write_delta streams replace_in_file oldText/newText and reconciles with final tool_call', () => {
  const events = [
    {
      type: 'file_write_delta',
      data: {
        itemId: 'fc_temp_1',
        tool: 'replace_in_file',
        path: 'src/index.ts',
        oldText: 'const x = 1;',
        newText: 'const x = 2;\nconst y = 3;',
        phase: 'streaming',
      },
    },
    {
      type: 'tool_call',
      data: {
        itemId: 'call_final_1',
        tool: 'replace_in_file',
        title: 'Edit file',
        arguments: {
          path: 'src/index.ts',
          old_text: 'const x = 1;',
          new_text: 'const x = 2;\nconst y = 3;\nconst z = 4;',
        },
      },
    },
  ].map((e, i) => ({...e, id: `w${i}`, sequence: i + 1, createdAt: '2026-10-17T12:00:00Z'} as any));

  const timeline = buildAgentTimeline(events);
  const tools = timeline.filter(x => x.kind === 'tool') as any[];
  assert.equal(tools.length, 1);
  assert.equal(tools[0].itemId, 'call_final_1');
  assert.equal(tools[0].metadata.streamedOldText, 'const x = 1;');
  assert.equal(tools[0].metadata.streamedNewText, 'const x = 2;\nconst y = 3;\nconst z = 4;');
});
