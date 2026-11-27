import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { withoutWorktree } = await import('../src/nebula/store.ts');

const state = (selectedSession) => ({
  worktrees: { w1: { id: 'w1', project_id: 'p' }, w2: { id: 'w2', project_id: 'p' } },
  agents: { a1: { id: 'a1', worktree_id: 'w1' }, a2: { id: 'a2', worktree_id: 'w2' } },
  terminals: { t1: { id: 't1', worktree_id: 'w1' }, t2: { id: 't2', worktree_id: 'w2' } },
  selectedSession,
});

test("a removed worktree takes its tasks and shells with it, so none linger without a project", () => {
  const next = withoutWorktree(state({ Agent: 'a2' }), 'w1');
  assert.deepEqual(Object.keys(next.worktrees), ['w2']);
  assert.deepEqual(Object.keys(next.agents), ['a2']);
  assert.deepEqual(Object.keys(next.terminals), ['t2']);
  assert.deepEqual(next.selectedSession, { Agent: 'a2' });
});

test('the open thread is let go when its worktree is removed', () => {
  assert.equal(withoutWorktree(state({ Agent: 'a1' }), 'w1').selectedSession, null);
  assert.equal(withoutWorktree(state({ Terminal: 't1' }), 'w1').selectedSession, null);
});
