import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { visit, recentThreads, afterClosing } = await import('../src/nebula/recentThreads.ts');

const agent = (id, wt = 'w1', over = {}) => ({ id, worktree_id: wt, name: id, archived: false, ...over });
const state = (agents, open) => ({
  agents: Object.fromEntries(agents.map((a) => [a.id, a])),
  worktrees: { w1: { id: 'w1', project_id: 'p1' }, w2: { id: 'w2', project_id: 'p2' } },
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

test('closing a thread goes back to the one before it, in its project', () => {
  const s = state([agent('a'), agent('b', 'w2')], 'a');
  assert.deepEqual(afterClosing(s, ['a', 'b']), { selectedProject: 'p2', selectedSession: { Agent: 'b' } });
});

test('closing the only thread leaves nothing open', () => {
  const s = state([agent('a')], 'a');
  assert.deepEqual(afterClosing(s, ['a']), { selectedSession: null });
});
