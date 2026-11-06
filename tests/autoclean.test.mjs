import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanable, GRACE_MS } from '../src/nebula/autoclean.ts';

const now = 10_000_000;
const git = (over = {}) => ({
  branch: 'moment-x', head: 'abc', upstream: 'origin/moment-x', upstreamGone: true, ahead: 0, behind: 0,
  staged: 0, unstaged: 0, untracked: 0, conflicted: 0, insertions: 0, deletions: 0, baseAhead: 1, lastCommit: null, ...over,
});
const agent = (id, over = {}) => ({
  id, worktree_id: 'w1', status: 'finished', archived: false, status_changed_at: now - GRACE_MS, ...over,
});
const merged = (over = {}) => ({ kind: 'found', at: now, pr: { number: 7, headOid: 'abc', state: 'merged', ...over } });
const state = (over = {}) => ({
  loaded: true,
  worktrees: { w1: { id: 'w1', project_id: 'p', path: '/w1', branch: 'moment-x', is_main: false, sort_order: 0 } },
  agents: { a: agent('a'), r: agent('r') },
  git: { w1: git() },
  prs: { w1: merged() },
  selectedSession: null,
  ...over,
});

test('a moment task whose PR merged at this commit, with every thread stopped, is cleaned up', () => {
  assert.deepEqual(cleanable(state(), now, true), ['w1']);
});

test('a branch rebased after its PR merged is the same work; a new commit on it is not', () => {
  const rebased = { git: { w1: git({ head: 'ghi' }) } };
  assert.deepEqual(cleanable(state({ ...rebased, prs: { w1: merged({ rebasedHead: 'ghi' }) } }), now, false), ['w1']);
  // The check is about one commit: moving on from it counts as new work again.
  assert.deepEqual(cleanable(state({ ...rebased, prs: { w1: merged({ rebasedHead: 'old' }) } }), now, false), []);
});

test('not while a thread there is still going, or only just stopped', () => {
  assert.deepEqual(cleanable(state({ agents: { a: agent('a'), r: agent('r', { status: 'running' }) } }), now, false), []);
  assert.deepEqual(cleanable(state({ agents: { a: agent('a'), r: agent('r', { status: 'needs_feedback' }) } }), now, false), []);
  assert.deepEqual(cleanable(state({ agents: { a: agent('a', { status_changed_at: now - 5_000 }) } }), now, false), []);
  // An archived thread doesn't hold it up.
  assert.deepEqual(cleanable(state({ agents: { a: agent('a'), r: agent('r', { status: 'running', archived: true }) } }), now, false), ['w1']);
});

test('not unless the PR merged exactly what is checked out, with nothing uncommitted', () => {
  assert.deepEqual(cleanable(state({ prs: { w1: merged({ state: 'open' }) } }), now, false), []);
  assert.deepEqual(cleanable(state({ prs: { w1: merged({ headOid: 'def' }) } }), now, false), []);
  assert.deepEqual(cleanable(state({ git: { w1: git({ untracked: 1 }) } }), now, false), []);
  assert.deepEqual(cleanable(state({ git: { w1: { error: 'gone' } } }), now, false), []);
  assert.deepEqual(cleanable(state({ prs: {} }), now, false), []);
});

test('only moment branches, and not the thread you are looking at', () => {
  const s = state();
  assert.deepEqual(cleanable({ ...s, worktrees: { w1: { ...s.worktrees.w1, branch: 'fix-login' } } }, now, false), []);
  assert.deepEqual(cleanable(state({ selectedSession: { Agent: 'r' } }), now, true), []);
  // Once the window is in the back, it goes.
  assert.deepEqual(cleanable(state({ selectedSession: { Agent: 'r' } }), now, false), ['w1']);
  assert.deepEqual(cleanable(state({ loaded: false }), now, false), []);
});
