import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, MAX_FIT, PAGE_GAP, pageAt, pageTops, safeLink } from '../src/nebula/pdfpages.ts';

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

test('only web and mail links open from a PDF', () => {
  assert.ok(safeLink('https://example.com'));
  assert.ok(safeLink('mailto:a@example.com'));
  assert.ok(!safeLink('file:///etc/passwd'));
  assert.ok(!safeLink('javascript:alert(1)'));
  assert.ok(!safeLink(undefined));
});
