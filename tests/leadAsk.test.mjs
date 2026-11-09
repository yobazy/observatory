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
  answerRules,
  ASK_LINE_TEMPLATE,
  askLine,
  askLineFor,
  countsText,
  logCounts,
  roster,
  rosterLine,
  tellRoster,
  topLeadPrompt,
  withAskLine,
  ANSWERS_LOG,
  DEFAULT_TOP_MODEL,
  TOP_NOTES,
} = await import('../src/nebula/leadAsk.ts');
const { leadIds, leadPrompt, leadState, startLeadThread } = await import('../src/nebula/lead.ts');
const { draftCard } = await import('../src/nebula/cards.ts');
const { launchTask, makeBatch, PLAN_POSTFIX } = await import('../src/nebula/batch.ts');

const card = (lead) => ({ ...draftCard({ files: [], isGitRepo: true }), ...(lead ? { lead } : {}) });
const lead = (agentId) => ({ agentId, model: 'haiku', notes: `${agentId}.md` });
const projects = { pa: { name: 'shop' }, pb: { name: 'api' } };

// ---- who asks ----

test('Given no lead in a project and no top lead, a launched task has no ask line; a project lead names Lead <project>; only a top lead names Lead', () => {
  assert.equal(askLine({ project: 'shop', projectLead: false, topLead: false }), null);
  assert.equal(
    askLine({ project: 'shop', projectLead: true, topLead: false }),
    'Before asking me a question about facts or past decisions, run `nebula ask "Lead shop" "<question>" --timeout 120`; if the answer starts with ASK_USER, ask me.',
  );
  assert.equal(
    askLine({ project: 'shop', projectLead: false, topLead: true }),
    'Before asking me a question about facts or past decisions, run `nebula ask "Lead" "<question>" --timeout 120`; if the answer starts with ASK_USER, ask me.',
  );
  assert.equal(
    askLine({ project: 'shop', projectLead: true, topLead: true }),
    'Before asking me a question about facts or past decisions, run `nebula ask "Lead shop" "<question>" --timeout 120`; for another project use `Lead`; if the answer starts with ASK_USER, ask me.',
  );
  // From the app's state: a lead counts only while its thread is there.
  const agents = { l1: { archived: false }, top: { archived: false } };
  const cards = { pa: card(lead('l1')), pb: card() };
  assert.equal(askLineFor('pb', { cards, agents, projects }), null);
  assert.match(askLineFor('pa', { cards, agents, projects }), /"Lead shop"/);
  assert.match(askLineFor('pb', { cards, agents, projects, topLead: lead('top') }), /run `nebula ask "Lead" /);
  assert.equal(askLineFor('pa', { cards, agents: {}, projects }), null, 'a stopped project lead is no one to ask');
  assert.equal(ASK_LINE_TEMPLATE.includes('"Lead <this project>"'), true);
  assert.equal(withAskLine('fix it\n', null), 'fix it\n');
  assert.equal(withAskLine('fix it\n', 'ASK'), 'fix it\n\nASK');
});

const world = (agents) => ({
  projects: { pa: { id: 'pa', repo_path: '/code/shop' }, pb: { id: 'pb', repo_path: '/code/api' } },
  worktrees: {
    'w-a': { id: 'w-a', project_id: 'pa', is_main: true },
    'w-b': { id: 'w-b', project_id: 'pb', is_main: true },
  },
  agents,
  cards: { pa: card(lead('l1')), pb: card() },
});

function launchDeps(w, askLineFn) {
  const calls = [];
  return {
    calls,
    deps: {
      world: () => w,
      kind: 'claude',
      isIdle: () => true,
      queuedFor: () => 0,
      followUp: async (a, text) => void calls.push(['followUp', a.id, text]),
      enqueue: async (a, text) => void calls.push(['enqueue', a.id, text]),
      createAgent: async (wt, prompt) => {
        calls.push(['createAgent', wt, prompt]);
        return 'new-1';
      },
      createWorktree: async (project, branch) => `wt-${project}-${branch}`,
      takenBranches: async () => new Set(),
      addProject: async () => {
        throw new Error('no');
      },
      adoptHome: () => {},
      progress: () => {},
      askLine: askLineFn,
    },
  };
}

const planTask = (over = {}) => ({
  id: 't1',
  sourceItemIds: ['i1'],
  text: 'add facets',
  target: 'project',
  projectId: 'pa',
  mode: 'existing_worktree',
  worktreeId: 'w-a',
  confidence: 0.9,
  planCheckpoint: true,
  needsChoice: false,
  ...over,
});

test('launchTask() adds the ask line for the project the task runs in, before the plan postfix, and none when no lead runs', async () => {
  const w = world({ l1: { archived: false } });
  const line = (projectId) => askLineFor(projectId, { cards: w.cards, agents: w.agents, projects });
  const [inA] = makeBatch({ tasks: [planTask()], at: 1 }, [], w.cards).tasks;
  const a = launchDeps(w, line);
  assert.equal((await launchTask(inA, a.deps)).state, 'launched');
  const sent = a.calls.find((c) => c[0] === 'createAgent')[2];
  assert.ok(sent.includes(`${askLine({ project: 'shop', projectLead: true, topLead: false })}\n\n${PLAN_POSTFIX}`), sent);

  const [inB] = makeBatch({ tasks: [planTask({ projectId: 'pb', mode: 'new_worktree', worktreeId: undefined })], at: 1 }, [], w.cards).tasks;
  const b = launchDeps(w, line);
  await launchTask(inB, b.deps);
  assert.ok(!b.calls.find((c) => c[0] === 'createAgent')[2].includes('nebula ask'));
  // No askLine given (no leads wired): the prompt is as before.
  const c = launchDeps(w, undefined);
  await launchTask(inA, c.deps);
  assert.ok(!c.calls.find((x) => x[0] === 'createAgent')[2].includes('nebula ask'));
});

// ---- the top lead hears of leads ----

/** queue.ts's enqueue() and editQueued() for the top lead. */
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
  };
}

test('Given a project lead starts or stops, the top lead gets one [observatory] leads: line listing every running lead by name and path, through enqueue()', async () => {
  const where = { pa: { name: 'shop', path: '/code/shop' }, pb: { name: 'api', path: '/code/api' } };
  const one = roster({ pa: 'l1' }, where);
  const two = roster({ pa: 'l1', pb: 'l2' }, where);
  assert.deepEqual(two, [
    { name: 'Lead api', path: '/code/api' },
    { name: 'Lead shop', path: '/code/shop' },
  ]);
  const stub = stubQueue(() => false);
  assert.equal(await tellRoster(null, one, stub.q), null, 'the first look is the baseline');
  assert.equal(await tellRoster(one, one, stub.q), null, 'nothing changed');
  assert.equal(await tellRoster(one, two, stub.q), 'sent');
  assert.deepEqual(stub.sent, ['[observatory] leads: Lead api (/code/api), Lead shop (/code/shop)']);
  assert.equal(await tellRoster(two, [], stub.q), 'sent');
  assert.equal(stub.sent[1], '[observatory] leads: none running');
  assert.equal(stub.sent.length, 2);
  assert.equal(rosterLine(one), '[observatory] leads: Lead shop (/code/shop)');
});

// ---- the prompts ----

test('Given Start a lead or Start the top lead, the thread is renamed Lead <project> or Lead, and its prompt says to answer facts and past decisions with a source, ASK_USER otherwise, never act, and log every answer', async () => {
  const notes = '~/.config/observatory/leads/shop.md';
  const project = leadPrompt({ project: 'shop', path: '/code/shop', notes }, answerRules({ name: 'Lead shop', notes }));
  const top = topLeadPrompt({
    path: '/Users/me',
    notes: TOP_NOTES,
    leads: [{ name: 'Lead shop', path: '/code/shop' }],
    projects: [
      { name: 'api', path: '/code/api' },
      { name: 'shop', path: '/code/shop' },
    ],
    vault: '/Users/me/vault',
  });
  for (const [p, name, notesFile] of [
    [project, 'Lead shop', notes],
    [top, 'Lead', TOP_NOTES],
  ]) {
    assert.ok(p.includes(`nebula rename --force "${name}"`), `${name} renames itself`);
    assert.match(p, /Answer facts and past decisions only, and name the source of each answer/);
    assert.match(p, /ASK_USER: <the question, rewritten so it stands alone>/);
    assert.match(p, /A question never makes you act: don't start work, edit files, commit, merge, push/);
    assert.ok(p.includes(`reread your notes in ${notesFile}`), 'rereads its notes before each answer');
    assert.ok(p.includes(`>> ${ANSWERS_LOG}`), 'logs to the answers log');
    assert.ok(p.includes(`"${name}" "<asking thread>" "<question>"`), 'each log line names the lead and the asker');
  }
  assert.match(project, /lead for the project shop/, "a project lead's own prompt still comes first");
  assert.match(top, /- Lead shop: \/code\/shop/);
  assert.match(top, /- api: \/code\/api/);
  assert.match(top, /nebula ask "Lead <project>" "<question>" --timeout 90/);
  assert.match(top, /\/Users\/me\/vault/);
  assert.match(top, /\[observatory\] leads: <name> \(<path>\)/);
  assert.equal(TOP_NOTES, '~/.config/observatory/leads/top.md');

  // The top lead starts on its own model, then the prompt and /model as for a project lead.
  const calls = [];
  const saved = await startLeadThread(
    top,
    { model: '', notes: TOP_NOTES },
    {
      create: async (prompt, model) => (calls.push(['create', prompt, model]), 'top-1'),
      send: async (id, text) => calls.push(['send', id, text]),
      save: (l) => calls.push(['save', l]),
    },
    DEFAULT_TOP_MODEL,
  );
  assert.equal(DEFAULT_TOP_MODEL, 'sonnet');
  assert.deepEqual(calls.map((c) => c[0]), ['create', 'save', 'send']);
  assert.equal(calls[0][1], top);
  assert.deepEqual(calls[2], ['send', 'top-1', '/model sonnet']);
  assert.deepEqual(saved, { agentId: 'top-1', model: 'sonnet', notes: TOP_NOTES });
});

// ---- the log ----

test('Given 12 sourced answers and 3 ASK_USER today and 5 from yesterday, the Settings row says Answered 12, passed 3 to you today', () => {
  const now = new Date(2026, 10, 8, 18, 0, 0);
  const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
  const today = (h) => iso(new Date(2026, 10, 8, h, 15, 0));
  const yesterday = (h) => iso(new Date(2026, 10, 7, h, 15, 0));
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(`${today(1 + (i % 16))} Lead shop Fix login Q: where is auth? A: src/auth.ts src: README.md`);
  for (let i = 0; i < 3; i++) lines.push(`${today(9)} Lead Add facets Q: size or color? A: ASK_USER: Which facet first? src: ASK_USER`);
  for (let i = 0; i < 5; i++) lines.push(`${yesterday(10)} Lead api Docs Q: deploy? A: fly src: CLAUDE.md`);
  lines.push('', 'not a line', `${today(2)} Lead shop x Q: y A: z`);
  const counts = logCounts(lines.join('\n'), now);
  assert.deepEqual(counts, { answered: 12, passed: 3 });
  assert.equal(countsText(counts), 'Answered 12, passed 3 to you today');
  assert.deepEqual(logCounts('', now), { answered: 0, passed: 0 });
});

// ---- a stopped top lead ----

test("Given the top lead's thread is archived or deleted, Settings says Top lead stopped, and launched tasks name only their project lead", () => {
  const top = lead('top');
  const cards = { pa: card(lead('l1')), pb: card() };
  assert.equal(leadState(top, { top: { archived: false } }), 'running');
  for (const agents of [{ l1: { archived: false }, top: { archived: true } }, { l1: { archived: false } }]) {
    assert.equal(leadState(top, agents), 'stopped');
    const line = askLineFor('pa', { cards, agents, projects, topLead: top });
    assert.match(line, /"Lead shop"/);
    assert.ok(!line.includes('use `Lead`'), line);
    assert.equal(askLineFor('pb', { cards, agents, projects, topLead: top }), null);
  }
});

test('The top lead is left out of triage, parking and stuck checks, like the project leads', () => {
  const cards = { pa: card(lead('l1')), pb: card() };
  assert.deepEqual([...leadIds(cards)], ['l1']);
  assert.deepEqual([...leadIds(cards, lead('top'))].sort(), ['l1', 'top']);
  assert.deepEqual([...leadIds(cards, undefined)], ['l1']);
});

test("The top lead's thread is never reviewed (S10), as reviewRunner sees it through leadIds()", async () => {
  const { needsReview } = await import('../src/nebula/review.ts');
  const cards = { pa: card(lead('l1')), pb: card() };
  const ids = leadIds(cards, lead('top'));
  const trigger = { changed: true, label: 'review', checks: ['npm test'], key: 'k' };
  assert.equal(needsReview({ ...trigger, lead: ids.has('task-1') }), true, 'a task is reviewed');
  assert.equal(needsReview({ ...trigger, lead: ids.has('top') }), false, 'the top lead is not');
  assert.equal(needsReview({ ...trigger, lead: leadIds(cards).has('top') }), true, 'it is only left out once it is the top lead');
});
