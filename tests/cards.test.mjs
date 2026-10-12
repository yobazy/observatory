import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

const cards = await import('../src/nebula/cards.ts');
const { draftCard, excerpt, withPolicy, withConcurrency, canSchedule, saveCard, cardFor, allCards, reloadCards, homeCard, setHomeFolder, homeKeyFor, folderKey, clearHome, splitList } = cards;

/** What the Rust side's read_card_sources returns for a fixture folder. */
function readSources(dir, isGitRepo) {
  const files = [];
  const add = (rel) => existsSync(join(dir, rel)) && files.push({ path: rel, text: readFileSync(join(dir, rel), 'utf8') });
  add('CLAUDE.md');
  add('AGENTS.md');
  readdirSync(dir).filter((n) => n.toUpperCase().startsWith('README')).sort().forEach(add);
  const skills = join(dir, '.claude/skills');
  if (existsSync(skills)) readdirSync(skills).sort().forEach((s) => add(`.claude/skills/${s}/SKILL.md`));
  return { files, isGitRepo };
}

const FIXTURE = new URL('./fixtures/career-ops', import.meta.url).pathname;

function fresh() {
  localStorage.clear();
  reloadCards();
}

test('a folder with CLAUDE.md and .claude/skills/apply/SKILL.md drafts a card with the apply skill and a description', () => {
  const card = draftCard(readSources(FIXTURE, true));
  assert.ok(card.skills.includes('apply'));
  assert.deepEqual(card.skills, ['apply', 'tracker']);
  assert.ok(card.description.length > 0);
  assert.match(card.description, /^Job search pipeline: finds roles, tailors the resume/);
  assert.ok(!card.description.includes('npm run apply'), 'code is not part of the description');
  assert.ok(!card.description.includes('shields.io'), 'badges are not part of the description');
  assert.equal(card.skillNotes.apply, 'Apply to a job posting: tailor the resume, fill the form, and log it in the tracker.');
  assert.equal(card.skillNotes.tracker, 'Update the application tracker');
});

test('the description is an excerpt, capped, from AGENTS.md or the README when there is no CLAUDE.md', () => {
  const long = 'word '.repeat(400);
  const card = draftCard({ files: [{ path: 'README.md', text: `# Title\n\n${long}` }], isGitRepo: true });
  assert.ok(card.description.length <= cards.MAX_DESCRIPTION);
  assert.ok(card.description.endsWith('…'));
  const agents = draftCard({ files: [{ path: 'AGENTS.md', text: '---\nx: 1\n---\nAgents notes.' }, { path: 'README.md', text: 'Readme.' }], isGitRepo: true });
  assert.equal(agents.description, 'Agents notes.');
  assert.equal(draftCard({ files: [], isGitRepo: true }).description, '');
  assert.equal(excerpt('# H\n\nOne\nline.\n\nTwo.\n\nThree.'), 'One line.\n\nTwo.');
});

test('a project that is a git repo is first drafted with the isolated policy', () => {
  assert.equal(draftCard(readSources(FIXTURE, true)).policy, 'isolated');
});

test('set to shared, concurrency defaults to 1 and can be edited', () => {
  fresh();
  const shared = withPolicy(draftCard(readSources(FIXTURE, true)), 'shared');
  assert.equal(shared.policy, 'shared');
  assert.equal(shared.concurrency, 1);
  const three = withConcurrency(shared, 3);
  assert.equal(three.concurrency, 3);
  assert.equal(withConcurrency(shared, 0).concurrency, 1, 'never below one');
  saveCard('p1', three);
  reloadCards();
  assert.equal(cardFor('p1').concurrency, 3);
  assert.equal(cardFor('p1').policy, 'shared');
});

test('a plain folder picked as Home is the one Home card, shared, and flagging a second project as Home clears the first', () => {
  fresh();
  saveCard('p1', draftCard(readSources(FIXTURE, true)));
  const folder = '/Users/me/home';
  const key = homeKeyFor(folder, [{ id: 'p1', repo_path: FIXTURE }]);
  assert.equal(key, folderKey(folder), 'a folder that is no project gets a folder card');
  setHomeFolder(key, folder, { files: [], isGitRepo: false });
  reloadCards();

  let homes = Object.values(allCards()).filter((c) => c.isHome);
  assert.equal(homes.length, 1);
  assert.equal(homes[0].policy, 'shared');
  assert.equal(homes[0].homeFolder, folder);
  assert.equal(homeCard().key, key);

  // A project flagged Home takes it from the folder, whose card goes.
  saveCard('p2', { ...draftCard({ files: [], isGitRepo: true }), isHome: true, homeFolder: '/code/p2' });
  homes = Object.entries(allCards()).filter(([, c]) => c.isHome);
  assert.deepEqual(homes.map(([k]) => k), ['p2']);
  assert.equal(cardFor(key), null);

  // And another project after it clears p2, keeping p2's card.
  saveCard('p1', { ...cardFor('p1'), isHome: true, homeFolder: FIXTURE });
  homes = Object.entries(allCards()).filter(([, c]) => c.isHome);
  assert.deepEqual(homes.map(([k]) => k), ['p1']);
  assert.equal(cardFor('p2').isHome, false);
  assert.equal(cardFor('p2').homeFolder, null);

  clearHome();
  assert.equal(homeCard(), null);
});

test("a folder picked as Home that is a project's folder uses that project's card", () => {
  fresh();
  assert.equal(homeKeyFor(`${FIXTURE}/`, [{ id: 'p1', repo_path: FIXTURE }]), 'p1');
});

test('canSchedule is false while the Home card has no scheduling instruction and true once it has one', () => {
  fresh();
  const home = setHomeFolder(folderKey('/h'), '/h', { files: [], isGitRepo: false });
  assert.equal(home.schedulingInstruction, '');
  assert.equal(canSchedule(home), false);
  assert.equal(canSchedule({ ...home, schedulingInstruction: '   ' }), false);
  assert.equal(canSchedule({ ...home, schedulingInstruction: 'Check my calendar, ask for a time, then book it.' }), true);
  assert.equal(canSchedule(null), false);
});

test('saved cards come back after a reload, and unreadable storage starts with none', () => {
  fresh();
  saveCard('p1', { ...draftCard(readSources(FIXTURE, true)), description: 'Edited', taskKinds: splitList('job applications, outreach,, outreach') });
  reloadCards();
  assert.equal(cardFor('p1').description, 'Edited');
  assert.deepEqual(cardFor('p1').taskKinds, ['job applications', 'outreach']);

  localStorage.setItem('observatory.cards', '{not json');
  reloadCards();
  assert.deepEqual(allCards(), {});
  localStorage.setItem('observatory.cards', JSON.stringify({ cards: { a: { description: 'x', policy: 'weird', concurrency: -2 }, b: 7 } }));
  reloadCards();
  assert.deepEqual(Object.keys(allCards()), ['a']);
  assert.equal(cardFor('a').policy, 'isolated');
  assert.equal(cardFor('a').concurrency, 1);
});
