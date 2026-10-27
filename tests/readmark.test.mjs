import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlan } from '../src/nebula/readmark.ts';

const kinds = ['you', 'claude', 'steps', 'claude', 'you', 'claude', 'you', 'claude', 'you', 'claude'];
const thread = kinds.map((kind, n) => ({ n, kind }));

test('older turns fold, keeping the last two open', () => {
  assert.deepEqual(readPlan(thread, null), { unread: null, foldTo: 6, turns: 2 });
  assert.deepEqual(readPlan(thread, 9), { unread: null, foldTo: 6, turns: 2 });
});

test('what came in since you last read starts a line, and its turn stays open', () => {
  assert.deepEqual(readPlan(thread, 3), { unread: 4, foldTo: 4, turns: 1 });
  // New from the middle of a turn: that whole turn stays open.
  assert.deepEqual(readPlan(thread, 4), { unread: 5, foldTo: 4, turns: 1 });
  assert.deepEqual(readPlan(thread, 7), { unread: 8, foldTo: 6, turns: 2 });
});

test('a short thread folds nothing', () => {
  assert.deepEqual(readPlan(thread.slice(0, 6), null), { unread: null, foldTo: null, turns: 0 });
  assert.deepEqual(readPlan(thread.slice(0, 6), 1).foldTo, null);
});
