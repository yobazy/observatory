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
  activityLine,
  awaitingPlan,
  batchSummary,
  boardRows,
  decideSummary,
  phaseOf,
  redirectPrompt,
  sortRows,
  suppressTaskNotification,
  PLAN_APPROVED,
} = await import('../src/nebula/board.ts');
const { urgency } = await import('../src/nebula/store.ts');
const {
  allBatches,
  checkOffTask,
  dismissBatch,
  dispatchPlan,
  isDispatched,
  reloadBatches,
  retryTask,
  routableItems,
  updateTask,
} = await import('../src/nebula/batch.ts');
const { handOffPlan } = await import('../src/nebula/router.ts');
const { pasteList, dispatchItems, reloadItems } = await import('../src/nebula/dispatch.ts');

const NOW = 1_000_000;

const agent = (id, status, over = {}) => ({
  id,
  worktree_id: 'w1',
  name: id,
  status,
  archived: false,
  archived_at: 0,
  unseen: false,
  status_changed_at: NOW - 1000,
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

/** A launched task, its session `agentId`. */
const task = (n, over = {}) => ({
  id: `b-t${n}`,
  sourceItemIds: [`i${n}`],
  text: `task ${n}`,
  target: 'project',
  projectId: 'shop',
  mode: 'new_worktree',
  confidence: 0.9,
  planCheckpoint: false,
  context: [],
  state: 'launched',
  lane: null,
  agentId: `a${n}`,
  launchingAt: NOW - 60_000,
  launchedAt: NOW - 59_000,
  ...over,
});

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

// ---- ordering ----

test('given tasks whose sessions are needs_feedback, running and finished, rows put needs_feedback first, matching urgency()', () => {
  const agents = byId([agent('a1', 'finished', { unseen: true }), agent('a2', 'running'), agent('a3', 'needs_feedback')]);
  const batch = { id: 'b', at: 0, tasks: [task(1), task(2), task(3)] };
  const rows = boardRows([batch], agents, () => 0, NOW);
  assert.deepEqual(
    rows.map((r) => r.agent.status),
    ['needs_feedback', 'running', 'finished'],
  );
  const byUrgency = Object.values(agents).sort((a, b) => urgency(a) - urgency(b)).map((a) => a.id);
  assert.deepEqual(rows.map((r) => r.agent.id), byUrgency);
});

test('rows without a session fit in: failed and blocked after waiting, pending after working, listed and checked-off last', () => {
  const agents = byId([agent('a1', 'running'), agent('a2', 'needs_feedback')]);
  const tasks = [
    task(0, { state: 'listed', agentId: undefined, target: 'you' }),
    task(1),
    task(5, { done: true, agentId: undefined, state: 'listed' }),
    task(3, { state: 'pending', agentId: undefined }),
    task(4, { state: 'failed', agentId: undefined, note: 'nope' }),
    task(2),
  ];
  const rows = boardRows([{ id: 'b', at: 0, tasks }], agents, () => 0, NOW);
  assert.deepEqual(
    rows.map((r) => r.phase),
    ['waiting', 'failed', 'working', 'pending', 'listed', 'done'],
  );
  // Equal ranks keep plan order.
  const same = sortRows([
    { phase: 'pending', task: task(7) },
    { phase: 'pending', task: task(8) },
  ]);
  assert.deepEqual(same.map((r) => r.task.id), ['b-t7', 'b-t8']);
});

test('dismissed batches leave the board', () => {
  const rows = boardRows([{ id: 'b', at: 0, tasks: [task(1)], dismissed: true }], {}, () => 0, NOW);
  assert.equal(rows.length, 0);
});

// ---- the plan checkpoint ----

test('a session stopped at its plan checkpoint shows as awaiting the plan until approved', () => {
  const t = task(1, { planCheckpoint: true });
  const a = agent('a1', 'finished', { status_changed_at: NOW - 100 });
  assert.equal(awaitingPlan(t, a), true);
  assert.equal(phaseOf(t, { a1: a }, () => 0, NOW), 'plan');
  // Approved: it's just finished.
  assert.equal(awaitingPlan({ ...t, planApproved: true }, a), false);
  // No checkpoint asked for.
  assert.equal(awaitingPlan({ ...t, planCheckpoint: false }, a), false);
  // Still working on the plan, or stopped at a permission prompt instead.
  assert.equal(awaitingPlan(t, agent('a1', 'running')), false);
  assert.equal(awaitingPlan(t, agent('a1', 'needs_feedback')), false);
  // A prompt still queued for the chat: the plan turn hasn't started.
  assert.equal(awaitingPlan(t, a, 1), false);
});

test("a chat's turn that finished before the task's prompt went out is not its plan", () => {
  const t = task(1, { planCheckpoint: true, mode: 'existing_chat' });
  assert.equal(awaitingPlan(t, agent('a1', 'finished', { status_changed_at: t.launchingAt - 5 })), false);
});

test('after a redirect, the buttons come back only once the session stops at its next plan', () => {
  const t = task(1, { planCheckpoint: true, planAnsweredAt: NOW });
  assert.equal(awaitingPlan(t, agent('a1', 'finished', { status_changed_at: NOW - 100 })), false);
  assert.equal(awaitingPlan(t, agent('a1', 'finished', { status_changed_at: NOW + 5000 })), true);
});

test('approve sends the approval follow-up; redirect sends the text as typed, and nothing when blank', () => {
  assert.equal(PLAN_APPROVED, 'Plan approved — go ahead.');
  assert.equal(redirectPrompt('  skip the tests, just fix the CSS \n'), 'skip the tests, just fix the CSS');
  assert.equal(redirectPrompt('   '), null);
});

test('a task cancelled at its plan counts as cancelled, not finished', () => {
  const t = task(1, { planCheckpoint: true, cancelled: true });
  assert.equal(phaseOf(t, { a1: agent('a1', 'finished', { archived: true }) }, () => 0, NOW), 'cancelled');
});

// ---- the summary ----

test('given 5 tasks where 4 finish and 1 is needs_feedback, exactly one summary fires: "4 done, 1 needs you"', () => {
  const tasks = [1, 2, 3, 4, 5].map((n) => task(n));
  let batch = { id: 'b', at: 0, tasks };
  const working = byId([1, 2, 3, 4, 5].map((n) => agent(`a${n}`, n === 5 ? 'needs_feedback' : 'running')));
  // Still working: nothing fires.
  let d = decideSummary(batch, working, () => 0, NOW);
  assert.equal(d.fire, undefined);
  assert.equal(batchSummary(tasks, working, () => 0, NOW).settled, false);

  const settled = byId([1, 2, 3, 4, 5].map((n) => agent(`a${n}`, n === 5 ? 'needs_feedback' : 'finished')));
  assert.equal(batchSummary(tasks, settled, () => 0, NOW).text, '4 done, 1 needs you');
  const fired = [];
  for (let i = 0; i < 3; i++) {
    d = decideSummary(batch, settled, () => 0, NOW);
    if (d.fire) fired.push(d.fire);
    if (d.patch) batch = { ...batch, ...d.patch };
  }
  assert.deepEqual(fired, ['4 done, 1 needs you']);

  // A session blinking out and back to the same state doesn't fire it again.
  for (const agents of [working, settled]) {
    d = decideSummary(batch, agents, () => 0, NOW);
    if (d.fire) fired.push(d.fire);
    if (d.patch) batch = { ...batch, ...d.patch };
  }
  assert.deepEqual(fired, ['4 done, 1 needs you']);
});

test('no per-task notification fires for batch sessions, except waiting on you', () => {
  const batches = [{ id: 'b', at: 0, tasks: [task(1), task(2)] }];
  assert.equal(suppressTaskNotification('a1', 'finished', batches), true);
  assert.equal(suppressTaskNotification('a2', 'terminated', batches), true);
  assert.equal(suppressTaskNotification('a1', 'needs_feedback', batches), false);
  // Sessions outside any batch, or in a batch taken off the board, notify as before.
  assert.equal(suppressTaskNotification('other', 'finished', batches), false);
  assert.equal(suppressTaskNotification('a1', 'finished', [{ ...batches[0], dismissed: true }]), false);
});

test('a batch of only list items, with nothing sent to an agent, fires no summary', () => {
  const batch = { id: 'b', at: 0, tasks: [task(1, { state: 'listed', agentId: undefined, target: 'you' })] };
  assert.equal(decideSummary(batch, {}, () => 0, NOW).fire, undefined);
});

test('blocked, failed and listed tasks count as settled, and say so', () => {
  const tasks = [
    task(1),
    task(2, { state: 'blocked', agentId: undefined }),
    task(3, { state: 'failed', agentId: undefined }),
    task(4, { state: 'listed', agentId: undefined, target: 'you' }),
  ];
  const s = batchSummary(tasks, { a1: agent('a1', 'finished') }, () => 0, NOW);
  assert.equal(s.settled, true);
  assert.equal(s.text, '1 done, 1 failed, 1 blocked, 1 on your list');
  // A pending task keeps it unsettled.
  assert.equal(batchSummary([...tasks, task(5, { state: 'pending', agentId: undefined })], {}, () => 0, NOW).settled, false);
});

// ---- storage: checking off, retry, dismiss, re-routing ----

function dispatchFresh(lines, routedTasks) {
  localStorage.clear();
  reloadItems();
  reloadBatches();
  pasteList(lines);
  const items = dispatchItems();
  const plan = routedTasks(items);
  return { items, batch: dispatchPlan(handOffPlan({ tasks: plan }), items, {}) };
}

const planTask = (id, itemIds, over = {}) => ({
  id,
  sourceItemIds: itemIds,
  text: id,
  target: 'project',
  projectId: 'shop',
  mode: 'new_worktree',
  confidence: 0.9,
  planCheckpoint: true,
  needsChoice: false,
  ...over,
});

test('given you tasks, checking them off persists across reloads and checks their source items', () => {
  const { items, batch } = dispatchFresh('go to the gym\nfix the bug', (items) => [
    planTask('gym', [items[0].id], { target: 'you', projectId: undefined }),
    planTask('bug', [items[1].id]),
  ]);
  const gym = batch.tasks.find((t) => t.target === 'you');
  assert.equal(gym.state, 'listed');
  checkOffTask(batch.id, gym.id, true);
  reloadBatches();
  reloadItems();
  assert.equal(allBatches()[0].tasks.find((t) => t.id === gym.id).done, true);
  assert.equal(dispatchItems().find((i) => i.id === items[0].id).checked, true);
  assert.equal(dispatchItems().find((i) => i.id === items[1].id).checked, false);
  // And unchecking puts both back.
  checkOffTask(batch.id, gym.id, false);
  assert.equal(dispatchItems().find((i) => i.id === items[0].id).checked, false);
});

test('checking off a finished task checks every item merged into it', () => {
  const { items, batch } = dispatchFresh('update my resume\nsend it to Lauren', (items) => [
    planTask('resume', [items[0].id, items[1].id]),
  ]);
  checkOffTask(batch.id, batch.tasks[0].id, true);
  assert.deepEqual(dispatchItems().map((i) => i.checked), [true, true]);
});

test('retry only puts a failed task back in line, never one that may have a launch out', () => {
  const { batch } = dispatchFresh('a\nb', (items) => [planTask('a', [items[0].id]), planTask('b', [items[1].id])]);
  const [a, b] = batch.tasks;
  updateTask(batch.id, a.id, { state: 'failed', note: 'Its project is gone.', prompt: 'x', launchingAt: 5 });
  updateTask(batch.id, b.id, { state: 'launching', launchingAt: 5 });
  assert.equal(retryTask(batch.id, a.id), true);
  assert.equal(retryTask(batch.id, b.id), false);
  const [ra, rb] = allBatches()[0].tasks;
  assert.equal(ra.state, 'pending');
  assert.equal(ra.note, undefined);
  assert.equal(ra.launchingAt, undefined);
  assert.equal(rb.state, 'launching');
});

test('items already out in a batch are not routed again; dismissing the batch frees the unchecked ones', () => {
  const { items, batch } = dispatchFresh('a\nb\nc', (items) => [planTask('a', [items[0].id]), planTask('b', [items[1].id])]);
  const now = dispatchItems();
  assert.equal(isDispatched(now[0], allBatches()), true);
  assert.deepEqual(routableItems(now, allBatches()).map((i) => i.text), ['c']);

  checkOffTask(batch.id, batch.tasks[0].id, true);
  dismissBatch(batch.id);
  const after = dispatchItems();
  assert.equal(after.every((i) => !i.batchId), true);
  // a was checked off; b comes back to route.
  assert.deepEqual(routableItems(after, allBatches()).map((i) => i.text), ['b', 'c']);
  assert.equal(allBatches()[0].dismissed, true);
  assert.equal(items.length, 3);
});

test("a running session's line is its latest message or tool call, not the input box", () => {
  const screen = [
    '╭──────────────╮',
    '│ ✻ Claude Code │',
    '╰──────────────╯',
    '> fix the cart',
    '',
    '● Looking at how the cart fits in first.',
    '  Search(pattern: "export", path: "src")',
    '✻ Working… (38s · esc to interrupt)',
    '──────────────',
    '> ',
    '──────────────',
    '  ? for shortcuts',
  ];
  assert.equal(activityLine(screen), 'Looking at how the cart fits in first.');
  assert.equal(activityLine(['✻ Thinking… (3s)', '> ']), 'Thinking… (3s)');
  assert.equal(activityLine(['building the index', '> ']), 'building the index');
  assert.equal(activityLine(['> ', '']), null);
});
