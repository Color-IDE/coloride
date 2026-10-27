import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unusedJavaScript } from '../../../../../tooling/checks/audit-source.mjs';

test('desktop audit reports private dead helpers and preserves CommonJS exports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coloride-js-audit-'));
  try {
    const file = join(directory, 'fixture.cjs');
    writeFileSync(file, 'function publicAction() { return 1; }\nfunction deadHelper() { return 2; }\nmodule.exports = {publicAction};');
    const findings = unusedJavaScript([file]);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /deadHelper/);
    assert.doesNotMatch(findings[0], /publicAction/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('desktop audit analyzes modules without executing their top-level code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coloride-js-audit-'));
  try {
    const file = join(directory, 'fixture.mjs');
    writeFileSync(file, 'throw new Error("Never execute this audit fixture");\nexport function registeredHandler() { return 1; }');
    assert.deepEqual(unusedJavaScript([file]), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
