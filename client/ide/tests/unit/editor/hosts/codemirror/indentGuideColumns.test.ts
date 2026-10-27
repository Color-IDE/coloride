import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indentGuideColumns } from '../../../../../src/features/editor/hosts/codemirror/indentGuideColumns.ts';

test('four-space indentation follows the configured four-column tab stops', () => {
  assert.deepEqual(indentGuideColumns(['int main() {', '    vector<int> image = {', '        1, 2, 3', '    };', '', '    cout << image;', '}'], 4),
    [[], [0], [0, 4], [0], [0], [0], []]);
});
test('long indentation paints every complete tab stop, excluding partial alignment', () => {
  assert.deepEqual(indentGuideColumns(['f() {', '    call(first,', '                         second,', '                         third);', '}'], 4),
    [[], [0], [0, 4, 8, 12, 16, 20], [0, 4, 8, 12, 16, 20], []]);
});
test('blank lines continue only shared scopes and no guides trail at EOF', () => {
  assert.deepEqual(indentGuideColumns(['root', '  child', '    nested', '', '  sibling', '', 'end', ''], 2),
    [[], [0], [0, 2], [0], [0], [], [], []]);
});
test('tabs use visual columns and nested Python blocks remain connected', () => {
  assert.deepEqual(indentGuideColumns(['def f():', '\tif ok:', '\t\twork()', '', '\t\tmore()', '\treturn'], 4),
    [[], [0], [0, 4], [0, 4], [0, 4], [0]]);
});
