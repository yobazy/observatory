import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOT_FAST_FORWARD,
  PUSHED_NOTE_MS,
  commitsToPush,
  pushAfterTurn,
  pushNote,
  pushTrigger,
  shouldPush,
  ownUpstream,
  showsNote,
} from '../src/nebula/autopush.ts';

const status = (over = {}) => ({
  branch: 'feat',
  head: 'abc',
  upstream: 'origin/feat',
  upstreamGone: false,
  ahead: 2,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  insertions: 0,
  deletions: 0,
  baseAhead: 4,
  lastCommit: null,
  ...over,
});
const wt = (over = {}) => ({ id: 'w1', project_id: 'p1', path: '/tmp/p1-feat', branch: 'feat', is_main: false, sort_order: 0, ...over });
const on = { pushAfterTurn: true };
const off = { pushAfterTurn: false };

test('a card with the setting on and a branch 2 ahead and 0 behind pushes', () => {
  assert.equal(shouldPush(status(), wt(), on, 'main'), true);
});

test('the setting off, nothing ahead, 1 behind, a gone upstream, a detached HEAD or the main branch does not push', () => {
  assert.equal(shouldPush(status(), wt(), off, 'main'), false);
  assert.equal(shouldPush(status(), wt(), null, 'main'), false);
  assert.equal(shouldPush(status({ ahead: 0 }), wt(), on, 'main'), false);
  assert.equal(shouldPush(status({ behind: 1 }), wt(), on, 'main'), false);
  assert.equal(shouldPush(status({ upstreamGone: true, ahead: 0 }), wt(), on, 'main'), false);
  assert.equal(shouldPush(status({ upstreamGone: true }), wt(), on, 'main'), false);
  assert.equal(shouldPush(status({ branch: null }), wt(), on, 'main'), false);
  // The main checkout, the main checkout's branch, and main by name.
  assert.equal(shouldPush(status({ branch: 'main' }), wt({ is_main: true, branch: 'main' }), on, null), false);
  assert.equal(shouldPush(status({ branch: 'trunk' }), wt({ branch: 'trunk' }), on, 'trunk'), false);
  assert.equal(shouldPush(status({ branch: 'master' }), wt({ branch: 'master' }), on, null), false);
});

test('uncommitted changes alone are not a reason to push', () => {
  assert.equal(shouldPush(status({ ahead: 0, unstaged: 3, untracked: 1 }), wt(), on, 'main'), false);
  assert.equal(shouldPush(status({ ahead: 1, unstaged: 3 }), wt(), on, 'main'), true);
});

test('a branch with no upstream and commits pushes; with no commits of its own it does not', () => {
  assert.equal(shouldPush(status({ upstream: null, ahead: 0, baseAhead: 1 }), wt(), on, 'main'), true);
  assert.equal(shouldPush(status({ upstream: null, ahead: 0, baseAhead: 0 }), wt(), on, 'main'), false);
});

/** Deps that record what happened, with a status read and a push to script. */
function fakeDeps({ card = on, git = status(), push = async () => {} } = {}) {
  const log = { pushes: [], records: [], sent: [] };
  const deps = {
    worktree: (id) => (id === 'w1' ? wt() : undefined),
    card: () => card,
    mainBranch: () => 'main',
    status: async () => git,
    push: async (w, main) => {
      log.pushes.push([w.path, main]);
      await push();
    },
    record: (id, r) => log.records.push([id, r]),
    now: () => 1000,
  };
  return { deps, log };
}
const agent = (status, over = {}) => ({ worktree_id: 'w1', status, archived: false, ...over });

test('a thread going from running to finished or needs_feedback tries one push for its worktree', async () => {
  for (const to of ['finished', 'needs_feedback']) {
    assert.equal(pushTrigger(agent(to), 'running'), 'w1');
    const { deps, log } = fakeDeps();
    assert.equal(await pushAfterTurn(agent(to), 'running', deps), true);
    assert.deepEqual(log.pushes, [['/tmp/p1-feat', 'main']]);
    assert.deepEqual(log.records, [['w1', { ok: true, commits: 2, at: 1000 }]]);
  }
});

test('a status change that does not leave running pushes nothing', async () => {
  for (const [from, to] of [['fresh', 'running'], ['finished', 'running'], ['needs_feedback', 'finished'], ['running', 'running']]) {
    assert.equal(pushTrigger(agent(to), from), null);
    const { deps, log } = fakeDeps();
    assert.equal(await pushAfterTurn(agent(to), from, deps), false);
    assert.deepEqual(log.pushes, []);
  }
  const { deps, log } = fakeDeps({ card: off });
  assert.equal(await pushAfterTurn(agent('finished'), 'running', deps), false);
  assert.deepEqual(log.pushes, []);
});

test('a rejected push says "Not pushed: the remote has newer commits" and sends the agent nothing', async () => {
  const { deps, log } = fakeDeps({
    push: async () => {
      throw NOT_FAST_FORWARD;
    },
  });
  assert.equal(await pushAfterTurn(agent('finished'), 'running', deps), true);
  assert.equal(log.records.length, 1);
  const [, r] = log.records[0];
  assert.equal(pushNote(r), 'Not pushed: the remote has newer commits');
  // Deps have no way to reach the agent, and the push isn't retried.
  assert.equal(log.pushes.length, 1);
  // It stays on the row until a push works.
  assert.equal(showsNote(r, 1000 + 10 * PUSHED_NOTE_MS), true);
});

test('a push that works says how many commits went, for a moment', () => {
  const r = { ok: true, commits: 1, at: 0 };
  assert.equal(pushNote(r), 'Pushed 1 commit');
  assert.equal(pushNote({ ...r, commits: 2 }), 'Pushed 2 commits');
  assert.equal(showsNote(r, PUSHED_NOTE_MS - 1), true);
  assert.equal(showsNote(r, PUSHED_NOTE_MS), false);
  assert.equal(pushNote({ ok: false, error: 'HEAD is detached\nmore', at: 0 }), 'Not pushed: HEAD is detached');
});

test('a branch with no upstream counts its own commits as pushed', async () => {
  const { deps, log } = fakeDeps({ git: status({ upstream: null, ahead: 0, baseAhead: 3 }) });
  assert.equal(await pushAfterTurn(agent('finished'), 'running', deps), true);
  assert.deepEqual(log.records, [['w1', { ok: true, commits: 3, at: 1000 }]]);
});

test('a branch tracking origin/main (made with -b x origin/main) pushes its own commits to its own name', () => {
  const tracksMain = status({ branch: 'x', upstream: 'origin/main', ahead: 1, behind: 3, baseAhead: 1 });
  assert.equal(ownUpstream(tracksMain), false);
  assert.equal(shouldPush(tracksMain, wt({ branch: 'x' }), on, 'main'), true);
  assert.equal(commitsToPush(tracksMain), 1);
  // Nothing of its own beyond main: nothing to push.
  assert.equal(shouldPush({ ...tracksMain, baseAhead: 0 }, wt({ branch: 'x' }), on, 'main'), false);
  // Any upstream of another name is the same.
  assert.equal(shouldPush(status({ branch: 'x', upstream: 'origin/other', baseAhead: 2 }), wt({ branch: 'x' }), on, 'main'), true);
  // The local branch being main still never pushes, whatever it tracks.
  assert.equal(shouldPush(status({ branch: 'main', upstream: 'origin/feat' }), wt({ branch: 'main' }), on, null), false);
  assert.equal(shouldPush(status({ branch: 'trunk', upstream: 'origin/x' }), wt({ branch: 'trunk' }), on, 'trunk'), false);
  // Its own same-named upstream keeps the ahead and behind checks.
  assert.equal(ownUpstream(status()), true);
  assert.equal(shouldPush(status({ behind: 1 }), wt(), on, 'main'), false);
});

test('a branch tracking origin/main is pushed after its turn, with no note but how many went', async () => {
  const { deps, log } = fakeDeps({ git: status({ branch: 'x', upstream: 'origin/main', ahead: 5, baseAhead: 1 }) });
  assert.equal(await pushAfterTurn(agent('finished'), 'running', deps), true);
  assert.equal(log.pushes.length, 1);
  assert.deepEqual(log.records, [['w1', { ok: true, commits: 1, at: 1000 }]]);
});
