import test from 'node:test';
import assert from 'node:assert/strict';
import { pruned } from '../src/nebula/prune.ts';

test('pruned() drops the active mark of a deleted thread', () => {
  const s = {
    loaded: true,
    projects: { p1: { id: 'p1', repo_path: '/r' } },
    worktrees: { w1: { id: 'w1', project_id: 'p1' } },
    agents: { A: { id: 'A', worktree_id: 'w1' } },
  };
  const next = pruned(s, { activeThreads: { A: 1, gone: 2 } });
  assert.deepEqual(next.activeThreads, { A: 1 });
});
