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
  runningLeads,
  startLead,
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
  assert.deepEqual(kinds(thread('a1', { status: 'finished' }), thread('a1', { status: 'finished', failed: 'review:abc' })), ['failed']);
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

test('Given "Start a lead" with model haiku, a thread starts with the lead prompt, its first input is /model haiku, and the card stores its id; changing to sonnet sends /model sonnet', async () => {
  globalThis.localStorage.clear();
  reloadCards();
  const calls = [];
  const deps = {
    create: async (prompt, model) => {
      calls.push(['create', prompt, model]);
      return 'lead-7';
    },
    send: async (id, text) => calls.push(['send', id, text]),
    save: (lead) => saveLead('p1', lead, card()),
  };
  const notes = defaultNotes('observatory');
  assert.equal(notes, '~/.config/observatory/leads/observatory.md');
  const lead = await startLead({ project: 'observatory', path: '/repo/observatory', notes, model: 'haiku' }, deps);
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1], leadPrompt({ project: 'observatory', path: '/repo/observatory', notes }));
  assert.equal(calls[0][2], 'haiku');
  assert.deepEqual(calls[1], ['send', 'lead-7', '/model haiku']);
  assert.equal(calls.length, 2);
  assert.deepEqual(cardFor('p1').lead, { agentId: 'lead-7', model: 'haiku', notes });
  // Kept across a reload of the cards.
  reloadCards();
  assert.equal(cardFor('p1').lead.agentId, 'lead-7');

  const changed = await changeLeadModel(lead, 'sonnet', true, deps);
  assert.deepEqual(calls[2], ['send', 'lead-7', '/model sonnet']);
  assert.equal(changed.model, 'sonnet');
  assert.equal(cardFor('p1').lead.model, 'sonnet');
  // The same model again, or a stopped lead: nothing is typed.
  await changeLeadModel(changed, 'sonnet', true, deps);
  await changeLeadModel(changed, 'opus', false, deps);
  assert.equal(calls.length, 3);
  assert.equal(cardFor('p1').lead.model, 'opus');

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
