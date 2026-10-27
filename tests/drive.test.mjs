import test from 'node:test';
import assert from 'node:assert/strict';
import { chord, labelOf, matching, pick } from '../src/nebula/drive.ts';

const threads = [
  { id: '01ABC', name: 'Fix login' },
  { id: '01DEF', name: 'Fix login redirect' },
  { id: '01GHI', name: 'Concert Footage Creative Ideas' },
];

test('a thread is picked by id, whole name, then a unique part of it', () => {
  assert.equal(pick(threads, '01ghi').name, 'Concert Footage Creative Ideas');
  assert.equal(pick(threads, 'fix login').id, '01ABC', 'the whole name beats a longer one starting with it');
  assert.equal(pick(threads, 'concert').id, '01GHI');
  assert.equal(pick(threads, 'redirect').id, '01DEF');
  assert.throws(() => pick(threads, 'fix'), /could be 2 threads/);
  assert.throws(() => pick(threads, 'nothing'), /no thread called "nothing"/);
});

test('a control is known by its label, else its text, else its title', () => {
  assert.equal(labelOf({ label: 'Close preview', text: '×', title: null }), 'Close preview');
  assert.equal(labelOf({ label: null, text: '  Follow\n  up ', title: 'x' }), 'Follow up');
  assert.equal(labelOf({ label: '', text: '', title: 'Reload' }), 'Reload');
});

test('the closest matches win: exact, then prefix, then anywhere', () => {
  const labels = ['Open', 'Open in…', 'Reopen', 'Terminal'];
  const id = (l) => l;
  assert.deepEqual(matching(labels, id, 'open'), ['Open']);
  assert.deepEqual(matching(labels, id, 'open i'), ['Open in…']);
  assert.deepEqual(matching(labels, id, 'pen'), ['Open', 'Open in…', 'Reopen']);
  assert.deepEqual(matching(labels, id, 'zzz'), []);
});

test('a chord reads as a keydown', () => {
  assert.deepEqual(chord('cmd+shift+m'), { key: 'm', code: 'KeyM', metaKey: true, shiftKey: true, altKey: false, ctrlKey: false });
  assert.equal(chord('esc').key, 'Escape');
  assert.equal(chord('ctrl+enter').ctrlKey, true);
  assert.equal(chord('cmd+1').code, 'Digit1');
  assert.equal(chord('space').code, 'Space');
  assert.throws(() => chord('hyper+k'), /unknown modifier/);
});
