import test from 'node:test';
import assert from 'node:assert/strict';
import { cleared, pin, pinnedFirst, shelve } from '../src/nebula/shelfList.ts';

const item = (path, at = 0, pinned = false) => (pinned ? { path, at, pinned } : { path, at });
const paths = (items) => items.map((i) => i.path + (i.pinned ? '*' : ''));

test('new files go in after the pinned ones', () => {
  const had = [item('a', 1, true), item('b', 2), item('c', 3)];
  assert.deepEqual(paths(shelve(had, ['d'], 9)), ['a*', 'd', 'b', 'c']);
});

test('a file shown again keeps its place, and the shelf is left as it was', () => {
  const had = [item('a', 1), item('b', 2)];
  assert.equal(shelve(had, ['b', 'a'], 9), had);
});

test('the oldest unpinned files make room; pinned ones never go', () => {
  const had = [item('p', 1, true), item('a', 2), item('b', 3)];
  assert.deepEqual(paths(shelve(had, ['c'], 9, 2)), ['p*', 'c', 'a']);
});

test('pinning moves a file to the end of the pinned ones; unpinning to the front of the rest', () => {
  const had = [item('a', 1, true), item('b', 2), item('c', 3)];
  const pinned = pin(had, 'c', true);
  assert.deepEqual(paths(pinned), ['a*', 'c*', 'b']);
  assert.deepEqual(paths(pin(pinned, 'a', false)), ['c*', 'a', 'b']);
  assert.equal(pin(had, 'a', true), had);
  assert.equal(pin(had, 'gone', true), had);
});

test('clearing keeps the pinned files, and a stray pin is put first', () => {
  const had = [item('a', 1), item('b', 2, true)];
  assert.deepEqual(paths(cleared(had)), ['b*']);
  assert.deepEqual(paths(pinnedFirst(had)), ['b*', 'a']);
});
