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
  changeLeadModel,
  checkFollowUp,
  defaultNotes,
  deliver,
  eventLine,
  eventNeed,
  leadEvents,
  leadIds,
  leadPrompt,
  leadState,
  reviewMark,
  carryUnknown,
  prOf,
  runningLeads,
  startLead,
  startLeadThread,
  DEFAULT_LEAD_MODEL,
  LEAD_MODELS,
  leadModelOptions,
  MAX_LINE,
} = await import('../src/nebula/lead.ts');
const { cardFor, draftCard, reloadCards, saveLead } = await import('../src/nebula/cards.ts');
const { parseFollowUp, linkAction } = await import('../src/nebula/handoff.ts');

const thread = (id, over = {}) => ({ id, projectId: 'p1', status: 'running', archived: false, failed: null, pr: null, ...over });
const snap = (...ts) => Object.fromEntries(ts.map((t) => [t.id, t]));
const LEADS = { p1: 'lead1' };
const card = (lead) => ({ ...draftCard({ files: [], isGitRepo: true }), ...(lead ? { lead } : {}) });

test('Given a project with no lead, then no events are made, whatever its threads do', () => {
  const before = snap(thread('a1'), thread('a2', { status: 'finished' }));
  const after = snap(thread('a1', { status: 'finished', pr: 4 }), thread('a2', { status: 'needs_feedback', failed: 'errors:x' }));
  assert.deepEqual(leadEvents(before, after, {}), []);
  assert.deepEqual(leadEvents(before, after, { p2: 'lead2' }), []);
});

test('Given a lead, running to finished makes one finished event; needs_feedback, a stuck flag, a failed review and a new PR make one of their kind; the same state again makes none', () => {
  const kinds = (b, a) => leadEvents(snap(b), snap(a), LEADS).map((e) => e.kind);
  assert.deepEqual(kinds(thread('a1'), thread('a1', { status: 'finished' })), ['finished']);
  assert.deepEqual(kinds(thread('a1'), thread('a1', { status: 'needs_feedback' })), ['needs you']);
  // S9's stuck flag, and a failed review (S10), both come in as `failed`.
  assert.deepEqual(kinds(thread('a1', { status: 'finished' }), thread('a1', { status: 'finished', failed: 'errors:turn3' })), ['failed']);
  assert.deepEqual(kinds(thread('a1', { status: 'finished' }), thread('a1', { status: 'finished', review: 'k1|1|500' })), ['failed']);
  assert.deepEqual(kinds(thread('a1', { status: 'finished' }), thread('a1', { status: 'finished', pr: 12 })), ['PR opened']);
  const e = leadEvents(snap(thread('a1')), snap(thread('a1', { status: 'finished' })), LEADS)[0];
  assert.deepEqual(e, { kind: 'finished', threadId: 'a1', projectId: 'p1', leadId: 'lead1' });
  // The same state on the next poll.
  const same = thread('a1', { status: 'finished', failed: 'errors:turn3', pr: 12 });
  assert.deepEqual(leadEvents(snap(same), snap({ ...same }), LEADS), []);
  // Finished to finished (a read, an unseen flag) isn't a turn ending.
  assert.deepEqual(kinds(thread('a1', { status: 'finished' }), thread('a1', { status: 'finished' })), []);
  // A thread seen for the first time is the baseline.
  assert.deepEqual(leadEvents({}, snap(thread('a1', { status: 'finished', pr: 3 })), LEADS), []);
});

test("Given a change to the lead's own thread, or to a thread in another project, then no event", () => {
  const before = snap(thread('lead1'), thread('b1', { projectId: 'p2' }));
  const after = snap(thread('lead1', { status: 'finished' }), thread('b1', { projectId: 'p2', status: 'finished', pr: 2 }));
  assert.deepEqual(leadEvents(before, after, LEADS), []);
  // Another project's lead hearing of its own threads isn't this one's business.
  const both = leadEvents(before, after, { ...LEADS, p2: 'lead2' });
  assert.deepEqual(both.map((e) => [e.leadId, e.threadId]), [['lead2', 'b1'], ['lead2', 'b1']]);
});

test('Given an event, eventLine() reads `[observatory] finished: Fix login on fix-login (agent a1): Needs review of the redirect`, at most 300 characters', () => {
  assert.equal(
    eventLine({ kind: 'finished', title: 'Fix login', branch: 'fix-login', agentId: 'a1', need: 'Needs review of the redirect' }),
    '[observatory] finished: Fix login on fix-login (agent a1): Needs review of the redirect',
  );
  const long = eventLine({ kind: 'failed', title: 'T', branch: 'b', agentId: 'a1', need: 'x '.repeat(400) + '\nline two' });
  assert.ok(long.length <= MAX_LINE);
  assert.ok(!long.includes('\n'));
  assert.ok(long.endsWith('…'));
  assert.equal(eventLine({ kind: 'PR opened', title: 'T', branch: 'b', agentId: 'a1', need: '' }), '[observatory] PR opened: T on b (agent a1)');
});

test("The line's need is S7's need when read in the thread's current state, else the failure's reason, else the turn summary", () => {
  const t = { status: 'finished', status_changed_at: 100 };
  assert.equal(eventNeed('finished', t, { need: 'Needs review', key: 'finished|100|12' }, null, 'summary'), 'Needs review');
  assert.equal(eventNeed('finished', t, { need: 'Old', key: 'running|50|9' }, null, 'summary'), 'summary');
  assert.equal(eventNeed('failed', t, undefined, 'Same error 3 times: ENOENT', 'summary'), 'Same error 3 times: ENOENT');
});

/** queue.ts's enqueue() and editQueued() for one busy (or idle) lead. */
function stubQueue(busy) {
  const queue = [];
  const sent = [];
  let n = 0;
  return {
    queue,
    sent,
    q: {
      last: () => queue[queue.length - 1] ?? null,
      enqueue: async (text) => {
        if (!busy() && !queue.length) {
          sent.push(text);
          return 'sent';
        }
        queue.push({ id: `q${++n}`, text });
        return 'queued';
      },
      edit: (id, text) => {
        const item = queue.find((x) => x.id === id);
        if (!item) return false;
        item.text = text;
        return true;
      },
    },
    /** The lead's turn ends: the queue runner sends the first item. */
    turnEnds() {
      const next = queue.shift();
      if (next) sent.push(next.text);
    },
  };
}

test('Given 3 events while the lead is running, then it gets one message with 3 lines when its turn ends, through enqueue()', async () => {
  let running = true;
  const stub = stubQueue(() => running);
  const lines = ['[observatory] finished: A on a (agent a1)', '[observatory] needs you: B on b (agent b1)', '[observatory] PR opened: A on a (agent a1)'];
  assert.equal(await deliver([lines[0]], stub.q), 'queued');
  assert.equal(await deliver([lines[1]], stub.q), 'added');
  assert.equal(await deliver([lines[2]], stub.q), 'added');
  assert.equal(stub.sent.length, 0);
  running = false;
  stub.turnEnds();
  assert.deepEqual(stub.sent, [lines.join('\n')]);
  // Idle: a line goes at once. A queued prompt of yours isn't added to.
  assert.equal(await deliver([lines[0]], stub.q), 'sent');
  running = true;
  stub.queue.push({ id: 'mine', text: 'then run the tests' });
  assert.equal(await deliver([lines[1]], stub.q), 'queued');
  assert.equal(stub.queue[0].text, 'then run the tests');
  assert.equal(await deliver([], stub.q), null);
});

test('Given "Start a lead" with model haiku, a thread starts with the lead prompt on haiku (passed at launch, never typed as /model), and the card stores its id; changing to sonnet restarts it on sonnet', async () => {
  globalThis.localStorage.clear();
  reloadCards();
  const calls = [];
  const deps = {
    create: async (prompt, model) => {
      calls.push(['create', prompt, model]);
      return `lead-${calls.length}`;
    },
    // Typing into the lead isn't how its model is set: /model saves the
    // user's default for every new Claude session.
    send: async (id, text) => calls.push(['send', id, text]),
    save: (lead) => saveLead('p1', lead, card()),
  };
  const notes = defaultNotes('observatory');
  assert.equal(notes, '~/.config/observatory/leads/observatory.md');
  const lead = await startLead({ project: 'observatory', path: '/repo/observatory', notes, model: 'haiku' }, deps);
  assert.deepEqual(calls, [['create', leadPrompt({ project: 'observatory', path: '/repo/observatory', notes }), 'haiku']]);
  assert.deepEqual(cardFor('p1').lead, { agentId: 'lead-1', model: 'haiku', notes });
  // Kept across a reload of the cards.
  reloadCards();
  assert.equal(cardFor('p1').lead.agentId, 'lead-1');

  // A running lead on a new model: restarted on it (Restart archives the old thread).
  const restarts = [];
  const restart = async (model) => {
    restarts.push(model);
    return startLead({ project: 'observatory', path: '/repo/observatory', notes, model }, deps);
  };
  const changed = await changeLeadModel(lead, 'sonnet', true, { save: deps.save, restart });
  assert.deepEqual(restarts, ['sonnet']);
  assert.equal(calls[1][0], 'create');
  assert.equal(calls[1][2], 'sonnet');
  assert.deepEqual(changed, { agentId: 'lead-2', model: 'sonnet', notes });
  assert.deepEqual(cardFor('p1').lead, changed);
  // The same model again does nothing; a stopped lead just saves it.
  await changeLeadModel(changed, 'sonnet', true, { save: deps.save, restart });
  await changeLeadModel(changed, 'opus', false, { save: deps.save, restart });
  assert.deepEqual(restarts, ['sonnet']);
  assert.equal(cardFor('p1').lead.model, 'opus');
  assert.equal(cardFor('p1').lead.agentId, 'lead-2');
  assert.ok(!calls.some((c) => c[0] === 'send'), 'nothing is typed into a lead to set its model');

  await assert.rejects(startLead({ project: 'x', path: '/x', notes, model: 'haiku' }, { ...deps, create: async () => null }));
});

test("The lead prompt says what it is, where its notes live, what event lines look like, and how to act through links", () => {
  const p = leadPrompt({ project: 'observatory', path: '/repo/observatory', notes: '~/.config/observatory/leads/observatory.md' }, ['Extra section.']);
  assert.match(p, /lead for the project observatory/);
  assert.match(p, /~\/\.config\/observatory\/leads\/observatory\.md/);
  assert.match(p, /\[observatory\] <event>: <thread title> on <branch> \(agent <id>\)/);
  assert.match(p, /observatory:\/\/new-task\?project=/);
  assert.match(p, /observatory:\/\/follow-up\?agent=<its agent id>&prompt=<text>&from=\$NEBULA_AGENT_ID/);
  assert.ok(p.endsWith('Extra section.'));
});

test("Given the lead's thread is archived or deleted, then the card says Lead stopped and no events go to it", () => {
  const lead = { agentId: 'lead1', model: 'haiku', notes: 'n.md' };
  const cards = { p1: card(lead), p2: card() };
  const projects = { p1: {}, p2: {} };
  assert.equal(leadState(undefined, {}), 'none');
  assert.equal(leadState(lead, { lead1: { archived: false } }), 'running');
  assert.equal(leadState(lead, { lead1: { archived: true } }), 'stopped');
  assert.equal(leadState(lead, {}), 'stopped');
  assert.deepEqual(runningLeads(cards, { lead1: { archived: false } }, projects), { p1: 'lead1' });
  for (const agents of [{ lead1: { archived: true } }, {}]) {
    const leads = runningLeads(cards, agents, projects);
    assert.deepEqual(leads, {});
    assert.deepEqual(leadEvents(snap(thread('a1')), snap(thread('a1', { status: 'finished' })), leads), []);
  }
  // Stopped or not, a lead's thread stays out of triage and stuck checks.
  assert.deepEqual([...leadIds(cards)], ['lead1']);
});

test('Given a follow-up link for a thread in the lead\'s project, it opens; another project\'s thread or an unknown id is refused', () => {
  const link = parseFollowUp('observatory://follow-up?agent=a1&prompt=run%20the%20tests%20again&from=lead1');
  assert.deepEqual(link, { agent: 'a1', prompt: 'run the tests again', from: 'lead1' });
  assert.equal(linkAction('observatory://follow-up?agent=a1&prompt=x'), 'follow-up');
  assert.equal(linkAction('observatory://new-task?prompt=x'), 'new-task');
  assert.ok('error' in parseFollowUp('observatory://follow-up?prompt=x'));
  assert.ok('error' in parseFollowUp('observatory://follow-up?agent=a1'));
  assert.ok('error' in parseFollowUp('observatory://new-task?agent=a1&prompt=x'));
  assert.ok('error' in parseFollowUp(`observatory://follow-up?agent=a1&prompt=${'a'.repeat(20_001)}`));

  const agents = {
    a1: { name: 'Fix login', worktree_id: 'w1' },
    b1: { name: 'Other', worktree_id: 'w2' },
    lead1: { name: 'Lead', worktree_id: 'w0' },
  };
  const projectOf = (id) => ({ a1: 'p1', lead1: 'p1', b1: 'p2' })[id] ?? null;
  const leads = { p1: 'lead1', p2: 'lead2' };
  assert.deepEqual(checkFollowUp(link, agents, projectOf, leads), { agentId: 'a1' });
  assert.ok('error' in checkFollowUp({ ...link, agent: 'b1' }, agents, projectOf, leads));
  assert.ok('error' in checkFollowUp({ ...link, agent: 'zz' }, agents, projectOf, leads));
  assert.ok('error' in checkFollowUp({ ...link, agent: 'lead1' }, agents, projectOf, leads));
  assert.ok('error' in checkFollowUp({ ...link, from: null }, agents, projectOf, leads));
  assert.ok('error' in checkFollowUp(link, agents, projectOf, {}));
});

test('A card with no lead stays without one, and a bad stored lead is dropped', () => {
  globalThis.localStorage.clear();
  reloadCards();
  saveLead('p9', undefined, card());
  assert.equal(cardFor('p9').lead, undefined);
  globalThis.localStorage.setItem('observatory.cards', JSON.stringify({ cards: { p9: { ...card(), lead: { model: 'haiku' } } } }));
  reloadCards();
  assert.equal(cardFor('p9').lead, undefined);
});

test("A lead's thread is never parked, however long it sits idle", async () => {
  const { toPark, parkMs } = await import('../src/nebula/park.ts');
  const DAY = 24 * 3600_000;
  const now = Date.now();
  const idle = (id) => ({ id, status: 'finished', status_changed_at: now - 10 * DAY, archived: false });
  const leads = leadIds({ p1: card({ agentId: 'lead1', model: 'haiku', notes: 'n.md' }) });
  const due = toPark([idle('lead1'), idle('a1')], now, parkMs(3), { pinned: new Set(), inBatch: new Set(), leads });
  assert.deepEqual(due.map((s) => s.id), ['a1']);
});

/** review.ts's record for a failed (or other) review. */
const reviewRec = (over = {}) => ({ state: 'failed', key: 'head1|2|0', failures: ['npm test: 2 failing'], fails: 1, at: 500, ...over });

test("Given a review that goes to failed (S10), then the lead gets one failed event; the same failure seen again on the next poll makes no second one", () => {
  const before = thread('a1', { status: 'finished', review: reviewMark(undefined) });
  const failed = thread('a1', { status: 'finished', review: reviewMark(reviewRec()) });
  assert.deepEqual(leadEvents(snap(before), snap(failed), LEADS).map((e) => e.kind), ['failed']);
  // The next poll: the same record.
  const again = thread('a1', { status: 'finished', review: reviewMark(reviewRec()) });
  assert.deepEqual(leadEvents(snap(failed), snap(again), LEADS), []);
  // Only `failed` is a failure: passed, couldn't run and not trusted aren't.
  for (const state of ['passed', 'error', 'untrusted']) assert.equal(reviewMark(reviewRec({ state })), null);
  // A second fail on the same task (after the builder's fix) is a new one.
  const second = thread('a1', { status: 'finished', review: reviewMark(reviewRec({ fails: 2, key: 'head2|1|0', at: 900 })) });
  assert.deepEqual(leadEvents(snap(again), snap(second), LEADS).map((e) => e.kind), ['failed']);
  // A stuck flag (S9) and a failed review landing on the same poll are one failure.
  const both = thread('a1', { status: 'finished', failed: 'errors:turn3', review: reviewMark(reviewRec()) });
  assert.deepEqual(leadEvents(snap(before), snap(both), LEADS).map((e) => e.kind), ['failed']);
  // The stuck flag stays a source on its own, and once seen, makes no second event.
  const stuck = thread('a1', { status: 'finished', failed: 'budget:85' });
  assert.deepEqual(leadEvents(snap(before), snap(stuck), LEADS).map((e) => e.kind), ['failed']);
  assert.deepEqual(leadEvents(snap(stuck), snap({ ...stuck }), LEADS), []);
});

test("A lead's thread is never reviewed (S10), whatever its checkout holds", async () => {
  const { needsReview } = await import('../src/nebula/review.ts');
  const trigger = { changed: true, label: 'review', checks: ['npm test'], key: 'k' };
  assert.equal(needsReview(trigger), true);
  assert.equal(needsReview({ ...trigger, lead: true }), false);
});

/** The runner's step: events against what's kept, then what to keep. */
function poller() {
  let before = null;
  return (after) => {
    const events = before ? leadEvents(before, after, LEADS) : [];
    before = carryUnknown(before ?? {}, after);
    return events.map((e) => e.kind);
  };
}
const found = (number, state = 'open') => ({ kind: 'found', pr: { number, state } });
/** A finished thread whose worktree's PR lookup is `entry` (or not in yet). */
const withPr = (entry) => snap(thread('a1', { status: 'finished', pr: prOf(entry) }));

test('Given a launch with PRs already open, then no PR opened events as the lookups land, and none on a repeat poll', () => {
  const poll = poller();
  // First snapshot: state.prs is still empty.
  assert.deepEqual(poll(withPr(undefined)), []);
  // The gh lookups land.
  assert.deepEqual(poll(withPr(found(12))), []);
  // The next poll sees the same PR.
  assert.deepEqual(poll(withPr(found(12))), []);
  assert.deepEqual(poll(withPr(found(12))), []);
});

test('Given a lookup that was unavailable and then finds a PR, then no event', () => {
  const poll = poller();
  assert.deepEqual(poll(withPr(undefined)), []);
  assert.deepEqual(poll(withPr({ kind: 'unavailable', reason: 'gh signed out' })), []);
  assert.deepEqual(poll(withPr(found(12))), []);
  // Known, then unavailable for a while (offline), then the same PR again.
  assert.deepEqual(poll(withPr({ kind: 'unavailable', reason: 'offline' })), []);
  assert.deepEqual(poll(withPr(found(12))), []);
});

test('Given a lookup that found no PR and then finds one, then one PR opened event; a repeat poll makes none', () => {
  const poll = poller();
  assert.deepEqual(poll(withPr(undefined)), []);
  assert.deepEqual(poll(withPr({ kind: 'none' })), []);
  assert.deepEqual(poll(withPr(found(12))), ['PR opened']);
  assert.deepEqual(poll(withPr(found(12))), []);
  // none, a failed lookup in between, then a PR: still news.
  assert.deepEqual(poll(withPr({ kind: 'none' })), []);
  assert.deepEqual(poll(withPr({ kind: 'unavailable', reason: 'offline' })), []);
  assert.deepEqual(poll(withPr(found(13))), ['PR opened']);
  // Another PR on the branch.
  assert.deepEqual(poll(withPr(found(14, 'draft'))), ['PR opened']);
  // Merged: no PR open now, and nothing to say.
  assert.deepEqual(poll(withPr(found(14, 'merged'))), []);
});

test('prOf: unknown while missing or unavailable, null for none or a closed PR, the number for an open or draft one', () => {
  assert.equal(prOf(undefined), undefined);
  assert.equal(prOf({ kind: 'unavailable', reason: 'x' }), undefined);
  assert.equal(prOf({ kind: 'none' }), null);
  assert.equal(prOf(found(3, 'closed')), null);
  assert.equal(prOf(found(3, 'draft')), 3);
});

test("At launch, threads, stuck flags and reviews already there are the baseline: the first poll makes no events", () => {
  const poll = poller();
  const loaded = snap(
    thread('a1', { status: 'needs_feedback', pr: undefined }),
    thread('a2', { status: 'finished', failed: 'errors:turn3', review: reviewMark(reviewRec()), pr: undefined }),
  );
  assert.deepEqual(poll(loaded), []);
  assert.deepEqual(poll({ ...loaded }), []);
});

test('A PR opened line names the PR by number with its link, and both survive clipping to 300 characters', () => {
  const pr = { number: 42, url: 'https://github.com/yobazy/observatory/pull/42' };
  assert.equal(
    eventLine({ kind: 'PR opened', title: 'Fix login', branch: 'fix-login', agentId: 'a1', need: 'Ready for review', pr }),
    '[observatory] PR opened #42: Fix login on fix-login (agent a1) https://github.com/yobazy/observatory/pull/42: Ready for review',
  );
  assert.equal(
    eventLine({ kind: 'PR opened', title: 'T', branch: 'b', agentId: 'a1', need: '', pr: { number: 7 } }),
    '[observatory] PR opened #7: T on b (agent a1)',
  );
  // A long need gives way first.
  const longNeed = eventLine({ kind: 'PR opened', title: 'Fix login', branch: 'fix-login', agentId: 'a1', need: 'word '.repeat(100), pr });
  assert.ok(longNeed.length <= MAX_LINE);
  assert.ok(longNeed.includes('#42') && longNeed.includes(pr.url) && longNeed.includes('(agent a1)'));
  assert.ok(longNeed.endsWith('…'));
  // Then a long title.
  const longTitle = eventLine({ kind: 'PR opened', title: 'Title '.repeat(80), branch: 'fix-login', agentId: 'a1', need: 'x', pr });
  assert.ok(longTitle.length <= MAX_LINE);
  assert.ok(longTitle.includes('#42') && longTitle.endsWith(`(agent a1) ${pr.url}`));
});

test('The lead model picker offers Haiku (cheapest), Sonnet (balanced) and Opus (strongest, costs most), stored as the CLI aliases', () => {
  assert.deepEqual(
    leadModelOptions('sonnet').map((o) => [o.value, o.label, o.hint]),
    [
      ['haiku', 'Haiku', 'cheapest'],
      ['sonnet', 'Sonnet', 'balanced'],
      ['opus', 'Opus', 'strongest, costs most'],
    ],
  );
  assert.deepEqual(LEAD_MODELS.map((m) => m.value), ['haiku', 'sonnet', 'opus']);
  // Each of the three is chosen as itself, with nothing added.
  for (const m of ['haiku', 'sonnet', 'opus']) assert.equal(leadModelOptions(m).length, 3);
});

test('A saved model that is not one of the three still shows, as "Custom: <value>", and keeps its value', () => {
  const options = leadModelOptions('claude-opus-4-8');
  assert.equal(options.length, 4);
  assert.deepEqual(options[3], { value: 'claude-opus-4-8', label: 'Custom: claude-opus-4-8', hint: '' });
  assert.equal(leadModelOptions('  claude-opus-4-8 ')[3].value, 'claude-opus-4-8');
  // Empty adds nothing.
  assert.equal(leadModelOptions('').length, 3);
});

test('Project leads start on sonnet by default', async () => {
  assert.equal(DEFAULT_LEAD_MODEL, 'sonnet');
  const models = [];
  const saved = await startLeadThread('prompt', { model: '', notes: 'n.md' }, {
    create: async (_prompt, model) => (models.push(model), 'lead-9'),
    send: async () => {},
    save: () => {},
  });
  assert.deepEqual(models, ['sonnet']);
  assert.equal(saved.model, 'sonnet');
});
