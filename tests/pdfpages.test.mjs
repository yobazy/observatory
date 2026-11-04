import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, MAX_FIT, PAGE_GAP, pageAt, pageTops, readingLine, safeLink } from '../src/nebula/pdfpages.ts';

test('pages fit the pane inside its gaps, but never past the most a page is drawn', () => {
  assert.equal(fitScale(600, 600 + 2 * PAGE_GAP), 1);
  assert.equal(fitScale(100, 5000), MAX_FIT);
  assert.equal(fitScale(0, 500), 1);
  assert.equal(fitScale(600, 0), 1);
});

test('each page starts after the ones above it and their gaps', () => {
  assert.deepEqual(pageTops([100, 200, 50]), [PAGE_GAP, 100 + 2 * PAGE_GAP, 300 + 3 * PAGE_GAP]);
});

test('the page at a line is the one holding it, down to the last', () => {
  const heights = [100, 100, 100];
  const tops = pageTops(heights);
  assert.equal(pageAt(tops, heights, 0), 0);
  assert.equal(pageAt(tops, heights, tops[1] + 50), 1);
  assert.equal(pageAt(tops, heights, tops[2] + 50), 2);
  assert.equal(pageAt(tops, heights, 99999), 2);
  assert.equal(pageAt([], [], 10), 0);
});

test('the reading line runs from the top of the pane to its bottom, so short pages all get counted', () => {
  assert.equal(readingLine(0, 800, 1000), 0);
  assert.equal(readingLine(500, 800, 1000), 900);
  assert.equal(readingLine(1000, 800, 1000), 1800);
  assert.equal(readingLine(0, 800, 0), 0);
  const heights = [100, 100, 100, 100, 100, 100];
  const tops = pageTops(heights);
  const end = tops[5] + 100 + 72;
  const max = end - 400;
  assert.equal(pageAt(tops, heights, readingLine(0, 400, max)), 0);
  assert.equal(pageAt(tops, heights, readingLine(max, 400, max)), 5);
});

test('only web and mail links open from a PDF', () => {
  assert.ok(safeLink('https://example.com'));
  assert.ok(safeLink('mailto:a@example.com'));
  assert.ok(!safeLink('file:///etc/passwd'));
  assert.ok(!safeLink('javascript:alert(1)'));
  assert.ok(!safeLink(undefined));
});
