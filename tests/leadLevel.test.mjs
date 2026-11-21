import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { DEFAULT_LEVEL, LEVELS, levelOf, overLevel, NEEDS } = await import('../src/nebula/leadLevel.ts');
const { decide, decidePass, parseActions, reportLine, runActions, withoutActions } = await import('../src/nebula/leadActions.ts');
const { checkFollowUp, checkNewTask, levelLine, RULES_END } = await import('../src/nebula/lead.ts');
const { eventText } = await import('../src/nebula/projectChat.ts');

/** Lead1 runs for p1. a1 is p1's thread at rest saying ✅, a2 p1's still
 *  working, b1 another project's. #12 is green, #13 open with checks
 *  failing; done merged clean, dirty merged with changes, live merged with
 *  a thread at work, wip unmerged. */
const ctx = (over = {}) => ({
  level: 4,
  top: false,
  leadId: 'lead1',
  projectId: 'p1',
  running: 0,
  maxTasks: 2,
  hold: null,
  branches: new Set(['main']),
  threads: { a1: { projectId: 'p1', safe: true }, a2: { projectId: 'p1' }, b1: { projectId: 'p2', safe: true }, lead1: { projectId: 'p1' } },
  nudges: () => 0,
  prs: new Set([12, 13]),
  green: new Set([12]),
  worktrees: {
    main: { main: true, merged: false, clean: true, busy: false },
    done: { main: false, merged: true, clean: true, busy: false },
    dirty: { main: false, merged: true, clean: false, busy: false },
    live: { main: false, merged: true, clean: true, busy: true },
    wip: { main: false, merged: false, clean: true, busy: false },
  },
  ...over,
});

const ALL = parseActions(
  [
    'START fix-it: Fix it and open a PR.',
    'NUDGE a2: CI failed, fix lint',
    'ASK merge #13: you asked for it',
    'ARCHIVE a1: it said ✅ Safe to close',
    'REMOVE done: #11 merged',
    'MERGE #12: green',
    'RELEASE release-0-16: Cut 0.16.0 with scripts/release.sh.',
  ].join('\n'),
);

test('The four levels, Suggest by default; a lead saved with S28 actions on reads as 3', () => {
  assert.deepEqual(
    LEVELS.map((l) => `${l.level} ${l.name}`),
    ['1 Watch', '2 Suggest', '3 Act on safe things', '4 Merge and release'],
  );
  assert.equal(DEFAULT_LEVEL, 2);
  assert.equal(levelOf(undefined), 2);
  assert.equal(levelOf({}), 2);
  assert.equal(levelOf({ acts: true }), 3);
  assert.equal(levelOf({ acts: true, level: 1 }), 1);
  assert.equal(levelOf({ level: 7 }), 2);
  assert.deepEqual(NEEDS, { link: 2, ask: 2, start: 3, nudge: 3, archive: 3, remove: 3, merge: 4, release: 4 });
});

test('Given every action line, then parseActions() reads ARCHIVE, REMOVE, MERGE and RELEASE, and the chat leaves them out', () => {
  assert.deepEqual(
    ALL.map((a) => a.kind),
    ['start', 'nudge', 'ask', 'archive', 'remove', 'merge', 'release'],
  );
  assert.deepEqual(ALL[5], { kind: 'merge', pr: 12, why: 'green' });
  assert.deepEqual(parseActions('MERGE #: x\nREMOVE ../x: y\nRELEASE : z'), []);
  assert.equal(withoutActions('Done.\nMERGE #12: green\nREMOVE done: merged\nRELEASE r1: cut it\nARCHIVE a1: safe'), 'Done.');
});

test('Given an action above the lead\'s level, then the app refuses it and says which level it needs', () => {
  const at = (level) => ALL.map((a) => decide(a, ctx({ level })));
  // Watch: nothing at all.
  assert.ok(at(1).every((d) => !d.ok));
  assert.equal(at(1)[2].reason, 'this lead is at Watch (1); asking you to merge or archive needs Suggest (2)');
  // Suggest: only the ASK, which you answer.
  assert.deepEqual(at(2).map((d) => d.ok), [false, false, true, false, false, false, false]);
  assert.equal(at(2)[0].reason, 'this lead is at Suggest (2); starting tasks needs Act on safe things (3)');
  // Act on safe things: everything but merging and releasing.
  assert.deepEqual(at(3).map((d) => d.ok), [true, true, true, true, true, false, false]);
  assert.equal(at(3)[5].reason, 'this lead is at Act on safe things (3); merging PRs needs Merge and release (4)');
  assert.equal(at(3)[6].reason, 'this lead is at Act on safe things (3); cutting releases needs Merge and release (4)');
  // The refusal goes back to the lead as its [observatory] line.
  assert.equal(
    reportLine({ kind: 'refused', action: ALL[5], reason: at(3)[5].reason }),
    '[observatory] refused MERGE #12: this lead is at Act on safe things (3); merging PRs needs Merge and release (4)',
  );
  assert.equal(overLevel('merge', 4), null);
  // The top lead's PASS to a lead at Watch is refused too.
  assert.equal(decidePass({ kind: 'pass', project: 'shop', brief: 'x' }, [{ project: 'shop', agentId: 'l', running: true, level: 1 }]).ok, false);
});

test("Given an action aimed at another project, then the app refuses it", () => {
  const no = (a) => decide(a, ctx()).reason;
  assert.equal(no({ kind: 'nudge', agentId: 'b1', message: 'x' }), 'that thread is in another project');
  assert.equal(no({ kind: 'archive', agentId: 'b1', why: 'x' }), 'that thread is in another project');
  assert.equal(no({ kind: 'ask', what: 'archive', agentId: 'b1', why: 'x' }), 'that thread is in another project');
  assert.equal(no({ kind: 'merge', pr: 99, why: 'x' }), 'no open PR #99 in this project');
  assert.equal(no({ kind: 'remove', branch: 'their-branch', why: 'x' }), 'no worktree on their-branch in this project');
  // And within the project, only what's safe.
  assert.equal(no({ kind: 'archive', agentId: 'a2', why: 'x' }), "it hasn't said ✅ Safe to close");
  assert.equal(no({ kind: 'merge', pr: 13, why: 'x' }), "#13's checks haven't all passed");
  assert.equal(no({ kind: 'remove', branch: 'main', why: 'x' }), "that's the project's main checkout");
  assert.equal(no({ kind: 'remove', branch: 'dirty', why: 'x' }), 'dirty has uncommitted changes');
  assert.equal(no({ kind: 'remove', branch: 'live', why: 'x' }), 'a thread is still working in live');
  assert.equal(no({ kind: 'remove', branch: 'wip', why: 'x' }), "wip's PR hasn't merged");
  assert.deepEqual(decide({ kind: 'remove', branch: 'done', why: 'x' }, ctx()), { ok: true });
  assert.equal(decide({ kind: 'remove', branch: 'done', why: 'x' }, ctx({ worktrees: { done: { main: false, merged: true, clean: undefined, busy: false } } })).reason, "couldn't tell whether done has uncommitted changes");
});

test('Given a lead\'s observatory:// links, then one from a lead at Watch or naming another project is refused, and one in its own project opens there', () => {
  const leads = { lead1: { projectId: 'p1', name: 'shop', level: 2 }, lead2: { projectId: 'p2', name: 'billing', level: 1 } };
  const leadOf = (id) => leads[id] ?? null;
  // Allowed: its own project, or none named (it gets the lead's).
  assert.deepEqual(checkNewTask({ projectId: 'p1', named: 'shop', from: 'lead1' }, leadOf), { projectId: 'p1' });
  assert.deepEqual(checkNewTask({ projectId: null, named: null, from: 'lead1' }, leadOf), { projectId: 'p1' });
  // Another project, or one Observatory can't match, is refused.
  assert.match(checkNewTask({ projectId: 'p2', named: 'billing', from: 'lead1' }, leadOf).error, /can only start tasks in shop; its link named billing/);
  assert.match(checkNewTask({ projectId: null, named: '~/Library', from: 'lead1' }, leadOf).error, /can only start tasks in shop/);
  // Watch: refused.
  assert.match(checkNewTask({ projectId: 'p2', named: 'billing', from: 'lead2' }, leadOf).error, /Lead billing is at Watch/);
  // A link from a task that isn't a lead opens as before.
  assert.deepEqual(checkNewTask({ projectId: 'p2', named: 'billing', from: 'a1' }, leadOf), { projectId: 'p2' });

  const agents = { a1: { name: 'Fix login', worktree_id: 'w1' }, b1: { name: 'Charges', worktree_id: 'w2' }, lead1: { name: 'Lead shop', worktree_id: 'w0' } };
  const projectOf = (id) => ({ a1: 'p1', lead1: 'p1', b1: 'p2' })[id] ?? null;
  const running = { p1: 'lead1', p2: 'lead2' };
  assert.deepEqual(checkFollowUp({ agent: 'a1', from: 'lead1' }, agents, projectOf, running, { p1: 2 }), { agentId: 'a1' });
  assert.match(checkFollowUp({ agent: 'b1', from: 'lead1' }, agents, projectOf, running, { p1: 2 }).error, /Only its project's lead/);
  assert.match(checkFollowUp({ agent: 'a1', from: 'lead1' }, agents, projectOf, running, { p1: 1 }).error, /at Watch/);
});

test('Given a lead at Merge and release, then its allowed actions are carried out and reported', async () => {
  const did = [];
  const res = await runActions(ALL, {
    context: () => ctx(),
    start: (branch, brief) => {
      did.push(['start', branch, brief]);
      return { full: null };
    },
    nudge: async (id, text) => did.push(['nudge', id, text]),
    name: (id) => ({ a1: 'Fix login', a2: 'Lint' })[id] ?? id,
    archive: (id) => void did.push(['archive', id]),
    remove: async (branch) => did.push(['remove', branch]),
    merge: async (pr) => did.push(['merge', pr]),
  });
  assert.deepEqual(did, [
    ['start', 'fix-it', 'Fix it and open a PR.'],
    ['nudge', 'a2', 'CI failed, fix lint'],
    ['archive', 'a1'],
    ['remove', 'done'],
    ['merge', 12],
    ['start', 'release-0-16', 'Cut 0.16.0 with scripts/release.sh.'],
  ]);
  assert.deepEqual(res.lines, ['Started fix-it', 'Nudged Lint', 'Archived Fix login', 'Removed done', 'Merged #12', 'Started release-0-16']);
  assert.deepEqual(res.asks.map((a) => a.pr), [13]);
  assert.deepEqual(res.reports.map(reportLine), [
    '[observatory] nudged a2',
    '[observatory] archived a1',
    '[observatory] removed the worktree on done',
    '[observatory] merged #12',
  ]);
  // A merge that fails goes back as refused, with gh's reason.
  const failed = await runActions([ALL[5]], {
    context: () => ctx(),
    start: () => ({ full: null }),
    nudge: async () => {},
    name: (id) => id,
    archive: () => {},
    remove: async () => {},
    merge: async () => {
      throw new Error('the base branch policy prohibits the merge');
    },
  });
  assert.equal(reportLine(failed.reports[0]), '[observatory] refused MERGE #12: the base branch policy prohibits the merge');
});

test('Given a level change, then the running lead hears its new level and rules, and the chat says it in a few words', () => {
  const line = levelLine(3, 2);
  assert.match(line, /^\[observatory\] your level is now 3, Act on safe things\. Your level is 3/);
  assert.ok(line.trim().endsWith(RULES_END));
  assert.equal(eventText('[observatory] your level is now 3, Act on safe things.'), 'Level 3: Act on safe things');
  assert.equal(eventText('[observatory] merged #12'), 'Merged #12');
  assert.equal(eventText('[observatory] refused MERGE #12: checks failing'), "Didn't merge #12: checks failing");
});
