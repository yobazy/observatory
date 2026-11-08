import test from 'node:test';
import assert from 'node:assert/strict';
import { landedNote, prsNamed } from '../src/nebula/prwatch.ts';

const wait = (text) => ({ tone: 'wait', text });

test('finds the PR numbers a verdict names, once each', () => {
  assert.deepEqual(prsNamed('Keep open: #134 next-prompt chips waits on the reviewer, then #134 again and #120'), [134, 120]);
  assert.deepEqual(prsNamed('Keep open: waiting on decisions 1–3'), []);
  assert.deepEqual(prsNamed('see a#12 and &#39; entities'), []);
});

test('says what landed only once every named PR has', () => {
  const v = wait('Keep open: #120, #134 and #150 wait on the reviewer');
  assert.equal(landedNote(v, { 120: 'merged', 134: 'open', 150: 'merged' }), null);
  assert.equal(landedNote(v, { 120: 'merged', 150: 'merged' }), null);
  assert.equal(landedNote(v, { 120: 'merged', 134: 'closed', 150: 'merged' }), '#120 merged, #134 closed, #150 merged');
});

test('only a waiting verdict that names a PR', () => {
  assert.equal(landedNote({ tone: 'done', text: 'Safe to close. #134 merged' }, { 134: 'merged' }), null);
  assert.equal(landedNote(wait('Keep open: CI is running'), {}), null);
  assert.equal(landedNote(null, {}), null);
});
