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
  DEFAULT_TASK_BUDGET,
  budgetNudges,
  costBySession,
  errorKey,
  gotIt,
  loadStuck,
  nudgeTitle,
  putDownStuck,
  reloadStuck,
  saveStuck,
  sessionCost,
  settle,
  budgetFlag,
  stuckCheck,
  stuckNeed,
  stuckReason,
  taskBudget,
} = await import('../src/nebula/stuck.ts');
const { changeKey, queueRows, triagePass } = await import('../src/nebula/triage.ts');

const NOW = 1_800_000_000_000;
const HOUR = 3600_000;

// ---- fixtures ----

const ok = (tool, target) => ({ tool, target, note: null, ok: true, at: 0 });
const fail = (tool, target, error) => ({ tool, target, note: null, ok: false, error, at: 0 });
const turn = (steps, number = 4) => ({ number, steps });

/** One TypeScript error, run three times: the line, column, path and time move. */
const sameErrorThrice = [
  ok('Edit', '/Users/me/app/src/a.ts'),
  fail('Bash', 'npm run build', 'Exit code 2\n2026-11-08T10:01:02Z /Users/me/app/src/a.ts(41,14): error TS2345: Argument of type string is not assignable'),
  ok('Edit', '/Users/me/app/src/a.ts'),
  fail('Bash', 'npm run build', 'Exit code 2\n2026-11-08T10:04:39Z /Users/me/app/src/a.ts(42,9): error TS2345: Argument of type string is not assignable'),
  ok('Edit', '/Users/me/app/src/a.ts'),
  fail('Bash', 'npm run build', 'Exit code 2\n2026-11-08T10:09:11Z /Users/me/app-2/src/b.ts(7,3): error TS2345: Argument of type string is not assignable'),
];

/** A usage report whose buckets carry their recorded cost. */
const report = (rows) => ({
  sources: [],
  files: 1,
  buckets: rows.map(([source, session, cost], i) => ({
    source,
    session,
    hour: 1_799_000_000 + i * 3600,
    cwd: '/r',
    model: 'claude-opus-5-5',
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    responses: 1,
    recordedCost: cost,
  })),
});

const agent = (id, extra = {}) => ({ id, kind: 'claude', session_id: `s-${id}`, status: 'finished', status_changed_at: NOW - HOUR, ...extra });

// ---- repeated errors ----

test('the same failing error 3 times, after numbers, paths and timestamps are taken out, is "Same error 3 times: <error, clipped>"', () => {
  const reason = stuckReason({ turn: turn(sameErrorThrice), cost: 0, budget: 10 });
  assert.match(reason, /^Same error 3 times: /);
  // The error's own line, not the bare "Exit code", clipped to a line.
  assert.ok(reason.includes('error TS2345'), reason);
  assert.ok(reason.endsWith('…'), reason);
  assert.ok(reason.length <= 'Same error 3 times: '.length + 60, reason);
  assert.equal(errorKey('/a/b.ts(41,14) at 10:01:02 deadbeef1 2026-11-08T10:01:02Z'), errorKey('./c/d.ts(7,3) at 11:59:00 cafef00d2 2026-11-09T00:00:00Z'));
});

test('3 different errors, or the same one twice, is not stuck', () => {
  const different = [
    fail('Bash', 'npm test', 'Error: cannot find module ./x'),
    fail('Bash', 'npm run build', 'error TS2304: Cannot find name foo'),
    fail('Bash', 'cargo test', 'thread main panicked at index out of bounds'),
  ];
  assert.equal(stuckReason({ turn: turn(different), cost: 0, budget: 10 }), null);
  assert.equal(stuckReason({ turn: turn(sameErrorThrice.slice(0, 4)), cost: 0, budget: 10 }), null);
  // A command that fails with no output counts by what it ran.
  const bare = [fail('Bash', 'npm test', 'Exit code 1'), fail('Bash', 'npm test', 'Exit code 1'), fail('Bash', 'npm test', 'Exit code 1')];
  assert.equal(stuckReason({ turn: turn(bare) }), 'Same error 3 times: Bash npm test failed');
  // Three bare failures of three different commands are three errors.
  const three = [fail('Bash', 'npm test', 'Exit code 1'), fail('Bash', 'npm run lint', 'Exit code 1'), fail('Bash', 'cargo fmt --check', 'Exit code 1')];
  assert.equal(stuckReason({ turn: turn(three) }), null);
});

// ---- budget ----

test('a session at 85% or more of its budget is "Used 87% of its $10 budget"', () => {
  const costs = costBySession(report([['claude', 's-a', 5], ['claude', 's-a', 3.7], ['claude', 's-b', 8]]));
  assert.equal(sessionCost(costs, agent('a')), 8.7);
  assert.equal(stuckReason({ cost: sessionCost(costs, agent('a')), budget: taskBudget('a', [], undefined) }), 'Used 87% of its $10 budget');
  assert.equal(stuckReason({ cost: sessionCost(costs, agent('b')), budget: 10 }), null);
  assert.equal(taskBudget('a', [], undefined), DEFAULT_TASK_BUDGET);
  assert.equal(taskBudget('a', [], 20), 20);
});

test("a Dispatch task's own budget is used instead of the default", () => {
  const costs = costBySession(report([['claude', 's-a', 4.5], ['claude', 's-c', 9]]));
  const batches = [
    { id: 'b1', at: 0, tasks: [{ id: 't1', text: 'x', state: 'launched', agentId: 'a', budget: 5, context: [], lane: null }] },
  ];
  assert.equal(taskBudget('a', batches, 20), 5);
  assert.equal(stuckReason({ cost: sessionCost(costs, agent('a')), budget: taskBudget('a', batches, 20) }), 'Used 90% of its $5.00 budget');
  // The other session falls back to Settings' budget: $9 of $20 is fine.
  assert.equal(stuckReason({ cost: sessionCost(costs, agent('c')), budget: taskBudget('c', batches, 20) }), null);
});

// ---- the label, and how long it holds ----

test("a stuck reason makes the label stuck, with the reason as its need, whatever the model said", () => {
  const s = agent('a');
  const recs = { a: { label: 'checked', need: 'Nothing; archive it', key: changeKey(s), at: NOW } };
  const why = 'Same error 3 times: error TS2345';
  const { rows } = queueRows([s], recs, {}, () => false, (id) => (id === 'a' ? why : null));
  assert.deepEqual(rows.map((r) => [r.label, r.need]), [['stuck', why]]);
  // Unread by the model, it's still in the queue; mid-turn too, to step in.
  assert.equal(queueRows([s], {}, {}, () => false, () => why).rows[0].label, 'stuck');
  assert.equal(queueRows([{ ...s, status: 'running' }], {}, {}, () => false, () => why).rows[0].label, 'stuck');
  // A wait on you still comes first; no reason, the model's label stands.
  assert.equal(queueRows([{ ...s, status: 'needs_feedback' }], recs, {}, () => false, () => why).rows[0].label, 'decision');
  assert.equal(queueRows([s], recs, {}, () => false, () => null).rows[0].label, 'checked');
});

test('the flag holds until the session runs again because I replied, or I press "Got it"', () => {
  const budget = budgetFlag(8.7, 10);
  const s = agent('a');
  let e = settle({}, s, budget, NOW);
  assert.equal(e.raised.reason, 'Used 87% of its $10 budget');
  // The same moment again, or a later look with nothing new: it holds.
  assert.equal(settle(e, s, budget, NOW + 60_000), e);
  // I reply: it runs again, and the flag goes down, even though spend is still past 85%.
  const replied = { ...s, status: 'running', status_changed_at: NOW + 120_000 };
  e = settle(e, replied, budgetFlag(8.9, 10), NOW + 121_000);
  assert.equal(e.raised, undefined);
  e = settle(e, { ...replied, status: 'finished', status_changed_at: NOW + 300_000 }, budgetFlag(9.2, 10), NOW + 301_000);
  assert.equal(e.raised, undefined);
  // Only crossing 100% brings it back.
  e = settle(e, { ...replied, status: 'finished', status_changed_at: NOW + 300_000 }, budgetFlag(10.4, 10), NOW + 400_000);
  assert.equal(e.raised.reason, 'Used 104% of its $10 budget');

  // A flag raised mid-turn holds through that turn's end.
  const running = { ...s, status: 'running', status_changed_at: NOW };
  let m = settle({}, running, budget, NOW + 1000);
  m = settle(m, { ...running, status: 'finished', status_changed_at: NOW + 5000 }, budget, NOW + 6000);
  assert.ok(m.raised);

  // "Got it" puts it down, and it stays down.
  const g = gotIt(settle({}, s, budget, NOW));
  assert.equal(g.raised, undefined);
  assert.equal(settle(g, s, budget, NOW + 1000).raised, undefined);

  // Stored: "Got it" on the row's session.
  reloadStuck();
  saveStuck({ a: settle({}, s, budget, NOW) });
  assert.equal(stuckNeed(loadStuck(), 'a'), 'Used 87% of its $10 budget');
  putDownStuck('a');
  reloadStuck();
  assert.equal(stuckNeed(loadStuck(), 'a'), null);
});

test("a new turn's repeated errors flag again after a reply put the last ones down", async () => {
  reloadStuck();
  saveStuck({});
  let current = turn(sameErrorThrice, 4);
  let s = agent('a');
  const deps = () => ({
    sessions: [{ ...s, stale: false }],
    entries: loadStuck,
    save: saveStuck,
    turn: async () => current,
    costs: () => new Map(),
    budget: () => 10,
    now: NOW,
  });
  await stuckCheck(deps());
  assert.match(stuckNeed(loadStuck(), 'a'), /^Same error 3 times/);
  // I reply; while it runs, its new turn has no errors yet.
  s = { ...s, status: 'running', status_changed_at: NOW + 10_000 };
  current = turn([ok('Read', '/r/a.ts')], 5);
  await stuckCheck({ ...deps(), now: NOW + 11_000 });
  assert.equal(stuckNeed(loadStuck(), 'a'), null);
  // It finishes, stuck on the same error again: a new flag.
  s = { ...s, status: 'finished', status_changed_at: NOW + 60_000 };
  current = turn(sameErrorThrice, 5);
  await stuckCheck({ ...deps(), now: NOW + 61_000 });
  assert.match(stuckNeed(loadStuck(), 'a'), /^Same error 3 times/);
  // A stale session isn't flagged, and nothing is saved when nothing changed.
  let saves = 0;
  await stuckCheck({ ...deps(), sessions: [{ ...s, stale: true }], save: (x) => (saves++, saveStuck(x)) });
  assert.equal(stuckNeed(loadStuck(), 'a'), null);
  await stuckCheck({ ...deps(), sessions: [{ ...s, stale: true }], save: (x) => (saves++, saveStuck(x)) });
  assert.equal(saves, 1);
});

test('the stuck checks run in the triage pass and override the model, with no extra model call', async () => {
  const s = { ...agent('a'), length: 10, name: 'A', project: 'p', lastPrompt: '', held: false };
  let records = {};
  let calls = 0;
  let checked = 0;
  await triagePass({
    on: true,
    sessions: [s],
    records: () => records,
    save: (r) => (records = r),
    length: async () => 10,
    context: async () => ({ tail: '', summary: '' }),
    run: async () => (calls++, JSON.stringify({ sessions: [{ id: 'a', label: 'checked', need: 'All good' }] })),
    stuck: async (stale) => {
      checked++;
      assert.equal(stale(s), false);
    },
    now: () => NOW,
  });
  assert.equal(calls, 1);
  assert.equal(checked, 1);
  // The model's label is kept as it said; the queue shows the stuck flag over it.
  assert.equal(records.a.label, 'checked');
  assert.equal(queueRows([s], records, {}, () => false, () => 'Used 90% of its $10 budget').rows[0].label, 'stuck');
});

// ---- banners ----

test('crossing 85% fires one banner, and no more until it crosses 100%', () => {
  const sent = new Set();
  // The first look since launch only marks what's already over.
  assert.deepEqual(budgetNudges([{ id: 'old', cost: 30, budget: 10 }], sent, false), []);
  assert.deepEqual(budgetNudges([{ id: 'old', cost: 31, budget: 10 }], sent, true), []);

  const at = (cost) => budgetNudges([{ id: 'a', cost, budget: 10 }], sent, true).map((n) => n.step);
  assert.deepEqual(at(5), []);
  assert.deepEqual(at(8.6), [85]);
  assert.deepEqual(at(9.1), []);
  assert.deepEqual(at(9.9), []);
  assert.deepEqual(at(10.2), [100]);
  assert.deepEqual(at(12), []);
  // Straight past 100%: one banner, not two.
  assert.deepEqual(budgetNudges([{ id: 'b', cost: 11, budget: 10 }], sent, true).map((n) => n.step), [100]);
  assert.deepEqual(budgetNudges([{ id: 'b', cost: 11, budget: 10 }], sent, true), []);
  assert.equal(nudgeTitle('Search Facets', { step: 85, share: 0.87, budget: 10 }), 'Search Facets used 87% of its $10 budget');
  assert.equal(nudgeTitle('Search Facets', { step: 100, share: 1.02, budget: 10 }), 'Search Facets is over its $10 budget');
});
