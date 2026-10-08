import test from 'node:test';
import assert from 'node:assert/strict';
import { findPaths } from '../src/nebula/pathtext.ts';

const paths = (text) => findPaths(text).map((f) => f.text);

test('paths an agent writes are found, without the sentence around them', () => {
  assert.deepEqual(paths('Saved the mockup to mockups/checkout.html.'), ['mockups/checkout.html']);
  assert.deepEqual(paths('⎿  Wrote 120 lines to /Users/me/site/index.html'), ['/Users/me/site/index.html']);
  assert.deepEqual(paths('Notes are in ~/Desktop/notes.md, and the plan in `./docs/plan.md`'), [
    '~/Desktop/notes.md',
    './docs/plan.md',
  ]);
  assert.deepEqual(paths('(see mockups/a.html)'), ['mockups/a.html']);
  assert.deepEqual(paths('error at src/App.tsx:12:4'), ['src/App.tsx']);
});

test('offsets point at the path in the line', () => {
  const [found] = findPaths('open docs/x.md now');
  assert.equal(found.start, 5);
});

test('a bare file name counts only when it is worth previewing', () => {
  assert.deepEqual(paths('Updated notes.md and main.rs'), ['notes.md']);
});

test('prose, versions and URLs are left alone', () => {
  assert.deepEqual(paths('v1.2 is out, e.g. today; README updated'), []);
  assert.deepEqual(paths('see https://example.com/docs/a.html for more'), []);
});

import { logicalLine } from '../src/nebula/pathtext.ts';

const COLS = 24;
/** Rows as a terminal of COLS columns would hold them. */
const screen = (lines, wrapped = []) =>
  lines.map((l, i) => ({ cells: [...l.padEnd(COLS, ' ')].slice(0, COLS), wrapped: wrapped.includes(i) }));
const line = (rows, y) => logicalLine((i) => rows[i], y, COLS);

test('a path an app broke across rows, indent and all, is found whole', () => {
  const rows = screen([
    'Saved it here:',
    '  /tmp/claude/scratch/mo',
    '  ckup-test/index.html',
    '',
  ]);
  for (const y of [1, 2]) {
    const { text, at } = line(rows, y);
    assert.deepEqual(findPaths(text).map((f) => f.text), ['/tmp/claude/scratch/mockup-test/index.html']);
    const [f] = findPaths(text);
    assert.deepEqual(at[f.start], { x: 3, y: 2 }, 'starts after the first row indent');
    assert.deepEqual(at[f.start + f.text.length - 1], { x: 22, y: 3 }, 'ends on the second row');
  }
});

test('rows the terminal wrapped join as they are', () => {
  const rows = screen(['open /tmp/a/very/long/pa', 'th/notes.md now'], [1]);
  assert.deepEqual(findPaths(line(rows, 1).text).map((f) => f.text), ['/tmp/a/very/long/path/notes.md']);
});

test('a short row, or prose wrapped at a space, stays its own line', () => {
  const rows = screen(['see docs/a.md', '  and more text here', 'prose wrapped right to th', 'next.md']);
  assert.equal(line(rows, 0).text, 'see docs/a.md');
  assert.equal(line(rows, 3).text, 'next.md', 'a full row ending on a plain word');
});
