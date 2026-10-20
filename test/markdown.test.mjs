import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownLinks } from '../src/markdown.mjs';
test('links omit code, preserve encoded destinations, anchors and references', () => {
  assert.deepEqual(markdownLinks('`deque[float](maxlen=10)`\n```md\n[x](bad)\n```\n    [x](bad)\n[ok](a%20b.md#part)\n[x](<other file.md>)\n[ref]: doc.md "title"'),
    ['a%20b.md#part', 'other file.md', 'doc.md']);
});
