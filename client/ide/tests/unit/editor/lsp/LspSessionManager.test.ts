import assert from 'node:assert/strict';
import test from 'node:test';

// Bundle with esbuild (platform=node, format=esm) before running node --test.
(globalThis as any).window = { setTimeout, clearTimeout };
const { api } = await import('../../../../src/shared/api/client');
const { LspClient } = await import('../../../../src/features/editor/lsp/LspClient');
const { LspSessionManagerImpl } = await import('../../../../src/features/editor/lsp/LspSessionManager');

test('compilation config refresh reopens unsaved buffers once and rejects old diagnostics', async () => {
  let signature = 'missing';
  let starts = 0;
  let stops = 0;
  let failStat = false;
  const sent: Array<{ session: string; method: string; params: any }> = [];
  const clients: any[] = [];
  const originals = { start: api.lspStart, stop: api.lspStop, stat: api.statFiles,
    initialize: LspClient.prototype.initialize, notify: LspClient.prototype.notify,
    dispose: LspClient.prototype.dispose, ready: Object.getOwnPropertyDescriptor(LspClient.prototype, 'isReady')! };
  api.statFiles = async (paths) => {
    if (failStat) throw Error('temporary disconnection');
    return { entries: (paths as string[]).map(path => ({path, exists: signature !== 'missing', etag: signature})) };
  };
  api.lspStart = async () => ({sessionId: String(++starts), rootPath: '/project', language: 'cpp'} as any);
  LspClient.prototype.initialize = async function () { this.initialized = true; clients.push(this); };
  Object.defineProperty(LspClient.prototype, 'isReady', { configurable: true, get() { return this.initialized; } });
  LspClient.prototype.notify = async function (method, params) { sent.push({session: (this as any).sessionId, method, params}); };
  LspClient.prototype.dispose = async function () { this.initialized = false; stops++; await new Promise(r => setTimeout(r, 5)); };
  const manager = new LspSessionManagerImpl();
  let markers: any[] = [];
  manager.configure({connected: true, rootPath: '/project'});
  manager.registerEditor('/project/src/main.cpp', {setMarkers: (_: string, value: any[]) => { markers = value; }, clearMarkers: () => {markers = [];} } as any);
  const publish = (client: any, message: string) => {
    for (const handler of client.notificationHandlers) handler('textDocument/publishDiagnostics', {
      uri: 'file:///project/src/main.cpp', diagnostics: [{severity: 1, message}],
    });
  };
  try {
    await manager.didOpen('/project/src/main.cpp', 'int main() {}');
    publish(clients[0], 'header missing');
    assert.equal(markers.length, 1);
    manager.didChange('/project/src/main.cpp', 'int main() { unsaved; }');
    signature = 'new flags';
    await Promise.all([manager.refreshCppConfiguration(), manager.refreshCppConfiguration()]);
    assert.equal(starts, 2);
    assert.equal(stops, 1);
    assert.equal(markers.length, 0);
    assert.equal(sent.filter(x => x.session === '2' && x.method === 'textDocument/didOpen')[0].params.textDocument.text, 'int main() { unsaved; }');
    publish(clients[0], 'late stale error');
    assert.equal(markers.length, 0);
    publish(clients[1], 'real unsaved error');
    assert.equal(markers[0].message, 'real unsaved error');
    await manager.refreshCppConfiguration();
    assert.equal(starts, 2);
    failStat = true;
    await manager.refreshCppConfiguration();
    assert.equal(starts, 2);
    failStat = false;
    signature = 'missing';
    await manager.refreshCppConfiguration();
    assert.equal(starts, 3, 'deleting config must also restart');
  } finally {
    manager.disposeAll();
    api.lspStart = originals.start; api.lspStop = originals.stop; api.statFiles = originals.stat;
    LspClient.prototype.initialize = originals.initialize;
    LspClient.prototype.notify = originals.notify;
    LspClient.prototype.dispose = originals.dispose;
    Object.defineProperty(LspClient.prototype, 'isReady', originals.ready);
  }
});
