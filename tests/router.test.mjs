import test from 'node:test';
import assert from 'node:assert/strict';

/** A localStorage stand-in for the hand-off. */
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
  buildRouterPrompt,
  parsePlan,
  validatePlan,
  routerCards,
  retarget,
  withMode,
  handOffPlan,
  loadRoutedPlan,
  previewReply,
  CONFIDENCE_THRESHOLD,
} = await import('../src/nebula/router.ts');

const items = [
  { id: 'i1', text: 'go to the gym', context: [] },
  { id: 'i2', text: 'update my resume', context: ['the Akkodis one'] },
  { id: 'i3', text: 'send it to Lauren for the Akkodis role', context: [] },
  { id: 'i4', text: 'fix the flaky checkout test', context: [] },
];

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

const worktrees = [
  { id: 'wm-career', projectId: 'career', branch: 'main', isMain: true },
  { id: 'wm-shop', projectId: 'shop', branch: 'main', isMain: true },
  { id: 'w-cart', projectId: 'shop', branch: 'cart-sync', isMain: false },
];

const cards = routerCards(
  {
    career: card({
      description: 'Job search: applications, outreach and the tracker.',
      skills: ['apply'],
      skillNotes: { apply: 'Apply to a job posting' },
      taskKinds: ['job applications'],
      policy: 'shared',
      concurrency: 2,
    }),
    shop: card({ description: 'The storefront web app.' }),
    'folder:/Users/me/home': card({
      description: 'Errands and my calendar.',
      policy: 'shared',
      isHome: true,
      homeFolder: '/Users/me/home',
      schedulingInstruction: 'Check my calendar, ask, then book it.',
    }),
    gone: card({ description: 'A project since removed.' }),
  },
  [
    { id: 'career', name: 'career-ops' },
    { id: 'shop', name: 'storefront' },
  ],
  worktrees,
);

const sessions = [
  {
    id: 'a1',
    name: 'Akkodis call notes',
    projectId: 'career',
    worktreeId: 'wm-career',
    branch: 'main',
    kind: 'claude',
    status: 'idle',
    recentPrompts: ['older prompt', 'summarize the Akkodis call transcript with Lauren'],
  },
  {
    id: 'a2',
    name: 'Cart sync',
    projectId: 'shop',
    worktreeId: 'w-cart',
    branch: 'cart-sync',
    kind: 'codex',
    status: 'running',
    recentPrompts: ['sync the cart across tabs'],
  },
];

const ctx = { items, cards, worktrees, sessions };
const reply = (tasks) => JSON.stringify({ tasks });

test('the router prompt has every item, card description, and open session with its recent prompt', () => {
  const prompt = buildRouterPrompt(items, cards, sessions);
  for (const i of items) {
    assert.ok(prompt.includes(i.text), `item ${i.id}`);
    assert.ok(prompt.includes(i.id), `item id ${i.id}`);
  }
  assert.ok(prompt.includes('the Akkodis one'), 'item context');
  for (const c of cards) assert.ok(prompt.includes(c.description), `card ${c.projectId}`);
  for (const s of sessions) {
    assert.ok(prompt.includes(`[${s.id}]`), `session ${s.id}`);
    assert.ok(prompt.includes(s.recentPrompts.at(-1)), `recent prompt of ${s.id}`);
  }
  assert.ok(prompt.includes('apply (Apply to a job posting)'), 'skills with their notes');
  assert.ok(prompt.includes('job applications'), 'task kinds');
  assert.ok(prompt.includes('Shared, main checkout wm-career, at most 2 at once'), 'policy');
  assert.ok(prompt.includes('Can schedule: yes'), 'whether Home can schedule');
  assert.ok(!prompt.includes('A project since removed'), "a removed project's card is left out");
});

test('the router prompt trims long and many recent prompts', () => {
  const long = { ...sessions[0], recentPrompts: ['p1', 'p2', 'p3', 'p4', 'x'.repeat(2000)] };
  const prompt = buildRouterPrompt(items, cards, [long]);
  assert.ok(!prompt.includes('"p1"') && !prompt.includes('"p2"'), 'only the last few prompts');
  assert.ok(prompt.includes('"p3"'));
  assert.ok(!prompt.includes('x'.repeat(400)), 'each prompt is cut short');
});

test('two source items mapped to one task merge, and one item mapped to two tasks splits', () => {
  const merged = parsePlan(
    reply([{ sourceItemIds: ['i2', 'i3'], text: 'update resume, send to Lauren', target: 'project', projectId: 'career', mode: 'existing_worktree', worktreeId: 'wm-career', confidence: 0.9 }]),
    ctx,
  );
  assert.ok(merged.ok, merged.error);
  assert.equal(merged.plan.tasks.length, 1);
  assert.deepEqual(merged.plan.tasks[0].sourceItemIds, ['i2', 'i3']);

  const split = parsePlan(
    reply([
      { sourceItemIds: ['i4'], text: 'fix the test', target: 'project', projectId: 'shop', mode: 'new_worktree', confidence: 0.9 },
      { sourceItemIds: ['i4'], text: 'note it in the tracker', target: 'project', projectId: 'career', mode: 'existing_worktree', worktreeId: 'wm-career', confidence: 0.8 },
    ]),
    ctx,
  );
  assert.ok(split.ok, split.error);
  assert.equal(split.plan.tasks.length, 2);
  assert.ok(split.plan.tasks.every((t) => t.sourceItemIds.includes('i4')));
  assert.ok(split.plan.tasks.every((t) => t.planCheckpoint === true), 'plan checkpoint defaults on');
});

test('a task under the confidence threshold has its project cleared and is flagged for the user', () => {
  const low = CONFIDENCE_THRESHOLD - 0.1;
  const r = parsePlan(reply([{ sourceItemIds: ['i4'], text: 'fix it', target: 'project', projectId: 'shop', mode: 'new_worktree', confidence: low }]));
  assert.ok(r.ok, r.error);
  const [t] = r.plan.tasks;
  assert.equal(t.projectId, undefined);
  assert.equal(t.needsChoice, true);

  const sure = parsePlan(reply([{ sourceItemIds: ['i4'], text: 'fix it', target: 'project', projectId: 'shop', mode: 'new_worktree', confidence: 0.95 }]));
  assert.equal(sure.plan.tasks[0].projectId, 'shop');
  assert.equal(sure.plan.tasks[0].needsChoice, false);
});

test('a project, worktree or chat the router made up is treated as low confidence', () => {
  const r = parsePlan(
    reply([
      { sourceItemIds: ['i1'], text: 'a', target: 'project', projectId: 'nope', mode: 'new_worktree', confidence: 0.9 },
      { sourceItemIds: ['i2'], text: 'b', target: 'project', projectId: 'career', mode: 'existing_worktree', worktreeId: 'w-cart', confidence: 0.9 },
      { sourceItemIds: ['i3'], text: 'c', target: 'project', projectId: 'career', mode: 'existing_chat', sessionId: 'ghost', confidence: 0.9 },
      { sourceItemIds: ['i4', 'unknown-item'], text: 'd', target: 'teleport', confidence: 0.9 },
    ]),
    ctx,
  );
  assert.ok(r.ok, r.error);
  for (const t of r.plan.tasks) {
    assert.equal(t.needsChoice, true, t.text);
    assert.equal(t.projectId, undefined);
    assert.equal(t.worktreeId, undefined);
    assert.equal(t.sessionId, undefined);
  }
  assert.deepEqual(r.plan.tasks[3].sourceItemIds, ['i4'], 'unknown item ids are dropped');
});

test('two tasks on the same existing worktree or the same chat conflict, and confirm stays disabled', () => {
  const plan = (a, b) => ({
    tasks: [
      { id: 't1', sourceItemIds: ['i1'], text: 'one', target: 'project', confidence: 1, planCheckpoint: true, needsChoice: false, ...a },
      { id: 't2', sourceItemIds: ['i2'], text: 'two', target: 'project', confidence: 1, planCheckpoint: true, needsChoice: false, ...b },
    ],
  });
  const sameWorktree = { projectId: 'shop', mode: 'existing_worktree', worktreeId: 'w-cart' };
  let v = validatePlan(plan(sameWorktree, sameWorktree), ctx);
  assert.equal(v.canDispatch, false);
  assert.deepEqual(v.issues.filter((i) => i.kind === 'conflict').map((i) => i.taskIds), [['t1', 't2']]);

  // An Isolated project's main checkout is a worktree like any other.
  const shopMain = { projectId: 'shop', mode: 'existing_worktree', worktreeId: 'wm-shop' };
  assert.equal(validatePlan(plan(shopMain, shopMain), ctx).canDispatch, false);

  const sameChat = { projectId: 'career', mode: 'existing_chat', sessionId: 'a1' };
  v = validatePlan(plan(sameChat, sameChat), ctx);
  assert.equal(v.canDispatch, false);
  assert.match(v.issues[0].message, /same chat/);

  const sharedMain = { projectId: 'career', mode: 'existing_worktree', worktreeId: 'wm-career' };
  v = validatePlan(plan(sharedMain, sharedMain), ctx);
  assert.deepEqual(v.issues, [], "a Shared project's main checkout takes several tasks");
  assert.equal(v.canDispatch, true);
});

test('a project task with no project, mode, worktree or chat keeps Dispatch disabled', () => {
  const t = (over) => ({ id: 't1', sourceItemIds: ['i1'], text: 'x', target: 'project', confidence: 1, planCheckpoint: true, needsChoice: false, ...over });
  for (const task of [
    t({}),
    t({ projectId: 'shop' }),
    t({ projectId: 'shop', mode: 'existing_worktree' }),
    t({ projectId: 'shop', mode: 'existing_chat' }),
  ]) {
    const v = validatePlan({ tasks: [task] }, ctx);
    assert.equal(v.canDispatch, false);
    assert.equal(v.issues[0].kind, 'unassigned');
  }
  const home = validatePlan({ tasks: [t({ target: 'home' })] }, ctx);
  assert.equal(home.canDispatch, true, 'home and you tasks need no project');
  assert.deepEqual(home.unrouted, ['i2', 'i3', 'i4']);
});

test('invalid or non-JSON router output is an error', () => {
  for (const bad of ['', 'Sorry, I cannot help with that.', '{"tasks": [', '{"plan": []}', '{"tasks": []}', '```json\n{}\n```\n```json\n{}\n```', '{"tasks":[{"target":"home"}]}']) {
    const r = parsePlan(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.error.length > 0);
  }
});

test('a fenced block or prose around the JSON object is read', () => {
  const body = reply([{ sourceItemIds: ['i1'], text: 'gym', target: 'home', confidence: 0.9 }]);
  for (const wrapped of [body, `\`\`\`json\n${body}\n\`\`\``, `Here is the plan:\n${body}\nLet me know.`, `Sure.\n\n\`\`\`\n${body}\n\`\`\`\n`]) {
    const r = parsePlan(wrapped, ctx);
    assert.ok(r.ok, r.error);
    assert.equal(r.plan.tasks[0].target, 'home');
  }
});

test('picking a project gives it the usual mode: main checkout when Shared, else a new worktree', () => {
  const t = { id: 't1', sourceItemIds: ['i1'], text: 'x', target: 'you', confidence: 0.2, planCheckpoint: true, needsChoice: true };
  const shared = retarget(t, 'project', 'career', ctx);
  assert.deepEqual([shared.mode, shared.worktreeId, shared.needsChoice], ['existing_worktree', 'wm-career', false]);
  const isolated = retarget(t, 'project', 'shop', ctx);
  assert.deepEqual([isolated.mode, isolated.worktreeId], ['new_worktree', undefined]);
  const chat = withMode({ ...isolated, sessionId: 'a2' }, 'existing_chat', ctx);
  assert.equal(chat.sessionId, undefined, 'a new mode starts with no pick');
  const home = retarget(shared, 'home', undefined, ctx);
  assert.equal(home.projectId, undefined);
  assert.equal(home.mode, undefined);
});

test('a confirmed plan is handed off and read back, nothing launched', () => {
  localStorage.clear();
  assert.equal(loadRoutedPlan(), null);
  const r = parsePlan(previewReply(items, cards, sessions), ctx);
  assert.ok(r.ok, r.error);
  handOffPlan(r.plan);
  assert.deepEqual(loadRoutedPlan().tasks.map((t) => t.text), r.plan.tasks.map((t) => t.text));
});

test("the preview's made-up reply parses, and its error case doesn't", () => {
  const r = parsePlan(previewReply(items, cards, sessions), ctx);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.plan.tasks[0].sourceItemIds, ['i1', 'i2']);
  assert.ok(r.plan.tasks.some((t) => t.needsChoice));
  assert.equal(parsePlan(previewReply([{ id: 'x', text: 'router error', context: [] }], cards, sessions)).ok, false);
});
