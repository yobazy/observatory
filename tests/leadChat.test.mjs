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
  ALL_PROJECTS,
  callState,
  defaultPet,
  lastReply,
  leadsOf,
  markSeenInChat,
  petOf,
  seenInChat,
  validPet,
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

test('opening a lead\'s chat is remembered, and never goes backwards', () => {
  assert.equal(seenInChat('lead1'), null);
  markSeenInChat('lead1', 5);
  assert.equal(seenInChat('lead1'), 5);
  markSeenInChat('lead1', 3);
  assert.equal(seenInChat('lead1'), 5);
});

// ---- which leads ----

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
  // What each one's chat is called (S29).
  assert.deepEqual(got.map((l) => l.name), [ALL_PROJECTS, 'billing-api', 'storefront']);
});
