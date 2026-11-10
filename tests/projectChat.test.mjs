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

const { chatItems, chatPreview, eventText, sinceToday, taskStep } = await import('../src/nebula/projectChat.ts');
const { withoutActions, askKey, outcomesOf } = await import('../src/nebula/leadActions.ts');
const { callState, petTint, luminance } = await import('../src/nebula/leadChat.ts');
const { withoutLeads } = await import('../src/nebula/lead.ts');
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
    { taskId: 't1', branch: 'fix-a', at: 211_000, n: 2, label: 'PR #12', checks: { state: 'passing', failing: [] } },
    { taskId: 't2', branch: 'fix-b', at: 212_000, n: 2, label: 'queued' },
    // From before S29, with no reply number: under the last reply before it started.
    { taskId: 't3', branch: 'fix-c', at: 305_000, label: 'running' },
  ];
  const ask = { kind: 'ask', what: 'merge', pr: 12, why: 'you asked for it' };
  const answered = new Set();
  const build = () => chatItems(t, { leadId: 'lead', tasks, outcomes: [{ n: 4, lines: [], asks: [ask] }], answered: (k) => answered.has(k) });
  const items = build();
  assert.deepEqual(kinds(items), ['me', 'pet', 'task', 'task', 'event', 'pet', 'task', 'ask']);
  assert.deepEqual(items.filter((i) => i.kind === 'task').map((i) => i.task.taskId), ['t1', 't2', 't3']);
  // The card says fix-a started and fix-b queued; a branch with no card keeps its line.
  assert.deepEqual(items.filter((i) => i.kind === 'event').map((i) => i.text), ['Started other']);
  assert.equal(items[7].answered, false);
  assert.equal(items[7].n, 4);
  answered.add(askKey('lead', 4, ask));
  assert.equal(build()[7].answered, true);
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
  const reply = { n: 9, text: 'Every check passed.\nASK merge #41: green, you asked for it', at: 1 };
  assert.deepEqual(callState({ reply, unseen: false, seen: 4, actions: true }), { calling: true, count: 1, why: 'ask' });
  // Opening the chat marks reply 9 seen.
  assert.equal(callState({ reply, unseen: false, seen: 9, actions: true }).calling, false);
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
