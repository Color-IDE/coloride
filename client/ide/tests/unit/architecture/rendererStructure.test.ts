import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { inspectRenderer } from '../../../../../tooling/checks/renderer-structure.mjs';
function check(files: Record<string, string>, entries: Record<string, string[]>) {
  const root = mkdtempSync(join(tmpdir(), 'coloride-structure-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text);
    }
    return inspectRenderer(root, entries);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('rejects private feature imports even when written as dynamic imports', () => {
  const errors = check({ 'app/main.ts': 'import("../features/a/private")', 'features/a/private.ts': 'export {}' }, { a: [] });
  assert.match(errors.join('\n'), /private feature import/);
});
test('accepts public entries and type-only reciprocal references', () => {
  assert.deepEqual(check({
    'features/a/index.ts': 'import type { B } from "../b"; export type A = string;',
    'features/b/index.ts': 'import type { A } from "../a"; export type B = string;'
  }, { a: ['index'], b: ['index'] }), []);
});
test('rejects runtime cycles through public entry points', () => {
  const errors = check({ 'features/a/index.ts': 'export * from "../b";', 'features/b/index.ts': 'export * from "../a";' }, { a: ['index'], b: ['index'] });
  assert.match(errors.join('\n'), /Runtime import cycle/);
});
test('shared modules cannot import a feature even through its public entry', () => {
  const errors = check({ 'shared/helper.ts': 'import "../features/a"', 'features/a/index.ts': 'export {}' }, { a: ['index'] });
  assert.match(errors.join('\n'), /shared must not depend/);
});
