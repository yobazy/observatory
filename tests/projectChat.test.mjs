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

const { chatItems, chatPreview, eventText, leadActivity, liveReply, sinceToday, taskStep } = await import('../src/nebula/projectChat.ts');
const { withoutActions, askKey, outcomesOf } = await import('../src/nebula/leadActions.ts');
const { callState, petTint, luminance, inkOn, solidTint, contrast, DARK_INK, LIGHT_INK, QUIET } = await import('../src/nebula/leadChat.ts');
const { withoutLeads, actionRules, LINE_PREFIX } = await import('../src/nebula/lead.ts');
const { COATS } = await import('../src/vendor/pixel-pets/frames.ts');
const { draftCard, reloadCards } = await import('../src/nebula/cards.ts');
const store = await import('../src/nebula/store.ts');
const { recentThreads } = await import('../src/nebula/recentThreads.ts');

const entries = (...rows) => rows.map(([kind, text, at = 1000], n) => ({ n, kind, text, at, steps: [] }));
const kinds = (items) => items.map((i) => i.kind);

// ---- the chat, from the lead's transcript ----

test("Given a lead's transcript, then its starting prompt is hidden, my messages are mine, [observatory] lines are event lines in plain words, and replies lose their action lines", () => {
  const t = entries(
    ['you', "You're the lead for storefront. Your notes live in ~/.config/observatory/leads/storefront.md."],
    ['you', "Fix the window's bottom edge clipping."],
    ['claude', 'Starting that on a new branch.\n\nSTART fix-bottom-clip: Stop the bottom edge clipping. Run the checks, then open a PR.'],
    ['you', '[observatory] CI failed #193: Fix bottom clip on fix-bottom-clip (agent a7): lint\n[observatory] nudged a7'],
    ['claude', 'It had an unused import.\n- NUDGE a7: run lint and push again\n```\nSTART keep-me: a line in a fence stays\n```\nASK merge #193: green, you asked for it'],
    ['steps', ''],
    ['claude', 'PASS shop: a brief\nASK archive a7: it said safe to close'],
  );
  const items = chatItems(t, { leadId: 'lead', name: (id) => (id === 'a7' ? 'Fix bottom clip' : undefined) });
  assert.deepEqual(kinds(items), ['me', 'pet', 'event', 'event', 'pet']);
  assert.ok(!items.some((i) => i.text?.includes("You're the lead")), 'the starting prompt is hidden');
  assert.equal(items[0].text, "Fix the window's bottom edge clipping.");
  assert.equal(items[1].text, 'Starting that on a new branch.');
  assert.deepEqual([items[2].text, items[3].text], ['CI failed on #193: lint', 'Nudged Fix bottom clip']);
  // Action lines go, a fence's lines stay; a reply that's only action lines has no bubble.
  assert.equal(items[4].text, 'It had an unused import.\n```\nSTART keep-me: a line in a fence stays\n```');
  assert.ok(!items.some((i) => i.kind === 'pet' && /^(START|NUDGE|ASK|PASS) /m.test(i.text.replace(/```[\s\S]*```/, ''))));
});

test('Given each kind of [observatory] line, then eventText() says it in plain words', () => {
  const names = (id) => ({ a1: 'Fix login' })[id];
  const said = (line) => eventText(line, names);
  assert.equal(said('[observatory] finished: Fix login on fix-login (agent a1): Needs review of the redirect'), 'Fix login finished');
  assert.equal(said('[observatory] failed: Fix login on fix-login (agent a1): stuck: no output for 20 min'), 'Fix login failed: stuck: no output for 20 min');
  assert.equal(said('[observatory] needs you: Fix login on fix-login (agent a1): a permission prompt'), 'Fix login needs you');
  assert.equal(said('[observatory] PR opened #12: Fix login on fix-login (agent a1) https://github.com/o/r/pull/12: ready'), 'Fix login opened #12');
  assert.equal(said('[observatory] CI failed #193: Fix login on fix-login (agent a1): lint, test'), 'CI failed on #193: lint, test');
  assert.equal(said('[observatory] CI passed #193: Fix login on fix-login (agent a1): every check passed'), 'CI passed on #193');
  assert.equal(said('[observatory] PR merged #193: Fix login on fix-login (agent a1): merged'), '#193 merged');
  assert.equal(said('[observatory] safe to close: Fix login on fix-login (agent a1): ✅ Safe to close'), 'Fix login is safe to close');
  assert.equal(said('[observatory] started fix-bottom-clip (agent a9)'), 'Started fix-bottom-clip');
  assert.equal(said('[observatory] queued fix-bottom-clip: 2 running, waiting for a slot'), 'Queued fix-bottom-clip: 2 running, waiting for a slot');
  assert.equal(said('[observatory] refused START fix-login: fix-login is already a worktree in this project'), "Didn't start fix-login: fix-login is already a worktree in this project");
  assert.equal(said('[observatory] refused NUDGE a1: it was nudged 3 times in the last hour'), "Didn't nudge Fix login: it was nudged 3 times in the last hour");
  assert.equal(said('[observatory] passed to Lead shop'), 'Passed to Lead shop');
  assert.equal(said('[observatory] the user merged #12 (your ASK)'), 'You merged #12');
  assert.equal(said('[observatory] the user said no to archiving a1'), 'You said no to archiving Fix login');
  assert.equal(said('[observatory] actions are off'), 'Starting and nudging threads is off');
  assert.equal(said('[observatory] from the top lead: Make the invoice job retry'), 'From the top lead: Make the invoice job retry');
  assert.equal(said('[observatory] leads: Lead shop (/u/shop), Lead api (/u/api)'), 'Leads running: Lead shop, Lead api');
  // A line it doesn't know is shown as it came, without the prefix.
  assert.equal(said('[observatory] something new'), 'Something new');
});

test('Given started tasks and asks, then each shows under the reply that caused it, live, and a "Started" line for a task with a card is left out', () => {
  const t = entries(
    ['you', 'start prompt', 100],
    ['you', 'Make two changes', 200],
    ['claude', 'Starting both.\nSTART fix-a: one\nSTART fix-b: two', 210],
    ['you', '[observatory] started fix-a (agent a1)\n[observatory] queued fix-b: 2 running, waiting for a slot\n[observatory] started other (agent a3)', 220],
    ['claude', 'Both are green.\nASK merge #12: you asked for it', 300],
  );
  const tasks = [
    { taskId: 't1', branch: 'fix-a', at: 211_000, n: 2, replyAt: 210, label: 'PR #12', checks: { state: 'passing', failing: [] } },
    { taskId: 't2', branch: 'fix-b', at: 212_000, n: 2, replyAt: 210, label: 'queued' },
    // From before S29, with no reply number: under the last reply before it started.
    { taskId: 't3', branch: 'fix-c', at: 305_000, label: 'running' },
  ];
  const ask = { kind: 'ask', what: 'merge', pr: 12, why: 'you asked for it' };
  const answered = new Set();
  const build = () => chatItems(t, { leadId: 'lead', tasks, outcomes: [{ n: 4, at: 300, lines: [], asks: [ask] }], answered: (k) => answered.has(k) });
  const items = build();
  assert.deepEqual(kinds(items), ['me', 'pet', 'task', 'task', 'event', 'pet', 'task', 'ask']);
  assert.deepEqual(items.filter((i) => i.kind === 'task').map((i) => i.task.taskId), ['t1', 't2', 't3']);
  // The card says fix-a started and fix-b queued; a branch with no card keeps its line.
  assert.deepEqual(items.filter((i) => i.kind === 'event').map((i) => i.text), ['Started other']);
  assert.equal(items[7].done, null);
  assert.equal(items[7].n, 4);
  answered.add(askKey('lead', 4, ask, 300));
  assert.equal(build()[7].done, 'Answered');
});

test('Given an ask for the same PR in two replies, then only the latest stands; once either is answered, or the PR merged, neither does', () => {
  const t = entries(
    ['you', 'start prompt', 100],
    ['claude', 'Green.\nASK merge #12: you asked for it', 200],
    ['claude', 'Still green.\nASK merge #12: still waiting\nASK archive a1: it said safe to close', 300],
  );
  const merge = (why) => ({ kind: 'ask', what: 'merge', pr: 12, why });
  const archive = { kind: 'ask', what: 'archive', agentId: 'a1', why: 'it said safe to close' };
  const outcomes = [
    { n: 1, at: 200, lines: [], asks: [merge('you asked for it')] },
    { n: 2, at: 300, lines: [], asks: [merge('still waiting'), archive] },
  ];
  const done = (opts = {}) => chatItems(t, { leadId: 'lead', outcomes, ...opts }).filter((i) => i.kind === 'ask').map((i) => i.done);
  assert.deepEqual(done(), ['Asked again below', null, null]);
  // Answering the older row answers the question: the newer row too.
  const answered = new Set([askKey('lead', 1, merge('you asked for it'), 200)]);
  assert.deepEqual(done({ answered: (k) => answered.has(k) }), ['Answered', 'Answered', null]);
  // The PR merged or the thread archived since: overtaken.
  const settled = (a) => (a.what === 'merge' ? '#12 is merged' : 'Archived');
  assert.deepEqual(done({ settled }), ['#12 is merged', '#12 is merged', 'Archived']);
});

test("Given the rules sent when a lead's actions are turned on, then the chat hides them, and events around them still show", () => {
  const rules = `${LINE_PREFIX}actions are on. ${actionRules(2)}`;
  assert.ok(rules.includes(`${LINE_PREFIX}from the top lead: <brief>`), 'the rules have an example line that looks like an event');
  const t = entries(
    ['you', 'start prompt'],
    ['you', rules],
    ['you', `${LINE_PREFIX}finished: Fix login on fix-login (agent a1): done\n${rules}\n${LINE_PREFIX}CI passed #4: Fix login on fix-login (agent a1): every check passed`],
  );
  const items = chatItems(t, { leadId: 'lead' });
  // The switch turning on still shows, once per time it was sent; its rules don't.
  assert.deepEqual(items.map((i) => i.text), [
    'Starting and nudging threads is on',
    'Fix login finished',
    'Starting and nudging threads is on',
    'CI passed on #4',
  ]);
  assert.ok(!items.some((i) => /top lead|<brief>/.test(i.text)));
  assert.ok(!items.some((i) => i.kind === 'me'));
});

test('Given a lead waiting on a prompt, then the chat shows it waiting on its terminal rather than working', () => {
  assert.equal(leadActivity({ status: 'needs_feedback', queued: 1, sending: 1 }), 'prompt');
  assert.equal(leadActivity({ status: 'running', queued: 0, sending: 0 }), 'working');
  assert.equal(leadActivity({ status: 'running', queued: 1, sending: 0, onScreen: true }), 'prompt');
  assert.equal(leadActivity({ status: 'finished', queued: 1, sending: 0 }), 'working');
  assert.equal(leadActivity({ status: 'finished', queued: 0, sending: 1 }), 'working');
  assert.equal(leadActivity({ status: 'finished', queued: 0, sending: 0 }), 'idle');
});

test("Given a lead restarted, so a new reply has an old reply's entry number, then the old reply's asks and tasks don't land on it", () => {
  // The new session: entry 2 is a reply said at 900. The old session's
  // entry 2 (said at 500) asked to merge #7 and started old-branch.
  const t = entries(['you', 'start prompt', 800], ['you', 'Hello again', 850], ['claude', 'Back. Nothing new.', 900]);
  const ask = { kind: 'ask', what: 'merge', pr: 7, why: 'green' };
  const items = chatItems(t, {
    leadId: 'lead',
    outcomes: [{ n: 2, at: 500, lines: [], asks: [ask] }],
    tasks: [{ taskId: 'old', branch: 'old-branch', at: 501_000, n: 2, replyAt: 500, label: 'merged' }],
  });
  assert.ok(!items.some((i) => i.kind === 'ask'), "the old reply's ask isn't under the new one");
  // The old task goes by its time: before anything in the new session.
  assert.deepEqual(kinds(items), ['task', 'me', 'pet']);
  // The same reply, same time: its ask shows, keyed by entry and time.
  const now = chatItems(t, { leadId: 'lead', outcomes: [{ n: 2, at: 900, lines: [], asks: [ask] }] });
  assert.equal(now.find((i) => i.kind === 'ask').key, `a${askKey('lead', 2, ask, 900)}`);
  assert.notEqual(askKey('lead', 2, ask, 900), askKey('lead', 2, ask, 500));
  // A record from before S29 (no times): its task goes by time, its outcome isn't placed.
  const legacy = chatItems(t, { leadId: 'lead', outcomes: [{ n: 2, lines: [], asks: [ask] }], tasks: [{ taskId: 'l', branch: 'l', at: 950_000, n: 2, label: 'running' }] });
  assert.deepEqual(kinds(legacy), ['me', 'pet', 'task']);
});

test("Given outcomes from before and after a restart with the same entry number, then outcomesOf() keeps both, in the order they came", () => {
  const s = {
    history: [
      { leadId: 'l1', n: 2, at: 500, lines: [], asks: [] },
      { leadId: 'l1', n: 2, at: 900, lines: [], asks: [] },
    ],
    outcomes: { l1: { n: 2, at: 900, lines: [], asks: [] } },
  };
  assert.deepEqual(outcomesOf('l1', s).map((o) => [o.n, o.at]), [[2, 500], [2, 900]]);
});

test('Given a task with no reply before it (the session restarted), then it goes where its time puts it, not last', () => {
  const t = entries(['you', 'start prompt', 100], ['you', 'hello', 200], ['claude', 'hi', 400]);
  const items = chatItems(t, { leadId: 'lead', tasks: [{ taskId: 'old', branch: 'x', at: 300_000, label: 'merged' }] });
  assert.deepEqual(kinds(items), ['me', 'task', 'pet']);
});

test('Given a task in each state, then its card has the right step of Queued, Running, PR and Merged', () => {
  assert.deepEqual(taskStep({ label: 'queued' }), { step: 0, text: 'Queued', tone: 'running' });
  assert.deepEqual(taskStep({ label: 'running' }), { step: 1, text: 'Running', tone: 'running' });
  assert.deepEqual(taskStep({ label: 'PR #193' }), { step: 2, text: 'PR #193 open', tone: 'running' });
  assert.deepEqual(taskStep({ label: 'PR #193', checks: { state: 'failing', failing: ['lint'] } }), { step: 2, text: 'PR #193 · checks failing: lint', tone: 'bad' });
  assert.deepEqual(taskStep({ label: 'PR #193', checks: { state: 'passing', failing: [] } }), { step: 2, text: 'PR #193 · checks passed', tone: 'running' });
  assert.deepEqual(taskStep({ label: 'merged' }), { step: 3, text: 'Merged', tone: 'done' });
  assert.equal(taskStep({ label: 'failed' }).tone, 'bad');
  assert.equal(taskStep({ label: 'closed' }).tone, 'quiet');
});

test('Given a reply with action lines and Markdown, then the chat row preview is its first line of words', () => {
  assert.equal(chatPreview('START fix-a: a brief\n\nStarting **that** on `fix-a`.\nMore.'), 'Starting that on fix-a.');
  assert.equal(chatPreview('ASK merge #4: green'), '');
  assert.equal(chatPreview(null), '');
  const long = chatPreview('word '.repeat(60), 40);
  assert.ok(long.length <= 40 && long.endsWith('…'));
});

test("Given every outcome a lead's replies had, then outcomesOf() lists them in order, the latest too", () => {
  const s = {
    history: [
      { leadId: 'l1', n: 2, lines: ['Started a'], asks: [] },
      { leadId: 'l2', n: 3, lines: [], asks: [] },
    ],
    outcomes: { l1: { n: 6, lines: [], asks: [] } },
  };
  assert.deepEqual(outcomesOf('l1', s).map((o) => o.n), [2, 6]);
  assert.deepEqual(outcomesOf('l2', s).map((o) => o.n), [3]);
  assert.equal(withoutActions('a\nSTART x: y\nb'), 'a\nb');
});

test("Given an ASK line in a lead's latest reply, then its chat row calls with it counted, until the chat is opened", () => {
  const reply = { n: 9, text: 'Every check passed.\nASK merge #41: green, you asked for it', at: 50 };
  assert.deepEqual(callState({ reply, unseen: false, seen: { n: 4, at: 10 }, actions: true }), { calling: true, count: 1, why: 'ask' });
  // Opening the chat marks reply 9 seen.
  assert.equal(callState({ reply, unseen: false, seen: { n: 9, at: 50 }, actions: true }).calling, false);
});

test('Given an ASK line the app refused or one already answered, then it does not count toward the badge', () => {
  const reply = { n: 9, text: 'Done.\nASK merge #99: green', at: 50 };
  // The app took no ask from this reply (no open PR #99): nothing to answer.
  assert.deepEqual(callState({ reply, unseen: false, seen: null, actions: true, asks: 0 }), QUIET);
  assert.deepEqual(callState({ reply, unseen: true, seen: null, actions: true, asks: 0 }), { calling: true, count: 1, why: 'unread' });
  // An ASK_USER line still counts alongside the open asks.
  assert.deepEqual(callState({ reply: { ...reply, text: `${reply.text}\nASK_USER: which one?` }, unseen: false, seen: null, actions: true, asks: 1 }), { calling: true, count: 2, why: 'ask' });
});

// ---- the pet's colour ----

test("Given a pet, then its tint is its coat's base colour from pixel-pets, and a coat too dark or pale gives way", () => {
  const golden = COATS.dog.find((c) => c.id === 'golden');
  assert.equal(petTint({ kind: 'dog', coat: 'golden' }), golden.O);
  assert.equal(petTint({ kind: 'jaguar', coat: 'jaguar' }), COATS.jaguar.find((c) => c.id === 'jaguar').O);
  // Every coat gives a colour you can tint with on either theme.
  for (const [kind, coats] of Object.entries(COATS))
    for (const c of coats) {
      const tint = petTint({ kind, coat: c.id });
      assert.match(tint, /^#[0-9a-f]{6}$/i);
      assert.ok([c.O, c.D, c.S, c.W].includes(tint), `${kind}/${c.id} tints from its own coat`);
    }
  const black = petTint({ kind: 'cat', coat: 'black' });
  assert.ok(luminance(black) >= 0.08 || black === COATS.cat.find((c) => c.id === 'black').O);
});

test("Given a tint, then the words on it are dark on a pale coat and white on a dark one, whichever reads better", () => {
  assert.equal(inkOn('#d6d6d6'), DARK_INK);
  assert.equal(inkOn('#F7F7F2'), DARK_INK);
  assert.equal(inkOn('#E0B36A'), DARK_INK);
  assert.equal(inkOn('#1F1F26'), LIGHT_INK);
  assert.equal(inkOn('#525E6B'), LIGHT_INK);
  // A mid tone neither ink reads well on is lightened for the button.
  assert.ok(contrast('#6E7C8C', inkOn('#6E7C8C')) < 4.5);
  assert.notEqual(solidTint('#6E7C8C'), '#6E7C8C');
  assert.equal(solidTint('#E0B36A'), '#E0B36A');
  // Every pet's Yes, Send and badge read at 4.5:1 or better.
  for (const [kind, coats] of Object.entries(COATS))
    for (const c of coats) {
      const solid = solidTint(petTint({ kind, coat: c.id }));
      assert.ok(contrast(solid, inkOn(solid)) >= 4.5, `${kind}/${c.id}: ${solid} on ${inkOn(solid)}`);
    }
});

// ---- the lead's thread, hidden ----

test('Given a project lead and a top lead, then their threads are left out of every list and count of threads, and the rest stay', () => {
  localStorage.setItem(
    'observatory.cards',
    JSON.stringify({ cards: { p1: { ...draftCard({ files: [], isGitRepo: true }), lead: { agentId: 'lead1', model: 'sonnet', notes: 'n.md' } } } }),
  );
  reloadCards();
  const agent = (id, status, extra = {}) => ({ id, worktree_id: 'w1', name: id, status, archived: false, unseen: false, status_changed_at: 1, sort_order: 0, recent_prompts: [], ...extra });
  store.setState({
    loaded: true,
    prefs: { topLead: { agentId: 'top', model: 'opus', notes: 't.md' } },
    projects: { p1: { id: 'p1', name: 'shop', repo_path: '/u/shop', sort_order: 0 } },
    worktrees: { w1: { id: 'w1', project_id: 'p1', path: '/u/shop', branch: 'main', is_main: true, sort_order: 0 } },
    agents: {
      a1: agent('a1', 'needs_feedback'),
      a2: agent('a2', 'finished'),
      lead1: agent('lead1', 'needs_feedback'),
      top: agent('top', 'needs_feedback'),
    },
    selectedSession: null,
  });
  const s = store.getState();
  const ids = (xs) => xs.map((a) => a.id).sort();
  assert.deepEqual([...store.leadThreads(s)].sort(), ['lead1', 'top']);
  assert.deepEqual(ids(store.threadAgents(s)), ['a1', 'a2']);
  assert.deepEqual(ids(store.worktreeAgents(s, 'w1')), ['a1', 'a2']);
  assert.deepEqual(ids(store.projectAgents(s, 'p1')), ['a1', 'a2']);
  assert.deepEqual(ids(store.waitingAgents(s)), ['a1']);
  assert.deepEqual(ids(recentThreads(s, ['lead1', 'a2', 'top', 'a1'])), ['a1', 'a2']);
  assert.deepEqual(ids(withoutLeads(Object.values(s.agents), new Set(['lead1']))), ['a1', 'a2', 'top']);
});

// ---- cost today ----

test("Given a usage report, then sinceToday() keeps only today's hours", () => {
  const now = new Date(2026, 10, 9, 15, 0, 0);
  const today = new Date(2026, 10, 9, 9).getTime() / 1000;
  const yesterday = new Date(2026, 10, 8, 22).getTime() / 1000;
  const report = { sources: [], files: 0, buckets: [{ hour: today, session: 's' }, { hour: yesterday, session: 's' }] };
  assert.deepEqual(sinceToday(report, now).buckets.map((b) => b.hour), [today]);
  assert.equal(sinceToday(null, now), null);
});

test("the lead's avatar shows on the first reply of a run only, like a messaging app", async () => {
  const { runStarts } = await import('../src/nebula/projectChat.ts');
  const pet = (n, at) => ({ kind: 'pet', key: `p${n}`, n, text: 'hi', at });
  const items = [
    pet(1, 100),
    pet(2, 160),
    { kind: 'me', key: 'm3', text: 'ok', at: 200 },
    pet(4, 220),
    { kind: 'event', key: 'e5', text: 'CI failed', at: 230 },
    pet(6, 240),
    pet(7, 240 + 11 * 60),
    { kind: 'task', key: 't8', task: { taskId: 'x', branch: 'b', at: 0 } },
    pet(9, 2000),
  ];
  assert.deepEqual([...runStarts(items)], ['p1', 'p4', 'p6', 'p7', 'p9']);
  assert.deepEqual([...runStarts([])], []);
});

// ---- which reply's decisions take taps ----

test("Given a reply with decisions and then an update without any, then the earlier reply's decisions still take taps", () => {
  const pet = (n, text) => ({ kind: 'pet', key: `p${n}`, n, text, at: 0 });
  const me = (text) => ({ kind: 'me', key: text, text, at: 0 });
  const event = (text) => ({ kind: 'event', key: text, text, at: 0 });
  const asks = (text) => text.includes('?');
  assert.equal(liveReply([pet(1, 'Fix it now?'), event('Rebase finished'), pet(3, 'The rebase finished.')], asks), 1);
  assert.equal(liveReply([pet(1, 'Fix it now?'), pet(2, 'Merge it too?')], asks), 2);
  assert.equal(liveReply([pet(1, 'Fix it now?'), pet(2, 'Done.')], () => false), 2);
  assert.equal(liveReply([pet(1, 'Fix it now?'), me('1 A')], asks), -1);
  assert.equal(liveReply([pet(1, 'Fix it now?'), me('1 A'), pet(3, 'Started.')], asks), 3);
});
