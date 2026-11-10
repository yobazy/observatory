import test from 'node:test';
import assert from 'node:assert/strict';

/** A localStorage stand-in: what's saved survives a "reload" of the store. */
function stubStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}
globalThis.localStorage = stubStorage();

const {
  budgets,
  budgetHold,
  holds,
  holdOn,
  holdText,
  holdSummary,
  launchPick,
  topLine,
  NO_HOLDS,
} = await import('../src/nebula/budgetHold.ts');
const { makeBatch, laneCapper, launchTask, allBatches, reloadBatches, startAnyway, updateTask } = await import(
  '../src/nebula/batch.ts'
);
const { loadCards, saveCard } = await import('../src/nebula/cards.ts');

// ---- fixtures ----

const NOW_S = new Date(2026, 10, 8, 15).getTime() / 1000;
const NOW = NOW_S * 1000;

const card = (over = {}) => ({
  description: '',
  skills: [],
  skillNotes: {},
  taskKinds: [],
  policy: 'isolated',
  concurrency: 1,
  isHome: false,
  homeFolder: null,
  schedulingInstruction: '',
  ...over,
});
const cards = { desk: card(), general: card(), shop: card() };

const projects = {
  desk: { id: 'desk', name: 'nebula-desktop', repo_path: '/code/nebula-desktop' },
  general: { id: 'general', name: 'general', repo_path: '/code/general' },
  shop: { id: 'shop', name: 'shop', repo_path: '/code/shop' },
};
const worktrees = {
  'w-desk': { id: 'w-desk', project_id: 'desk', path: '/code/nebula-desktop', is_main: true, branch: 'main' },
  'w-general': { id: 'w-general', project_id: 'general', path: '/code/general', is_main: true, branch: 'main' },
  'w-shop': { id: 'w-shop', project_id: 'shop', path: '/code/shop', is_main: true, branch: 'main' },
};

/** One hour of spend, in recorded dollars so the sums are exact. */
const spend = (cwd, dollars, hoursAgo = 0) => ({
  source: 'claude',
  session: `${cwd}-${hoursAgo}`,
  cwd,
  model: 'claude-opus-5-5',
  hour: Math.floor(NOW_S / 3600) * 3600 - hoursAgo * 3600,
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  responses: 1,
  recordedCost: dollars,
});
const state = (buckets, prefs = {}) => ({
  usage: { sources: [], files: 1, buckets },
  prefs,
  projects,
  worktrees,
  agents: {},
});

const agent = (id, status, over = {}) => ({
  id,
  worktree_id: 'w-shop',
  name: id,
  status,
  archived: false,
  archived_at: 0,
  unseen: false,
  status_changed_at: 0,
  kind: 'claude',
  custom_harness: null,
  model: null,
  effort: null,
  session_id: null,
  cloud_session_id: null,
  issue_url: null,
  sort_order: 0,
  alive: true,
  recent_prompts: [],
  ...over,
});

const planTask = (n, over = {}) => ({
  id: `t${n}`,
  sourceItemIds: [`i${n}`],
  text: `task ${n}`,
  target: 'project',
  projectId: 'shop',
  mode: 'new_worktree',
  confidence: 0.9,
  planCheckpoint: false,
  needsChoice: false,
  ...over,
});
const pending = (...tasks) => makeBatch({ tasks, at: NOW }, [], cards, 'b1').tasks;
const limits = (cap = 4) => ({ globalCap: cap, laneCap: laneCapper(cards) });

/** $52 today against a $50 daily budget. */
const overToday = state([spend('/code/shop', 52)], { dailyBudget: 50 });

// ---- budgetHold() ----

test('given a daily budget of $50 and $52 spent today, budgetHold() returns it with $52 and $50; $49 gives null; only an over weekly budget gives the weekly one', () => {
  const over = budgetHold(budgets(overToday, NOW_S));
  assert.equal(over.kind, 'daily');
  assert.equal(over.spent, 52);
  assert.equal(over.budget, 50);

  assert.equal(budgetHold(budgets(state([spend('/code/shop', 49)], { dailyBudget: 50 }), NOW_S)), null);

  // $60 over the week, $5 of it today: the daily $50 is fine, the weekly $40 isn't.
  const week = state([spend('/code/shop', 5), spend('/code/shop', 55, 72)], { dailyBudget: 50, weeklyBudget: 40 });
  const weekly = budgetHold(budgets(week, NOW_S));
  assert.equal(weekly.kind, 'weekly');
  assert.equal(weekly.spent, 60);
  assert.equal(weekly.budget, 40);

  assert.equal(budgetHold([]), null);
});

// ---- the runner's decision ----

test('given a hold and 3 pending tasks with room under the cap, the pick is empty and the 3 stay pending; with no hold they launch as before', () => {
  const tasks = pending(planTask(1), planTask(2), planTask(3));
  const h = holds(overToday, cards, NOW_S);
  assert.deepEqual(launchPick(tasks, {}, limits(), h, NOW), []);
  assert.deepEqual(tasks.map((t) => t.state), ['pending', 'pending', 'pending']);

  assert.deepEqual(launchPick(tasks, {}, limits(), NO_HOLDS, NOW).map((t) => t.id), ['b1-t1', 'b1-t2', 'b1-t3']);
  const under = holds(state([spend('/code/shop', 49)], { dailyBudget: 50 }), cards, NOW_S);
  assert.deepEqual(launchPick(tasks, {}, limits(), under, NOW).map((t) => t.id), ['b1-t1', 'b1-t2', 'b1-t3']);
});

test('given a hold, no running session is stopped and a reply to a running or finished thread is sent as usual', async () => {
  const h = holds(overToday, cards, NOW_S);
  // Launched tasks whose sessions run on: the hold touches only what's pending.
  const [running, finished, waiting] = pending(planTask(1), planTask(2), planTask(3));
  running.state = 'launched';
  running.agentId = 'run';
  finished.state = 'launched';
  finished.agentId = 'fin';
  const agents = { run: agent('run', 'running'), fin: agent('fin', 'finished') };
  assert.equal(holdOn(running, h), null);
  assert.equal(holdOn(finished, h), null);
  assert.ok(holdOn(waiting, h));
  assert.deepEqual(launchPick([running, finished, waiting], agents, limits(), h, NOW), []);
  assert.equal(running.state, 'launched');
  assert.equal(finished.state, 'launched');

  // A reply into a running thread is queued and into a finished one sent,
  // as it would be with no budget at all; nothing is stopped or archived.
  const calls = [];
  const deps = (status) => ({
    world: () => ({ projects, worktrees, agents: { chat: agent('chat', status) }, cards }),
    kind: 'claude',
    isIdle: (a) => a.status === 'finished',
    queuedFor: () => 0,
    followUp: async (a, text) => void calls.push(['followUp', a.id, text]),
    enqueue: async (a, text) => void calls.push(['enqueue', a.id, text]),
    createAgent: async () => assert.fail('no new session'),
    createWorktree: async () => assert.fail('no new worktree'),
    takenBranches: async () => new Set(),
    addProject: async () => assert.fail('no new project'),
    adoptHome: () => {},
    progress: () => {},
  });
  const [reply] = pending(planTask(9, { mode: 'existing_chat', sessionId: 'chat' }));
  reply.budgetOverride = true;
  await launchTask(reply, deps('running'));
  await launchTask(reply, deps('finished'));
  assert.deepEqual(calls, [
    ['enqueue', 'chat', 'task 9'],
    ['followUp', 'chat', 'task 9'],
  ]);
});

test('given a hold, each pending row says "Held: $52 of $50 today" and the summary "3 held by budget"; Start anyway launches one and the other 2 stay held', () => {
  globalThis.localStorage.clear();
  reloadBatches();
  const batch = makeBatch({ tasks: [planTask(1), planTask(2), planTask(3)], at: NOW }, [], cards, 'b-held');
  globalThis.localStorage.setItem('observatory.dispatch.batches', JSON.stringify({ batches: [batch] }));
  reloadBatches();
  const h = holds(overToday, cards, NOW_S);
  const tasks = () => allBatches()[0].tasks;

  for (const t of tasks()) assert.equal(holdText(holdOn(t, h)), 'Held: $52 of $50 today');
  assert.equal(holdSummary(tasks(), h), '3 held by budget');

  assert.equal(startAnyway('b-held', 'b-held-t2'), true);
  assert.deepEqual(launchPick(tasks(), {}, limits(), h, NOW).map((t) => t.id), ['b-held-t2']);
  assert.equal(holdSummary(tasks(), h), '2 held by budget');

  // Once it's out, it's out: Start anyway is for pending tasks only.
  updateTask('b-held', 'b-held-t2', { state: 'launched', agentId: 'x', launchedAt: NOW });
  assert.equal(startAnyway('b-held', 'b-held-t2'), false);
  assert.deepEqual(launchPick(tasks(), {}, limits(), h, NOW), []);

  const weekly = budgets(state([spend('/code/shop', 90, 48)], { weeklyBudget: 80 }), NOW_S);
  assert.equal(holdText({ kind: 'budget', budget: budgetHold(weekly) }), 'Held: $90 of $80 in the last 7 days');
});

test('given spend under every budget, or a budget raised above spend, the held tasks launch in plan order on the next pass, within the caps', () => {
  const tasks = pending(planTask(1), planTask(2), planTask(3), planTask(4), planTask(5));
  assert.deepEqual(launchPick(tasks, {}, limits(3), holds(overToday, cards, NOW_S), NOW), []);

  const raised = holds(state([spend('/code/shop', 52)], { dailyBudget: 60 }), cards, NOW_S);
  assert.deepEqual(launchPick(tasks, {}, limits(3), raised, NOW).map((t) => t.id), ['b1-t1', 'b1-t2', 'b1-t3']);

  // A new day: yesterday's $52 no longer counts against today's budget.
  const yesterday = holds(state([spend('/code/shop', 52, 24)], { dailyBudget: 50 }), cards, NOW_S);
  assert.deepEqual(launchPick(tasks, {}, limits(3), yesterday, NOW).map((t) => t.id), ['b1-t1', 'b1-t2', 'b1-t3']);
});

// ---- where the money went ----

test('given today split $30 nebula-desktop, $12 general and $10 elsewhere, the daily budget reads "nebula-desktop $30, general $12"', () => {
  const s = state(
    [spend('/code/general', 12), spend('/code/nebula-desktop', 30), spend('/elsewhere', 10)],
    { dailyBudget: 50 },
  );
  const [daily] = budgets(s, NOW_S);
  assert.equal(daily.spent, 52);
  assert.equal(topLine(daily), 'nebula-desktop $30, general $12');
  assert.deepEqual(daily.top, [
    { label: 'nebula-desktop', cost: 30 },
    { label: 'general', cost: 12 },
  ]);
});

// ---- a card's own budget ----

test('given a card with a daily budget of $20 and that project at $21 today, only its tasks are held, and other projects launch', () => {
  const own = { ...cards, desk: card({ dailyBudget: 20 }) };
  const s = state([spend('/code/nebula-desktop', 21), spend('/code/shop', 3)]);
  const h = holds(s, own, NOW_S);
  assert.equal(h.budget, null);

  const tasks = pending(planTask(1, { projectId: 'desk' }), planTask(2, { projectId: 'shop' }), planTask(3, { target: 'home', projectId: undefined }));
  assert.equal(holdText(holdOn(tasks[0], h)), 'Held: nebula-desktop is at $21 of $20 today');
  assert.equal(holdOn(tasks[1], h), null);
  assert.deepEqual(launchPick(tasks, {}, limits(), h, NOW).map((t) => t.id), ['b1-t2', 'b1-t3']);

  // Under its budget, it launches too.
  const under = holds(state([spend('/code/nebula-desktop', 19)]), own, NOW_S);
  assert.deepEqual(launchPick(tasks, {}, limits(), under, NOW).map((t) => t.id), ['b1-t1', 'b1-t2', 'b1-t3']);
});

test("a card's daily budget is saved and read back; a blank or zero one is dropped", () => {
  globalThis.localStorage.clear();
  saveCard('desk', card({ dailyBudget: 20 }));
  saveCard('shop', card({ dailyBudget: 0 }));
  const back = loadCards();
  assert.equal(back.desk.dailyBudget, 20);
  assert.equal('dailyBudget' in back.shop, false);
});
