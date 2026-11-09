import test from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
globalThis.localStorage = {
  getItem: (k) => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => data.set(k, String(v)),
  removeItem: (k) => data.delete(k),
};

const { allBatches, capNote, globalCap, laneCapper, launchTask, makeBatch, nextLaunchable, newTaskBatch, queueNewTask, workingNow } =
  await import('../src/nebula/batch.ts');

const NOW = 1_000_000;
const card = (over = {}) => ({ description: '', skills: [], skillNotes: {}, taskKinds: [], policy: 'isolated', concurrency: 1, isHome: false, homeFolder: null, schedulingInstruction: '', ...over });
const cards = { shop: card(), career: card({ policy: 'shared', concurrency: 1 }) };
const limits = (cap = globalCap(undefined)) => ({ globalCap: cap, laneCap: laneCapper(cards) });
const agent = (id, status, over = {}) => ({ id, worktree_id: 'w-shop-main', name: id, status, archived: false, status_changed_at: 0, kind: 'claude', recent_prompts: [], ...over });
const planTask = (n) => ({ id: `t${n}`, sourceItemIds: [`i${n}`], text: `task ${n}`, target: 'project', projectId: 'shop', mode: 'new_worktree', confidence: 0.9, planCheckpoint: false, needsChoice: false });

test('given a global cap of 4 and 3 sessions working that were started from New task, nextLaunchable launches only 1 batch task', () => {
  const batch = makeBatch({ tasks: [1, 2, 3].map(planTask), at: NOW }, [], cards, 'b1');
  const agents = { n1: agent('n1', 'running'), n2: agent('n2', 'running'), n3: agent('n3', 'running') };
  assert.equal(nextLaunchable(batch.tasks, agents, limits(4), NOW).length, 1);
  assert.equal(workingNow(batch.tasks, agents, NOW), 3);

  // Threads that only sit finished, waiting on you, or archived don't take a slot.
  const idle = { ...agents, n2: agent('n2', 'finished'), n3: agent('n3', 'needs_feedback'), n4: agent('n4', 'running', { archived: true }) };
  assert.equal(nextLaunchable(batch.tasks, idle, limits(4), NOW).length, 3);

  // A batch task's own session isn't counted twice.
  const launched = [{ ...batch.tasks[0], state: 'launched', agentId: 'n1', launchedAt: NOW }, batch.tasks[1], batch.tasks[2]];
  assert.equal(workingNow(launched, agents, NOW), 3);
  assert.equal(nextLaunchable(launched, agents, limits(4), NOW).length, 1);
});

test('given 4 sessions working, the New task box says it will wait in the queue; queued, it launches when a slot frees', async () => {
  const agents = Object.fromEntries([1, 2, 3, 4].map((n) => [`a${n}`, agent(`a${n}`, 'running')]));
  assert.equal(capNote(workingNow([], agents, NOW), 4), "4 running, this will wait in Dispatch's queue");
  assert.equal(capNote(3, 4), null, 'room: nothing said');

  const batch = queueNewTask({ text: 'fix the login redirect', projectId: 'shop', worktreeId: null, branch: 'login-fix', kind: 'codex' }, cards);
  assert.deepEqual(allBatches().map((b) => b.id), [batch.id], 'saved where the runner reads');
  const [t] = batch.tasks;
  assert.equal(t.state, 'pending');
  assert.equal(nextLaunchable([t], agents, limits(4), NOW).length, 0, 'waits while all 4 run');

  const freed = { ...agents, a1: agent('a1', 'finished') };
  const next = nextLaunchable([t], freed, limits(4), NOW);
  assert.deepEqual(next.map((x) => x.id), [t.id], 'launches when one finishes');

  // It starts as typed: its branch, its harness, its words.
  const calls = [];
  const out = await launchTask(next[0], {
    world: () => ({ projects: { shop: { id: 'shop', repo_path: '/code/shop' } }, worktrees: {}, agents: freed, cards }),
    kind: 'claude',
    isIdle: () => true,
    queuedFor: () => 0,
    followUp: async () => {},
    enqueue: async () => {},
    createAgent: async (wt, prompt, kind) => {
      calls.push(['createAgent', wt, prompt, kind]);
      return 'new-1';
    },
    createWorktree: async (project, branch) => {
      calls.push(['createWorktree', project, branch]);
      return `wt-${branch}`;
    },
    takenBranches: async () => new Set(),
    addProject: async () => 'x',
    adoptHome: () => {},
    progress: () => {},
  });
  assert.deepEqual(out, { state: 'launched', agentId: 'new-1' });
  assert.deepEqual(calls, [
    ['createWorktree', 'shop', 'login-fix'],
    ['createAgent', 'wt-login-fix', 'fix the login redirect', 'codex'],
  ]);

  // In an existing checkout, and a Shared project's lane.
  const inMain = newTaskBatch({ text: 'x', projectId: 'career', worktreeId: 'w-career-main' }, cards).tasks[0];
  assert.equal(inMain.mode, 'existing_worktree');
  assert.equal(inMain.worktreeId, 'w-career-main');
  assert.equal(inMain.lane, 'career');
});
