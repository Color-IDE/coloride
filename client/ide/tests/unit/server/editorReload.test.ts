import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
(globalThis as any).window = {};
const { api } = await import('../../../src/shared/api/client');
const { createWorkspaceEditorReload } = await import('../../../src/features/server/workspace/createWorkspaceEditorReload');
import type { EditorBuffer } from '../../../src/features/server/workspace/types';

const originalRead = api.readFile;
afterEach(() => { api.readFile = originalRead; });
const ignore = () => { };
const buffer = (value: string, dirty = false): EditorBuffer => ({ value, dirty, error: '', etag: 'old', imageUrl: null, truncated: false });
function fixture() {
  let value = 'initial';
  const dependencies: Parameters<typeof createWorkspaceEditorReload>[0] = {
    workspacePathRef: { current: '/one' }, connectionStateRef: { current: 'connected' },
    editorBuffersRef: { current: new Map([['/one/a.ts', buffer(value)]]) },
    selectedFileRef: { current: '/one/a.ts' }, editorDirtyRef: { current: false },
    editorLoadRequestRef: { current: 0 },
    setEditorValue: next => { value = typeof next === 'function' ? next(value) : next; },
    setEditorError: ignore, setEditorImageUrl: ignore, setEditorEtag: ignore,
    setEditorDirty: ignore, setEditorTruncated: ignore, setEditorLoading: ignore,
    setDirtyFiles: ignore, setMissingFiles: ignore, handleConnectionUnavailable() { },
    reloadEditorFromRemoteRef: { current: async () => false },
  };
  let resolve!: (value: Awaited<ReturnType<typeof api.readFile>>) => void;
  api.readFile = () => new Promise(done => { resolve = done; });
  const { reloadEditorFromRemote } = createWorkspaceEditorReload(dependencies);
  return {
    dependencies, reloadEditorFromRemote, value: () => value,
    finish: () => resolve({ path: '/one/a.ts', content: Buffer.from('disk').toString('base64'), etag: 'new', truncated: false })
  };
}

test('late external read cannot replace a newer workspace buffer', async () => {
  const f = fixture();
  const pending = f.reloadEditorFromRemote('/one/a.ts');
  f.dependencies.workspacePathRef.current = '/two';
  f.dependencies.editorBuffersRef.current = new Map([['/two/b.ts', buffer('second')]]);
  f.finish();
  assert.equal(await pending, false);
  assert.equal(f.value(), 'initial');
  assert.deepEqual([...f.dependencies.editorBuffersRef.current.keys()], ['/two/b.ts']);
});

test('typing while an external read is pending preserves unsaved content', async () => {
  const f = fixture();
  const pending = f.reloadEditorFromRemote('/one/a.ts');
  f.dependencies.editorDirtyRef.current = true;
  f.dependencies.editorBuffersRef.current.set('/one/a.ts', buffer('unsaved', true));
  f.finish();
  assert.equal(await pending, false);
  assert.equal(f.dependencies.editorBuffersRef.current.get('/one/a.ts')!.value, 'unsaved');
  assert.equal(f.dependencies.editorBuffersRef.current.get('/one/a.ts')!.dirty, true);
});

test('switching editor selection discards an obsolete active-file read', async () => {
  const f = fixture();
  const pending = f.reloadEditorFromRemote('/one/a.ts');
  f.dependencies.editorLoadRequestRef.current++;
  f.dependencies.selectedFileRef.current = '/one/b.ts';
  f.finish();
  assert.equal(await pending, false);
  assert.equal(f.value(), 'initial');
});

test('a clean current buffer receives the external disk content', async () => {
  const f = fixture();
  const pending = f.reloadEditorFromRemote('/one/a.ts');
  f.finish();
  assert.equal(await pending, true);
  assert.equal(f.value(), 'disk');
  assert.equal(f.dependencies.editorBuffersRef.current.get('/one/a.ts')!.etag, 'new');
});
