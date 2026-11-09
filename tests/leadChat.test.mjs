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
  callState,
  defaultPet,
  lastReply,
  leadsOf,
  markSeenInChat,
  pages,
  paragraphs,
  petOf,
  readViewLine,
  seenInChat,
  shortcutTarget,
  validPet,
  wrap,
  TOP_PET,
  QUIET,
} = await import('../src/nebula/leadChat.ts');
const { BIG_CATS, COATS } = await import('../src/vendor/pixel-pets/frames.ts');

// ---- pets ----

test('the default pet from a project name is stable and varies across names', () => {
  const names = ['storefront', 'marketing-site', 'admin-dashboard', 'mobile-app', 'billing-api', 'design-system', 'data-pipeline', 'observatory', 'career-ops', 'baz-vault'];
  for (const n of names) {
    const a = defaultPet(n);
    assert.deepEqual(defaultPet(n), a, n);
    assert.ok(COATS[a.kind].some((c) => c.id === a.coat), `${n}: ${a.kind}/${a.coat} is a real coat`);
    assert.ok(!BIG_CATS.includes(a.kind), `${n}: big cats are for the top lead`);
  }
  // Pinned, so a change to the hash (which would swap everyone's pets) shows up here.
  assert.deepEqual(defaultPet('storefront'), { kind: 'dog', coat: 'golden' });
  assert.deepEqual(defaultPet('mobile-app'), { kind: 'frog', coat: 'sandy_toad' });
  const distinct = new Set(names.map((n) => `${defaultPet(n).kind}:${defaultPet(n).coat}`));
  assert.ok(distinct.size >= 7, `ten names give ${distinct.size} pets`);
  assert.ok(new Set(names.map((n) => defaultPet(n).kind)).size >= 3, 'more than one or two kinds');
  // Case and spaces around the name don't change it.
  assert.deepEqual(defaultPet(' Storefront '), defaultPet('storefront'));
});

test("the top lead's default is a big cat", () => {
  assert.deepEqual(TOP_PET, { kind: 'jaguar', coat: 'jaguar' });
  assert.ok(BIG_CATS.includes(petOf(undefined, null).kind));
  assert.deepEqual(petOf({ agentId: 't' }, null), TOP_PET);
  // A picked pet wins, for either kind of lead.
  assert.deepEqual(petOf({ pet: { kind: 'frog', coat: 'golden' } }, null), { kind: 'frog', coat: 'golden' });
  assert.deepEqual(petOf({ pet: { kind: 'dog', coat: 'corgi' } }, 'storefront'), { kind: 'dog', coat: 'corgi' });
  // One pixel-pets can't draw falls back: a made-up kind to the default, a made-up coat to the kind's first.
  assert.deepEqual(petOf({ pet: { kind: 'dragon', coat: 'red' } }, 'storefront'), defaultPet('storefront'));
  assert.deepEqual(validPet({ kind: 'cat', coat: 'plaid' }), { kind: 'cat', coat: 'orange' });
});

// ---- paging ----

const prose =
  'Fix login redirect finished and opened PR #61. The middleware was dropping returnTo when it refreshed the cookie, so people landed on the home page. ' +
  'I added a test for it and all 42 pass. Nothing else in the project changed, and the branch is pushed.\n\n' +
  'Next I would like to look at the token refresh, which has the same shape of bug in another place.';

const words = (s) => s.split(/\s+/).filter(Boolean);

test('paging splits prose into pages that fit and never splits a word', () => {
  const box = { cols: 40, rows: 3 };
  const got = pages(prose, box);
  assert.ok(got.length > 1, 'long prose takes more than one page');
  for (const p of got) {
    const lines = p.split('\n').flatMap((para) => wrap(para, box.cols));
    assert.ok(lines.length <= box.rows, `"${p}" is ${lines.length} lines`);
    for (const l of lines) assert.ok(l.length <= box.cols, `"${l}" is wider than the box`);
  }
  // Every word, whole and in order, once.
  assert.deepEqual(words(got.join(' ')), words(prose));
  // A paragraph starts on its own line.
  assert.ok(got.some((p) => p.includes('\nNext') || p.startsWith('Next')));
  // A word longer than a line gets a line to itself, uncut.
  const long = 'see /Users/dev/code/storefront-worktrees/cart-sync/src/cart/sync.ts now';
  const cut = pages(long, { cols: 20, rows: 3 });
  assert.deepEqual(words(cut.join(' ')), words(long));
  assert.ok(cut.join(' ').includes('/Users/dev/code/storefront-worktrees/cart-sync/src/cart/sync.ts'));
  // Short prose is one page; nothing is none.
  assert.deepEqual(pages('All quiet.', box), ['All quiet.']);
  assert.deepEqual(pages('', box), []);
});

test('code, table and list blocks are replaced by the Read view line', () => {
  const md = [
    'Sync applied every update with `Promise.all`, so they **raced**.',
    '',
    '```ts',
    'for (const update of pending) {',
    '  await this.apply(update);',
    '}',
    '```',
    '',
    '| Pick | File | Change |',
    '|---|---|---|',
    '| 1 | `src/cart/sync.ts` | one at a time |',
    '| 2 | `src/cart/retry.ts` | back off |',
    '',
    '- one',
    '- two',
    '- three',
    '- four',
    '- five',
    '',
    'Two choices:',
    '1. Fix it with a queue?',
    '2. Keep the old sync?',
    '',
    'ASK_USER: should a failed refresh go to /login?',
  ].join('\n');
  assert.deepEqual(paragraphs(md), [
    'Sync applied every update with Promise.all, so they raced.',
    readViewLine('code'),
    readViewLine('table'),
    readViewLine('list'),
    'Two choices:',
    '1. Fix it with a queue?',
    '2. Keep the old sync?',
    'ASK_USER: should a failed refresh go to /login?',
  ]);
  assert.equal(readViewLine('code'), '(code, see Read view)');
  const said = pages(md, { cols: 60, rows: 3 }).join('\n');
  assert.ok(!said.includes('await this.apply'), 'no code in the box');
  assert.ok(!said.includes('retry.ts'), 'no table in the box');
  assert.ok(!said.includes('five'), 'no long list in the box');
});

// ---- calling ----

const entries = (...texts) => texts.map(([kind, text], n) => ({ n, kind, text, at: 1000 + n, steps: [] }));

test('the latest reply is the last assistant entry with text', () => {
  const t = entries(['you', 'hi'], ['claude', 'first'], ['steps', ''], ['claude', 'second'], ['claude', '  ']);
  assert.deepEqual(lastReply(t), { n: 3, text: 'second', at: 1003 });
  assert.equal(lastReply([]), null);
  assert.equal(lastReply(null), null);
});

test('the call state is right for an ASK_USER reply, an unread reply, and an opened lead', () => {
  const ask = { n: 7, text: 'Fix login finished.\nASK_USER: should a failed refresh go to /login?', at: 1 };
  const plain = { n: 7, text: 'All quiet.', at: 1 };
  // Asks you: calls with the number of questions, read or not.
  assert.deepEqual(callState({ reply: ask, unseen: false, seen: 3 }), { calling: true, count: 1, why: 'ask' });
  assert.deepEqual(
    callState({ reply: { ...ask, text: `${ask.text}\nASK_USER: and keep returnTo?` }, unseen: true, seen: null }),
    { calling: true, count: 2, why: 'ask' },
  );
  // Unread: calls with one.
  assert.deepEqual(callState({ reply: plain, unseen: true, seen: null }), { calling: true, count: 1, why: 'unread' });
  assert.deepEqual(callState({ reply: plain, unseen: true, seen: 6 }), { calling: true, count: 1, why: 'unread' });
  // Read and asking nothing: quiet.
  assert.deepEqual(callState({ reply: plain, unseen: false, seen: null }), QUIET);
  // Opened since that reply: quiet, even one that asks or is still unread.
  assert.deepEqual(callState({ reply: ask, unseen: true, seen: 7 }), QUIET);
  assert.deepEqual(callState({ reply: plain, unseen: true, seen: 9 }), QUIET);
  // No reply yet: quiet.
  assert.deepEqual(callState({ reply: null, unseen: true, seen: null }), QUIET);
});

test('opening a lead in the dialogue is remembered, and never goes backwards', () => {
  assert.equal(seenInChat('lead1'), null);
  markSeenInChat('lead1', 5);
  assert.equal(seenInChat('lead1'), 5);
  markSeenInChat('lead1', 3);
  assert.equal(seenInChat('lead1'), 5);
});

// ---- ⌘L ----

const agents = { top: { archived: false }, la: { archived: false }, lb: { archived: false }, gone: { archived: true } };
const projects = { pa: { name: 'storefront' }, pb: { name: 'billing-api' }, pc: { name: 'old' } };
const cards = {
  pa: { lead: { agentId: 'la', model: 'haiku' } },
  pb: { lead: { agentId: 'lb', model: 'haiku', pet: { kind: 'turtle', coat: 'sea' } } },
  pc: { lead: { agentId: 'gone', model: 'haiku' } },
};
const topLead = { agentId: 'top', model: 'sonnet' };

test('the running leads, the top lead first, with their pets', () => {
  const got = leadsOf(cards, topLead, agents, projects);
  assert.deepEqual(got.map((l) => [l.agentId, l.title, l.model]), [
    ['top', 'Top lead', 'sonnet'],
    ['lb', 'billing-api lead', 'haiku'],
    ['la', 'storefront lead', 'haiku'],
  ]);
  assert.deepEqual(got[0].pet, TOP_PET);
  assert.deepEqual(got[1].pet, { kind: 'turtle', coat: 'sea' });
  assert.deepEqual(got[2].pet, defaultPet('storefront'));
});

test("⌘L's target picks the calling lead first, otherwise the top lead", () => {
  const leads = leadsOf(cards, topLead, agents, projects);
  const ask = { calling: true, count: 1, why: 'ask' };
  const unread = { calling: true, count: 1, why: 'unread' };
  assert.equal(shortcutTarget(leads, { la: ask }), 'la');
  // A question outranks an unread reply, wherever it is in the list.
  assert.equal(shortcutTarget(leads, { lb: unread, la: ask }), 'la');
  assert.equal(shortcutTarget(leads, { la: unread }), 'la');
  // Nobody calling: the top lead.
  assert.equal(shortcutTarget(leads, { la: QUIET, lb: QUIET }), 'top');
  assert.equal(shortcutTarget(leads, {}), 'top');
  // No top lead and nobody calling: nothing to open.
  assert.equal(shortcutTarget(leadsOf(cards, null, agents, projects), {}), null);
});
