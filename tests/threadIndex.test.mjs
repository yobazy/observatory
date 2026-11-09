import test from 'node:test';
import assert from 'node:assert/strict';

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
  indexEntry,
  refreshIndex,
  searchIndex,
  pastThreadsFor,
  followsUpText,
  saveIndex,
  loadIndex,
  reloadIndex,
  SUMMARY_CHARS,
  MAX_PAST,
} = await import('../src/nebula/threadIndex.ts');
const { buildRouterPrompt, parsePlan, validatePlan, pastThreadsSection, routerCards } = await import('../src/nebula/router.ts');
const { launchTask, makeBatch } = await import('../src/nebula/batch.ts');

const DAY = 24 * 3600_000;
const NOW = 100 * DAY;

const source = (over = {}) => ({
  id: 'a1',
  projectId: 'shop',
  title: 'Fix login redirect',
  branch: 'fix-login',
  pr: { number: 42, title: 'Send users back to where they were after login' },
  tags: ['auth'],
  need: 'Needs review of the redirect',
  turnSummary: 'Edited 2 files · tests pass',
  archived: false,
  at: NOW - DAY,
  ...over,
});

// ---- the entry ----

test('given a thread that S7 has triaged, its index entry holds its title, branch, tags, PR and a summary of at most 200 characters, and no transcript text', () => {
  const tail = 'You: please fix the redirect\nAgent: I read src/login.ts and changed the redirect handling';
  const e = indexEntry({ ...source({ need: `Needs a decision on the redirect. ${'x'.repeat(400)}` }), tail, transcript: tail });
  assert.equal(e.title, 'Fix login redirect');
  assert.equal(e.branch, 'fix-login');
  assert.deepEqual(e.tags, ['auth']);
  assert.deepEqual(e.pr, { number: 42, title: 'Send users back to where they were after login' });
  assert.ok(e.summary.startsWith('Needs a decision on the redirect.'));
  assert.ok(e.summary.length <= SUMMARY_CHARS);
  assert.deepEqual(Object.keys(e).sort(), ['archived', 'at', 'branch', 'id', 'pr', 'projectId', 'summary', 'tags', 'title']);
  assert.ok(!JSON.stringify(e).includes('I read src/login.ts'), 'no transcript text');

  // What's stored is the same fields, whatever was handed in.
  saveIndex({ a1: { ...e, tail } });
  reloadIndex();
  assert.ok(!localStorage.getItem('observatory.threadIndex').includes('I read src/login.ts'));
  assert.deepEqual(loadIndex().a1, e);

  // No need line: the latest turn summary stands in.
  assert.equal(indexEntry(source({ need: null })).summary, 'Edited 2 files · tests pass');
  // A worktree since removed: its branch and PR stay as they were.
  const later = indexEntry(source({ branch: null, pr: undefined, archived: true, archivedAt: NOW }), e);
  assert.equal(later.branch, 'fix-login');
  assert.equal(later.pr.number, 42);
  assert.equal(later.archivedAt, NOW);
});

// ---- the search ----

const FILLER = [
  'Update the README screenshots',
  'Bump the build cache',
  'Tidy the sidebar spacing',
  'Fix typo in docs',
  'Add dark mode to settings',
  'Speed up the usage scan',
  'Cart sync across tabs',
  'Refactor the queue gate',
];

function bigIndex() {
  const index = {};
  for (let n = 0; n < 199; n++) {
    const title = `${FILLER[n % FILLER.length]} ${n}`;
    index[`f${n}`] = indexEntry(source({ id: `f${n}`, title, branch: `task-${n}`, pr: null, tags: [], need: 'Done and checked', at: NOW - n * 1000 }));
  }
  // An older thread that also mentions login, less closely.
  index.f7 = indexEntry(source({ id: 'f7', title: 'Login page copy', branch: 'login-copy', pr: null, tags: [], need: 'Needs review', at: NOW }));
  index.target = indexEntry(source({ id: 'target', archived: true, archivedAt: NOW - 5 * DAY, at: NOW - 6 * DAY }));
  return index;
}

test('given 200 indexed threads and an item "fix the redirect bug on login again", searchIndex returns at most 10 and "Fix login redirect" on fix-login comes first; an item sharing no words returns none', () => {
  const index = bigIndex();
  assert.equal(Object.keys(index).length, 200);
  const hits = searchIndex(Object.values(index), 'fix the redirect bug on login again');
  assert.ok(hits.length <= 10 && hits.length > 0, `got ${hits.length}`);
  assert.equal(hits[0].title, 'Fix login redirect');
  assert.equal(hits[0].branch, 'fix-login');

  assert.deepEqual(searchIndex(Object.values(index), 'water the garden tomorrow'), []);
  assert.deepEqual(searchIndex(Object.values(index), 'the and of'), [], 'stop words alone match nothing');
});

// ---- the router prompt ----

const card = (over) => ({
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
const worktrees = [{ id: 'wm-shop', projectId: 'shop', branch: 'main', isMain: true }];
const cards = routerCards({ shop: card({ description: 'The storefront.' }) }, [{ id: 'shop', name: 'storefront' }], worktrees);
const open = [
  { id: 'o1', name: 'Cart sync', projectId: 'shop', worktreeId: 'wm-shop', branch: 'main', kind: 'claude', status: 'running', recentPrompts: [] },
];

test('given 5 items, the router prompt holds at most 30 past threads, each once, with its id, project, title, branch, PR, tags, summary and whether it is archived', () => {
  const index = bigIndex();
  const items = [
    { id: 'i1', text: 'fix the redirect bug on login again', context: [] },
    { id: 'i2', text: 'update the README screenshots', context: [] },
    { id: 'i3', text: 'tidy the sidebar spacing', context: [] },
    { id: 'i4', text: 'fix the build cache', context: [] },
    { id: 'i5', text: 'refactor the queue gate', context: [] },
  ];
  const past = pastThreadsFor(items, index, new Set(['o1']));
  assert.ok(past.length <= MAX_PAST && past.length > 10, `got ${past.length}`);
  assert.equal(new Set(past.map((p) => p.id)).size, past.length, 'each once');

  // Handed the same thread twice, the section still lists it once.
  const lines = pastThreadsSection([...past, past[0]]).filter((l) => l.startsWith('- ['));
  assert.equal(lines.length, past.length);
  assert.ok(lines.length <= 30);

  const prompt = buildRouterPrompt(items, cards, open, past);
  const section = prompt.slice(prompt.indexOf('Past threads'));
  assert.match(
    section,
    /- \[target\] "Fix login redirect" in project shop \(branch fix-login, PR #42 "Send users back to where they were after login", tags: auth\), archived\n {2}summary: Needs review of the redirect/,
  );
  const count = (section.match(/^- \[/gm) ?? []).length;
  assert.equal(count, past.length);
  assert.ok(count <= 30);
  assert.ok(!section.includes('[o1]'), 'open sessions are listed once, above');
});

// ---- the plan ----

test('given a plan that sends an item to a past thread, validatePlan accepts it; an id in neither the open sessions nor the past threads is flagged', () => {
  const index = bigIndex();
  const items = [{ id: 'i1', text: 'the login redirect is broken again', context: [] }];
  const ctx = { items, cards, worktrees, sessions: open, pastThreads: pastThreadsFor(items, index, new Set(['o1'])) };
  const reply = JSON.stringify({
    tasks: [{ sourceItemIds: ['i1'], text: 'Fix the login redirect again', target: 'project', projectId: 'shop', mode: 'existing_chat', sessionId: 'target', confidence: 0.9 }],
  });
  const r = parsePlan(reply, ctx);
  assert.ok(r.ok, r.error);
  const [t] = r.plan.tasks;
  assert.equal(t.needsChoice, false);
  assert.equal(t.sessionId, 'target');
  assert.deepEqual(t.past, { title: 'Fix login redirect', archived: true, archivedAt: NOW - 5 * DAY });
  assert.equal(followsUpText(t.past, NOW), 'Follows up Fix login redirect (archived 5 days ago)');
  const v = validatePlan(r.plan, ctx);
  assert.deepEqual(v.issues, []);
  assert.equal(v.canDispatch, true);

  const ghost = { tasks: [{ ...t, past: undefined, sessionId: 'nobody' }] };
  const bad = validatePlan(ghost, ctx);
  assert.equal(bad.canDispatch, false);
  assert.equal(bad.issues[0].kind, 'unassigned');
  assert.match(bad.issues[0].message, /isn't an open session or a past thread/);
  // And the router naming it is flagged for the user, as an unknown session is.
  const parsed = parsePlan(reply.replace('"target"', '"nobody"'), ctx);
  assert.equal(parsed.plan.tasks[0].needsChoice, true);
});

// ---- launching ----

const agent = (id, status, over = {}) => ({
  id,
  worktree_id: 'w-login',
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
  alive: false,
  recent_prompts: [],
  ...over,
});
const batchCards = { shop: card({}) };
const world = (agents) => ({
  projects: { shop: { id: 'shop', repo_path: '/code/shop' } },
  worktrees: {
    'w-shop-main': { id: 'w-shop-main', project_id: 'shop', is_main: true },
    'w-login': { id: 'w-login', project_id: 'shop', is_main: false },
  },
  agents,
  cards: batchCards,
});
function stubDeps(w) {
  const calls = [];
  return {
    calls,
    deps: {
      world: () => w,
      kind: 'claude',
      isIdle: (a) => a.status === 'finished' && !a.archived,
      queuedFor: () => 0,
      followUp: async (a, text) => void calls.push(['followUp', a.id, text]),
      enqueue: async (a, text) => {
        calls.push(['enqueue', a.id, text]);
        return 'queued';
      },
      // The stubbed request: what UnarchiveAgent would be sent for.
      unarchive: async (id) => void calls.push(['request', 'UnarchiveAgent', { id }]),
      createAgent: async (wt, prompt) => {
        calls.push(['createAgent', wt, prompt]);
        return 'new-1';
      },
      createWorktree: async (project, branch) => {
        calls.push(['createWorktree', project, branch]);
        return `w-${branch}`;
      },
      takenBranches: async () => new Set(),
      addProject: async () => 'x',
      adoptHome: () => {},
      progress: () => {},
    },
  };
}
const pastTask = (past) =>
  makeBatch(
    {
      tasks: [
        { id: 't1', sourceItemIds: ['i1'], text: 'Fix the login redirect again', target: 'project', projectId: 'shop', mode: 'existing_chat', sessionId: 'target', past, confidence: 0.9, planCheckpoint: false, needsChoice: false },
      ],
      at: NOW,
    },
    [],
    batchCards,
  ).tasks[0];

test('given a task routed to an archived thread, UnarchiveAgent is called before the follow-up is sent and the task is launched on that thread; given the thread was deleted since, it falls back to a new thread in the same project and its row says so', async () => {
  const t = pastTask({ title: 'Fix login redirect', archived: true, archivedAt: NOW - 5 * DAY });
  const { deps, calls } = stubDeps(world({ target: agent('target', 'finished', { archived: true, archived_at: NOW - 5 * DAY }) }));
  const out = await launchTask(t, deps);
  assert.deepEqual(calls, [
    ['request', 'UnarchiveAgent', { id: 'target' }],
    ['enqueue', 'target', 'Fix the login redirect again'],
  ]);
  assert.equal(out.state, 'launched');
  assert.equal(out.agentId, 'target');

  const gone = stubDeps(world({}));
  const fell = await launchTask(t, gone.deps);
  assert.equal(gone.calls.find((c) => c[0] === 'request'), undefined, 'nothing to unarchive');
  assert.equal(gone.calls.find((c) => c[0] === 'enqueue'), undefined);
  assert.equal(gone.calls[0][0], 'createWorktree');
  assert.equal(gone.calls[0][1], 'shop', 'a new thread in the same project');
  assert.equal(fell.state, 'launched');
  assert.equal(fell.agentId, 'new-1');
  assert.match(fell.note, /Fix login redirect was deleted, so this started a new thread/);
});

test('given a task routed to a finished, unarchived thread, the follow-up is sent with enqueue() and nothing is unarchived', async () => {
  const t = pastTask({ title: 'Fix login redirect', archived: false });
  const { deps, calls } = stubDeps(world({ target: agent('target', 'finished', { alive: true }) }));
  const out = await launchTask(t, deps);
  assert.deepEqual(calls, [['enqueue', 'target', 'Fix the login redirect again']]);
  assert.equal(out.agentId, 'target');
});

// ---- refresh ----

test('given a thread is deleted in nebula, its index entry is dropped on the next refresh', () => {
  const index = { a1: indexEntry(source()), a2: indexEntry(source({ id: 'a2', title: 'Other' })) };
  const alive = new Set(['a1']);
  const next = refreshIndex(index, [source()], (id) => alive.has(id));
  assert.deepEqual(Object.keys(next), ['a1']);
  // Nothing changed: the same index back, so nothing is written.
  assert.equal(refreshIndex(next, [source()], (id) => alive.has(id)), next);
  // Archiving updates the entry.
  const archived = refreshIndex(next, [source({ archived: true, archivedAt: NOW })], () => true);
  assert.equal(archived.a1.archived, true);
  assert.equal(archived.a1.archivedAt, NOW);
});
