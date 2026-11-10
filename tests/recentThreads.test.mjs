import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { visit, recentThreads, afterClosing } = await import('../src/nebula/recentThreads.ts');

// Finished threads list newest first, so a later status_changed_at sits higher up.
const agent = (id, wt = 'w1', over = {}) =>
  ({ id, worktree_id: wt, name: id, archived: false, status: 'finished', status_changed_at: 0, sort_order: 0, ...over });
const state = (agents, open) => ({
  agents: Object.fromEntries(agents.map((a) => [a.id, a])),
  worktrees: {
    w1: { id: 'w1', project_id: 'p1', is_main: true, sort_order: 0, branch: 'main' },
    w1b: { id: 'w1b', project_id: 'p1', is_main: false, sort_order: 1, branch: 'feature' },
    w2: { id: 'w2', project_id: 'p2', is_main: true, sort_order: 0, branch: 'main' },
  },
  terminals: { t1: { id: 't1', worktree_id: 'w1' } },
  prefs: {},
  selectedProject: 'p1',
  selectedSession: open ? { Agent: open } : null,
});

test('visiting a thread moves it to the front, once', () => {
  assert.deepEqual(visit(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(visit([], 'a'), ['a']);
  const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
  assert.equal(visit(many, 'new').length, 20);
});

test('recent threads leave out the open one, archived ones and ones gone', () => {
  const s = state([agent('a'), agent('b', 'w1', { archived: true }), agent('c')], 'a');
  assert.deepEqual(recentThreads(s, ['a', 'b', 'gone', 'c']).map((a) => a.id), ['c']);
});

test('closing a thread opens the one below it in the project, not the last one visited', () => {
  const s = state([agent('a', 'w1', { status_changed_at: 3 }), agent('b', 'w1', { status_changed_at: 2 }), agent('other', 'w2', { status_changed_at: 9 })], 'a');
  assert.deepEqual(afterClosing(s), { selectedProject: 'p1', selectedSession: { Agent: 'b' } });
});

test('closing the bottom thread opens the one above it', () => {
  const s = state([agent('a', 'w1', { status_changed_at: 3 }), agent('b', 'w1', { status_changed_at: 2 })], 'b');
  assert.deepEqual(afterClosing(s), { selectedProject: 'p1', selectedSession: { Agent: 'a' } });
});

test('the next thread can be on the next branch of the same project', () => {
  const s = state([agent('a'), agent('c', 'w1b'), agent('other', 'w2')], 'a');
  assert.deepEqual(afterClosing(s), { selectedProject: 'p1', selectedSession: { Agent: 'c' } });
});

test('a thread already archived falls to the project\'s first thread', () => {
  const s = state([agent('a', 'w1', { archived: true }), agent('b'), agent('other', 'w2')], 'a');
  assert.deepEqual(afterClosing(s), { selectedProject: 'p1', selectedSession: { Agent: 'b' } });
});

test('closing a shell opens its project\'s first thread', () => {
  const s = { ...state([agent('a'), agent('other', 'w2')]), selectedProject: 'p2', selectedSession: { Terminal: 't1' } };
  assert.deepEqual(afterClosing(s), { selectedProject: 'p1', selectedSession: { Agent: 'a' } });
});

test('closing the project\'s only thread stays in the project with nothing open', () => {
  const s = state([agent('a'), agent('other', 'w2')], 'a');
  assert.deepEqual(afterClosing(s), { selectedProject: 'p1', selectedSession: null });
});
