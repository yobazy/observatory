import test from 'node:test';
import assert from 'node:assert/strict';
import { threadOrder } from '../src/nebula/threadOrder.ts';

const thread = (id, promptedAt, overrides = {}) => ({
  id, sort_order: 0, status: 'finished', unseen: false, status_changed_at: 0,
  recent_prompts: promptedAt == null ? [] : [{ text: 'go', submitted_at: promptedAt }],
  ...overrides,
});
const ids = (list) => list.map((a) => a.id);

test('threads sort by when they were last prompted, newest first', () => {
  const list = [thread('old', 100), thread('new', 300), thread('mid', 200)];
  assert.deepEqual(ids(threadOrder(list)), ['new', 'mid', 'old']);
});

test('a status change or opening an unseen reply never moves a row', () => {
  const before = [thread('a', 300), thread('b', 200), thread('c', 100)];
  // b starts waiting on you, c finishes unseen, a is opened: all move their status clock.
  const after = [
    thread('a', 300, { status_changed_at: 900, unseen: false }),
    thread('b', 200, { status: 'needs_feedback', status_changed_at: 950 }),
    thread('c', 100, { status: 'finished', unseen: true, status_changed_at: 990 }),
  ];
  assert.deepEqual(ids(threadOrder(after)), ids(threadOrder(before)));
});

test('sending a prompt takes a thread to the top', () => {
  const list = [thread('a', 300), thread('b', 200), thread('c', 100, { recent_prompts: [{ submitted_at: 100 }, { submitted_at: 400 }] })];
  assert.deepEqual(ids(threadOrder(list)), ['c', 'a', 'b']);
});

test('priority comes first, and a thread with no prompt yet counts from when it was made', () => {
  const list = [
    thread('low', 900),
    thread('plain', 500),
    thread('urgent', 100),
    thread('new', null, { status: 'fresh', status_changed_at: 700 }),
  ];
  assert.deepEqual(ids(threadOrder(list, { low: 'low', urgent: 'urgent' })), ['urgent', 'new', 'plain', 'low']);
});

test('ties keep the daemon order', () => {
  const list = [thread('b', 100, { sort_order: 2 }), thread('a', 100, { sort_order: 1 })];
  assert.deepEqual(ids(threadOrder(list)), ['a', 'b']);
});
