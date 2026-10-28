import test from 'node:test';
import assert from 'node:assert/strict';
import { byRecent, bySource, cleared, lastTouched, noteOpen, pickRange, pin, pinnedFirst, shelve, togglePick } from '../src/nebula/shelfList.ts';

const item = (path, at = 0, pinned = false) => (pinned ? { path, at, pinned } : { path, at });
const paths = (items) => items.map((i) => i.path + (i.pinned ? '*' : ''));

test('new files go in after the pinned ones', () => {
  const had = [item('a', 1, true), item('b', 3), item('c', 2)];
  assert.deepEqual(paths(shelve(had, ['d'], 9)), ['a*', 'd', 'b', 'c']);
});

test('a scan that finds files already there leaves the shelf as it was', () => {
  const had = [item('a', 2), item('b', 1)];
  assert.equal(shelve(had, ['b', 'a'], 9), had);
});

test('a file shown again on purpose moves to the front, with the new time', () => {
  const had = [item('p', 1, true), item('a', 3), item('b', 2)];
  const after = shelve(had, ['b'], 9, { again: true });
  assert.deepEqual(paths(after), ['p*', 'b', 'a']);
  assert.equal(after[1].at, 9);
  // A pinned one gets the new time and stays among the pinned.
  assert.deepEqual(paths(shelve(had, ['p'], 9, { again: true })), ['p*', 'a', 'b']);
});

test('the oldest unpinned files make room; pinned ones never go', () => {
  const had = [item('p', 1, true), item('a', 3), item('b', 2)];
  assert.deepEqual(paths(shelve(had, ['c'], 9, { keep: 2 })), ['p*', 'c', 'a']);
});

test('files sort by when they were last shown or opened, pinned first', () => {
  const items = [item('p', 1, true), item('a', 5), item('b', 4), item('c', 3)];
  const opened = { '/x': 99, c: 8, p: 7 };
  assert.equal(lastTouched(item('c', 3), opened), 8);
  assert.equal(lastTouched({ path: 'never' }, opened), 0);
  assert.deepEqual(paths(byRecent(items, opened)), ['p*', 'c', 'a', 'b']);
  // Files never shown nor opened keep their order, after the rest.
  assert.deepEqual(paths(byRecent([{ path: 'x' }, { path: 'y' }, { path: 'z' }], { z: 1 })), ['z', 'x', 'y']);
});

test('open times are kept for the most recent files only', () => {
  assert.deepEqual(noteOpen({ a: 1 }, ['b', 'c'], 5), { a: 1, b: 5, c: 5 });
  assert.deepEqual(noteOpen({ a: 1, b: 2 }, ['c'], 5, 2), { c: 5, b: 2 });
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

test('picking files: a click toggles one, a Shift-click adds the run from the last', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(togglePick([], 'b'), ['b']);
  assert.deepEqual(togglePick(['b', 'c'], 'b'), ['c']);
  assert.deepEqual(pickRange(order, ['b'], 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(pickRange(order, ['d'], 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(pickRange(order, [], null, 'c'), ['c']);
  assert.deepEqual(pickRange(order, ['a'], 'a', 'gone'), ['a']);
});

test('picked files open in list order, gathered by the session that showed them', () => {
  const rows = [
    { path: 'a', from: 't1' },
    { path: 'b', from: 't2' },
    { path: 'c', from: 't1' },
    { path: 'd', from: 't2' },
  ];
  assert.deepEqual(bySource(rows, ['d', 'c', 'a']), [
    { from: 't1', paths: ['a', 'c'] },
    { from: 't2', paths: ['d'] },
  ]);
});
