import test from 'node:test';
import assert from 'node:assert/strict';
import { findPaths, findUrls } from '../src/nebula/pathtext.ts';

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

const urls = (text) => findUrls(text).map((f) => f.text);

test('web URLs printed as plain text are found, without what is around them', () => {
  assert.deepEqual(urls('Opened it for you: ⧉ Proposal (https://claude.ai/code/artifact/6754e537-da0e).'), [
    'https://claude.ai/code/artifact/6754e537-da0e',
  ]);
  assert.deepEqual(urls('see https://example.com/docs?a=1&b=2#top, or <http://localhost:5173/>'), [
    'https://example.com/docs?a=1&b=2#top',
    'http://localhost:5173/',
  ]);
  assert.deepEqual(urls('"https://x.dev/a" and [https://x.dev/b]'), ['https://x.dev/a', 'https://x.dev/b']);
});

test("a bracket that is the URL's own stays in it", () => {
  assert.deepEqual(urls('(https://en.wikipedia.org/wiki/Mercury_(planet))'), [
    'https://en.wikipedia.org/wiki/Mercury_(planet)',
  ]);
});

test('offsets point at the URL, and anything but a web URL is left alone', () => {
  assert.equal(findUrls('go to https://a.dev now')[0].start, 6);
  assert.deepEqual(urls('file:///tmp/a.html, ftp://x.org/f, https:// and plain text'), []);
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

test('a URL an app broke across rows is found whole', () => {
  const rows = screen(['Opened: ⧉ Proposal', '  (https://claude.ai/cod', '  e/artifact/6754e537-da', '  0e-41a6)', '']);
  for (const y of [1, 2, 3]) {
    const { text, at } = line(rows, y);
    const [u] = findUrls(text);
    assert.equal(u.text, 'https://claude.ai/code/artifact/6754e537-da0e-41a6');
    assert.deepEqual(at[u.start], { x: 4, y: 2 });
    assert.deepEqual(at[u.start + u.text.length - 1], { x: 9, y: 4 });
  }
});

test('a block of output an app wrapped joins only so far, so reading it stays cheap', () => {
  // Base64 hard-wrapped at the full width: every row looks like it carries on.
  const rows = screen(Array.from({ length: 2000 }, (_, i) => 'aZ9+/'.repeat(5).slice(i % 5, i % 5 + COLS)));
  let reads = 0;
  const row = (i) => (reads++, rows[i]);
  const { last } = logicalLine(row, 1000, COLS);
  assert.ok(last > 1000 && last < 1100, `stops near the row it starts on, not at ${last}`);
  assert.ok(reads < 1000, `read ${reads} rows`);
});

test('a path with spaces in its names is found whole, ahead of the runs inside it', () => {
  assert.deepEqual(paths('Saved: /Users/me/vault/Career/Call - Ryan - Oct 2026.md'), [
    '/Users/me/vault/Career/Call - Ryan - Oct 2026.md',
    '2026.md',
  ]);
  assert.deepEqual(paths('Notes in `~/vault/My Notes/plan.md`.'), ['~/vault/My Notes/plan.md', 'Notes/plan.md']);
  assert.deepEqual(paths('see /a/b.md and /c/d.md'), ['/a/b.md', '/c/d.md'], 'two paths stay two');
  assert.deepEqual(paths('Wrote /tmp/x and moved /Users/a/My Notes/b.md'), ['/Users/a/My Notes/b.md', 'Notes/b.md']);
});

test('a path with spaces an app wrapped at a space is found whole, the space put back', () => {
  const rows = screen(['  /Users/me/My Notes/A -', '  Oct 2026.md', '', 'Saved /a/b.md and then', '  more prose here.md']);
  for (const y of [0, 1]) {
    const { text, at } = line(rows, y);
    const [f] = findPaths(text);
    assert.equal(f.text, '/Users/me/My Notes/A - Oct 2026.md');
    assert.deepEqual(at[f.start], { x: 3, y: 1 });
    assert.deepEqual(at[f.start + f.text.length - 1], { x: 13, y: 2 });
  }
  assert.equal(line(rows, 3).text, 'Saved /a/b.md and then', 'a finished path then prose stays apart');
});

test('a code span that is only a path reads as that path', async () => {
  const { pathInCode } = await import('../src/nebula/pathtext.ts');
  assert.equal(pathInCode('src/cart/sync.ts'), 'src/cart/sync.ts');
  assert.equal(pathInCode('src/cart/sync.ts:42'), 'src/cart/sync.ts');
  assert.equal(pathInCode('~/notes/plan.md:3:1'), '~/notes/plan.md');
  assert.equal(pathInCode('Promise.all'), null);
  assert.equal(pathInCode('npm run build'), null);
  assert.equal(pathInCode('cat src/a.ts'), null);
});

test('"#75" in prose names a PR, and links like any other of its repo', async () => {
  const { findPrRefs, prLink } = await import('../src/nebula/pathtext.ts');
  assert.deepEqual(findPrRefs('Merged #75 and (#76), not issue-#3 or #12abc.'), [
    { start: 7, length: 3, number: 75 },
    { start: 16, length: 3, number: 76 },
  ]);
  assert.deepEqual(findPrRefs('#5 first'), [{ start: 0, length: 2, number: 5 }]);
  assert.deepEqual(findPrRefs('#075'), [{ start: 0, length: 4, number: 75 }]);
  assert.equal(prLink('https://github.com/o/r/pull/12', 75), 'https://github.com/o/r/pull/75');
});
