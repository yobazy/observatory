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
  buildStartingPrompt,
  makeBatch,
  nextLaunchable,
  occupies,
  globalCap,
  laneCapper,
  launchTask,
  reconcile,
  shouldRetry,
  homeSignature,
  dispatchPlan,
  allBatches,
  reloadBatches,
  updateTask,
  DEFAULT_CAP,
  PLAN_POSTFIX,
  HOME_LANE,
  LAUNCH_TIMEOUT_MS,
} = await import('../src/nebula/batch.ts');
const { handOffPlan, loadRoutedPlan } = await import('../src/nebula/router.ts');
const { pasteList, dispatchItems, reloadItems } = await import('../src/nebula/dispatch.ts');

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

const agent = (id, status, over = {}) => ({
  id,
  worktree_id: 'w-shop-main',
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
  planCheckpoint: true,
  needsChoice: false,
  ...over,
});

const HOME_INSTRUCTION = 'Check my calendar, ask me for a time, then book it.';
const cards = {
  shop: card({ description: 'The storefront.' }),
  career: card({ policy: 'shared', concurrency: 1, skills: ['apply'] }),
  home: card({ policy: 'shared', isHome: true, homeFolder: '/me/home', schedulingInstruction: HOME_INSTRUCTION }),
};
const world = (over = {}) => ({
  projects: {
    shop: { id: 'shop', repo_path: '/code/shop' },
    career: { id: 'career', repo_path: '/code/career' },
    home: { id: 'home', repo_path: '/me/home' },
  },
  worktrees: {
    'w-shop-main': { id: 'w-shop-main', project_id: 'shop', is_main: true },
    'w-career-main': { id: 'w-career-main', project_id: 'career', is_main: true },
    'w-home-main': { id: 'w-home-main', project_id: 'home', is_main: true },
  },
  agents: {},
  cards,
  ...over,
});

const NOW = 1_000_000;
const limits = (cap = globalCap(undefined), c = cards) => ({ globalCap: cap, laneCap: laneCapper(c) });

/** Stubbed actions: records each call, and starts sessions with made-up ids. */
function stubDeps(w, over = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    deps: {
      world: () => w,
      kind: 'claude',
      isIdle: (a) => a.status === 'finished',
      queuedFor: () => 0,
      followUp: async (a, text) => void calls.push(['followUp', a.id, text]),
      enqueue: async (a, text) => void calls.push(['enqueue', a.id, text]),
      createAgent: async (wt, prompt) => {
        calls.push(['createAgent', wt, prompt]);
        return `new-${++n}`;
      },
      createWorktree: async (project, branch) => {
        calls.push(['createWorktree', project, branch]);
        return `wt-${branch}`;
      },
      takenBranches: async () => new Set(),
      addProject: async (path) => {
        calls.push(['addProject', path]);
        throw new Error(`${path} is not a git repository`);
      },
      adoptHome: (id) => calls.push(['adoptHome', id]),
      progress: (patch) => calls.push(['progress', patch]),
      ...over,
    },
  };
}

// ---- the global cap ----

test('given 6 tasks and the default global cap of 4, nextLaunchable returns 4 and 2 stay pending; a finished or terminated session frees exactly one slot', () => {
  assert.equal(DEFAULT_CAP, 4);
  assert.equal(globalCap(undefined), 4, 'unset is the default');
  assert.equal(globalCap(2), 2, 'editable');

  const batch = makeBatch({ tasks: [1, 2, 3, 4, 5, 6].map((n) => planTask(n)), at: NOW }, [], cards, 'b1');
  const first = nextLaunchable(batch.tasks, {}, limits(), NOW);
  assert.equal(first.length, 4);

  // Those 4 launch and run.
  const agents = {};
  let tasks = batch.tasks.map((t) => {
    if (!first.includes(t)) return t;
    agents[`a-${t.id}`] = agent(`a-${t.id}`, 'running');
    return { ...t, state: 'launched', agentId: `a-${t.id}`, launchedAt: NOW };
  });
  assert.equal(tasks.filter((t) => t.state === 'pending').length, 2);
  assert.deepEqual(nextLaunchable(tasks, agents, limits(), NOW), [], 'no slot while all 4 run');

  // Waiting on you still holds the slot.
  const asking = { ...agents, [tasks[0].agentId]: agent(tasks[0].agentId, 'needs_feedback') };
  assert.deepEqual(nextLaunchable(tasks, asking, limits(), NOW), []);

  for (const status of ['finished', 'terminated']) {
    const freed = { ...agents, [tasks[0].agentId]: agent(tasks[0].agentId, status) };
    const next = nextLaunchable(tasks, freed, limits(), NOW);
    assert.equal(next.length, 1, `exactly one launches when one is ${status}`);
    assert.equal(next[0].id, tasks[4].id, 'the next in plan order');
  }
});

test('a task whose launch is out holds its slot, so a second pass does not launch it again', () => {
  const batch = makeBatch({ tasks: [planTask(1), planTask(2)], at: NOW }, [], cards, 'b1');
  const tasks = [{ ...batch.tasks[0], state: 'launching', launchingAt: NOW }, batch.tasks[1]];
  assert.ok(occupies(tasks[0], {}, NOW));
  const next = nextLaunchable(tasks, {}, limits(1), NOW);
  assert.deepEqual(next, [], 'the cap of 1 is taken by the launching task');
  assert.deepEqual(nextLaunchable(tasks, {}, limits(2), NOW).map((t) => t.id), [tasks[1].id], 'never the launching one');
});

test('a session just created but not yet in the store holds its slot for a while, then lets go', () => {
  const t = { ...makeBatch({ tasks: [planTask(1)], at: NOW }, [], cards).tasks[0], state: 'launched', agentId: 'x', launchedAt: NOW };
  assert.ok(occupies(t, {}, NOW + 1_000));
  assert.ok(!occupies(t, {}, NOW + 60_000));
  assert.ok(!occupies(t, { x: agent('x', 'running', { archived: true }) }, NOW), 'archived lets go');
});

// ---- a Shared project's own cap ----

test('given a Shared project with concurrency 1 and 2 tasks for it, only 1 runs at a time even with global slots free', () => {
  const plan = [
    planTask(1, { projectId: 'career', mode: 'existing_worktree', worktreeId: 'w-career-main' }),
    planTask(2, { projectId: 'career', mode: 'existing_worktree', worktreeId: 'w-career-main' }),
    planTask(3),
  ];
  const batch = makeBatch({ tasks: plan, at: NOW }, [], cards, 'b1');
  assert.equal(batch.tasks[0].lane, 'career');
  assert.equal(batch.tasks[2].lane, null, 'Isolated projects have no lane');

  const first = nextLaunchable(batch.tasks, {}, limits(), NOW);
  assert.deepEqual(first.map((t) => t.id), [batch.tasks[0].id, batch.tasks[2].id]);

  const running = { ...batch.tasks[0], state: 'launched', agentId: 'c1', launchedAt: NOW };
  const tasks = [running, batch.tasks[1], { ...batch.tasks[2], state: 'launched', agentId: 's1', launchedAt: NOW }];
  const agents = { c1: agent('c1', 'running'), s1: agent('s1', 'running') };
  assert.deepEqual(nextLaunchable(tasks, agents, limits(), NOW), [], '2 of 4 global slots free, but career is full');

  agents.c1 = agent('c1', 'finished');
  assert.deepEqual(nextLaunchable(tasks, agents, limits(), NOW).map((t) => t.id), [batch.tasks[1].id]);

  const two = { ...cards, career: { ...cards.career, concurrency: 2 } };
  assert.equal(nextLaunchable([batch.tasks[0], batch.tasks[1]], {}, limits(4, two), NOW).length, 2, 'concurrency 2 runs both');
});

test('a Shared project launches into its main checkout, even when the plan said new worktree', async () => {
  const [t] = makeBatch({ tasks: [planTask(1, { projectId: 'career', mode: 'new_worktree' })], at: NOW }, [], cards).tasks;
  const { deps, calls } = stubDeps(world());
  const out = await launchTask(t, deps);
  assert.equal(out.state, 'launched');
  assert.equal(calls.find((c) => c[0] === 'createWorktree'), undefined);
  assert.equal(calls.find((c) => c[0] === 'createAgent')[1], 'w-career-main');
});

// ---- follow-ups ----

test('given an existing_chat task whose session is running, the prompt is enqueued and not sent directly; given it is idle, followUp() is called', async () => {
  const [t] = makeBatch(
    { tasks: [planTask(1, { mode: 'existing_chat', sessionId: 'chat', planCheckpoint: false })], at: NOW },
    [],
    cards,
  ).tasks;

  const busy = stubDeps(world({ agents: { chat: agent('chat', 'running') } }));
  const queued = await launchTask(t, busy.deps);
  assert.deepEqual(busy.calls.filter((c) => c[0] !== 'progress'), [['enqueue', 'chat', 'task 1']]);
  assert.deepEqual(queued, { state: 'launched', agentId: 'chat', note: 'queued' });

  const idle = stubDeps(world({ agents: { chat: agent('chat', 'finished') } }));
  const sent = await launchTask(t, idle.deps);
  assert.deepEqual(idle.calls.filter((c) => c[0] !== 'progress'), [['followUp', 'chat', 'task 1']]);
  assert.deepEqual(sent, { state: 'launched', agentId: 'chat' });

  // Idle, but prompts are already queued ahead: it waits its turn.
  const ahead = stubDeps(world({ agents: { chat: agent('chat', 'finished') } }), { queuedFor: () => 1 });
  await launchTask(t, ahead.deps);
  assert.equal(ahead.calls.find((c) => c[0] === 'followUp'), undefined);
});

test('a follow-up into a chat that is gone fails rather than starting something else', async () => {
  const [t] = makeBatch({ tasks: [planTask(1, { mode: 'existing_chat', sessionId: 'gone' })], at: NOW }, [], cards).tasks;
  const { deps, calls } = stubDeps(world());
  assert.equal((await launchTask(t, deps)).state, 'failed');
  assert.equal(calls.length, 0);
});

// ---- the starting prompt ----

const KINDS = ['claude', 'codex', 'cursor', 'pi', 'muse', 'open_code', 'my-harness'];

test('given planCheckpoint true, the starting prompt ends with the plan-and-stop postfix for every agent kind; given false, no postfix', () => {
  const base = { text: 'Fix the flaky checkout test', target: 'project', context: [], planCheckpoint: true };
  for (const kind of KINDS) {
    const p = buildStartingPrompt(base, { kind });
    assert.ok(p.endsWith(PLAN_POSTFIX), kind);
    assert.ok(p.startsWith('Fix the flaky checkout test'), kind);
    const off = buildStartingPrompt({ ...base, planCheckpoint: false }, { kind });
    assert.ok(!off.includes(PLAN_POSTFIX), kind);
    assert.equal(off, 'Fix the flaky checkout test');
  }
  assert.match(PLAN_POSTFIX, /numbered plan/);
  assert.match(PLAN_POSTFIX, /stop/);
  assert.match(PLAN_POSTFIX, /approval/);
  assert.match(PLAN_POSTFIX, /don't edit/);
});

test('given a task for a project whose card lists the skill the router chose, the starting prompt references it', () => {
  const t = { text: 'apply to the Swiftly role', target: 'project', context: [], skill: 'apply', planCheckpoint: false };
  assert.equal(buildStartingPrompt(t, { kind: 'claude' }), '/apply apply to the Swiftly role');
  for (const kind of ['codex', 'cursor', 'my-harness']) {
    assert.match(buildStartingPrompt(t, { kind }), /Use the apply skill/, kind);
  }
  const withCheckpoint = buildStartingPrompt({ ...t, planCheckpoint: true }, { kind: 'claude' });
  assert.ok(withCheckpoint.startsWith('/apply ') && withCheckpoint.endsWith(PLAN_POSTFIX));
});

test("the items' detail lines go in the prompt", () => {
  const routed = { tasks: [planTask(1, { sourceItemIds: ['i1', 'i2'], planCheckpoint: false })], at: NOW };
  const [t] = makeBatch(routed, [{ id: 'i1', context: ['the Akkodis one'] }, { id: 'i2', context: ['by Friday'] }], cards).tasks;
  assert.deepEqual(t.context, ['the Akkodis one', 'by Friday']);
  assert.equal(buildStartingPrompt(t, { kind: 'claude' }), 'task 1\n\nDetails:\n- the Akkodis one\n- by Friday');
});

// ---- you and Home ----

test('given a you task and a Home card with a scheduling instruction, a Home session is created whose prompt includes the instruction and the task text', async () => {
  const [t] = makeBatch({ tasks: [planTask(1, { target: 'you', projectId: undefined, mode: undefined, text: 'work through Formation problems' })], at: NOW }, [], cards).tasks;
  assert.equal(t.state, 'pending');
  assert.equal(t.lane, HOME_LANE, 'counts against Home as well as the global cap');
  assert.deepEqual(nextLaunchable([t], {}, limits(), NOW), [t]);

  const { deps, calls } = stubDeps(world());
  const out = await launchTask(t, deps);
  assert.equal(out.state, 'launched');
  const [, wt, prompt] = calls.find((c) => c[0] === 'createAgent');
  assert.equal(wt, 'w-home-main');
  assert.ok(prompt.includes(HOME_INSTRUCTION));
  assert.ok(prompt.includes('work through Formation problems'));
  assert.ok(prompt.endsWith(PLAN_POSTFIX));
});

test('given a you task and no scheduling instruction, no session is created and the task stays on the list', async () => {
  const unscheduled = { ...cards, home: { ...cards.home, schedulingInstruction: '' } };
  const [t] = makeBatch({ tasks: [planTask(1, { target: 'you', projectId: undefined, mode: undefined })], at: NOW }, [], unscheduled).tasks;
  assert.equal(t.state, 'listed');
  assert.deepEqual(nextLaunchable([t], {}, limits(4, unscheduled), NOW), [], 'never launched');

  // Even if it were tried, nothing starts.
  const { deps, calls } = stubDeps(world({ cards: unscheduled }));
  const out = await launchTask({ ...t, state: 'pending' }, deps);
  assert.equal(out.state, 'blocked');
  assert.equal(calls.length, 0);
});

test('a Home that is a plain folder, not a git repo, blocks its tasks with a clear message and starts nothing', async () => {
  const folderCards = {
    shop: cards.shop,
    'folder:/me/errands': card({ policy: 'shared', isHome: true, homeFolder: '/me/errands', schedulingInstruction: HOME_INSTRUCTION }),
  };
  const [t] = makeBatch({ tasks: [planTask(1, { target: 'home', projectId: undefined, mode: undefined })], at: NOW }, [], folderCards).tasks;
  const { deps, calls } = stubDeps(world({ cards: folderCards }));
  const out = await launchTask(t, deps);
  assert.equal(out.state, 'blocked');
  assert.match(out.note, /Home needs to be a git folder/);
  assert.equal(out.blockedOnHome, homeSignature(folderCards));
  assert.deepEqual(calls.map((c) => c[0]), ['addProject'], 'asked the daemon, started nothing');

  // It tries again when Home changes, or after a while.
  const blocked = { ...t, state: 'blocked', blockedOnHome: out.blockedOnHome, blockedAt: NOW };
  assert.ok(!shouldRetry(blocked, homeSignature(folderCards), NOW + 1000));
  assert.ok(shouldRetry(blocked, homeSignature(cards), NOW + 1000));
  assert.ok(shouldRetry(blocked, homeSignature(folderCards), NOW + 10 * 60_000));
});

test('a plain-folder Home that is a git repo is added as a project and its card moves to the project', async () => {
  const folderCards = { 'folder:/me/errands': card({ policy: 'shared', isHome: true, homeFolder: '/me/errands' }) };
  const [t] = makeBatch({ tasks: [planTask(1, { target: 'home', projectId: undefined, mode: undefined })], at: NOW }, [], folderCards).tasks;
  const { deps, calls } = stubDeps(world({ cards: folderCards }), {
    addProject: async (path) => {
      calls.push(['addProject', path]);
      return 'p-errands';
    },
  });
  const out = await launchTask(t, deps);
  assert.deepEqual(out, { state: 'pending' }, 'starts once its main checkout shows up');
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['addProject', '/me/errands'], ['adoptHome', 'p-errands']]);

  // Already a project by then: just moves the card.
  const w = world({ cards: folderCards });
  w.projects.errands = { id: 'errands', repo_path: '/me/errands/' };
  const again = stubDeps(w);
  await launchTask(t, again.deps);
  assert.deepEqual(again.calls, [['adoptHome', 'errands']]);
});

// ---- new worktrees ----

test('a new-worktree task gets a branch named from its text, not one already taken', async () => {
  const [t] = makeBatch({ tasks: [planTask(1, { text: 'Fix the login redirect!' })], at: NOW }, [], cards).tasks;
  const { deps, calls } = stubDeps(world(), { takenBranches: async () => new Set(['fix-the-login-redirect']) });
  const out = await launchTask(t, deps);
  assert.deepEqual(out, { state: 'launched', agentId: 'new-1' });
  assert.deepEqual(calls.find((c) => c[0] === 'createWorktree'), ['createWorktree', 'shop', 'fix-the-login-redirect-2']);
  assert.equal(calls.find((c) => c[0] === 'createAgent')[1], 'wt-fix-the-login-redirect-2');
  // What a restart needs to find the session, saved before it was asked for.
  const progress = calls.filter((c) => c[0] === 'progress').map((c) => c[1]);
  assert.deepEqual(progress[0], { createdWorktreeId: 'wt-fix-the-login-redirect-2' });
  assert.ok(progress[1].prompt.startsWith('Fix the login redirect!'));
});

// ---- persistence and restarts ----

test('given the app restarts while tasks are pending, they are still pending after reload and keep launching as slots free', () => {
  localStorage.clear();
  reloadItems();
  reloadBatches();
  pasteList('one\ntwo\nthree\nfour\nfive\nsix');
  const items = dispatchItems();
  const plan = { tasks: items.map((i, n) => planTask(n + 1, { sourceItemIds: [i.id], text: i.text })) };
  const batch = dispatchPlan(handOffPlan(plan), items, cards);

  assert.equal(loadRoutedPlan(), null, 'the hand-off is taken');
  assert.ok(dispatchItems().every((i) => i.batchId === batch.id && !i.checked), 'items linked, not checked off');

  // Four launch; then the app quits.
  const first = nextLaunchable(allBatches()[0].tasks, {}, limits(), NOW);
  first.forEach((t, n) => updateTask(batch.id, t.id, { state: 'launched', agentId: `a${n}`, launchedAt: NOW }));

  reloadBatches();
  reloadItems();
  const after = allBatches()[0].tasks;
  assert.equal(after.filter((t) => t.state === 'pending').length, 2);
  assert.equal(after.filter((t) => t.state === 'launched').length, 4);
  assert.ok(dispatchItems().every((i) => i.batchId === batch.id), 'the link survives too');

  const agents = Object.fromEntries([0, 1, 2, 3].map((n) => [`a${n}`, agent(`a${n}`, n === 2 ? 'finished' : 'running')]));
  const next = nextLaunchable(after, agents, limits(), NOW);
  assert.deepEqual(next.map((t) => t.text), ['five']);
});

test('a task left launching by a restart is matched to the session it started, or given up on, never launched twice', () => {
  const [t] = makeBatch({ tasks: [planTask(1)], at: NOW }, [], cards).tasks;
  const launching = { ...t, state: 'launching', launchingAt: NOW, prompt: 'task 1\n\n' + PLAN_POSTFIX, createdWorktreeId: 'wt-x' };

  assert.equal(reconcile(launching, {}, new Set(), NOW + 1000), null, 'too soon to say');
  assert.deepEqual(nextLaunchable([launching], {}, limits(), NOW), [], 'not relaunched meanwhile');

  const started = agent('found', 'running', {
    worktree_id: 'wt-x',
    recent_prompts: [{ text: launching.prompt, submitted_at: NOW }],
  });
  assert.equal(reconcile(launching, { found: started }, new Set(), NOW + 1000).agentId, 'found');
  assert.equal(reconcile(launching, { found: started }, new Set(['found']), NOW + 1000), null, 'not one another task holds');

  const late = reconcile(launching, {}, new Set(), NOW + LAUNCH_TIMEOUT_MS + 1);
  assert.equal(late.state, 'failed');

  const followUp = { ...launching, agentId: 'chat' };
  assert.equal(reconcile(followUp, {}, new Set(), NOW).state, 'launched', 'a follow-up is taken as sent');
});
