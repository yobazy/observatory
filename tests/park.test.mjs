import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= {
  data: new Map(),
  getItem(k) {
    return this.data.has(k) ? this.data.get(k) : null;
  },
  setItem(k, v) {
    this.data.set(k, String(v));
  },
  removeItem(k) {
    this.data.delete(k);
  },
};

const {
  DEFAULT_PARK_DAYS,
  freshStart,
  parkIdea,
  parkMs,
  parkThreads,
  parkedLine,
  resumeParked,
  toPark,
  undoPark,
  unsettledAgents,
} = await import('../src/nebula/park.ts');
const { moveBrief } = await import('../src/nebula/movebrief.ts');
const { DEFAULT_STALE_DAYS } = await import('../src/nebula/triage.ts');

const DAY = 24 * 3600_000;
const NOW = 100 * DAY;

const session = (id, status, idleDays, over = {}) => ({
  id,
  status,
  status_changed_at: NOW - idleDays * DAY,
  archived: false,
  ...over,
});
const guards = (over = {}) => ({ pinned: new Set(), inBatch: new Set(), held: new Set(), kept: {}, ...over });

test('given sessions idle past the park threshold, toPark returns them, never running, waiting, pinned or in an unsettled batch', () => {
  assert.equal(DEFAULT_PARK_DAYS, 3);
  assert.equal(parkMs(undefined), 3 * DAY, 'default 3 days');
  assert.equal(parkMs(7), 7 * DAY, 'editable');
  // Its own pref, not the stale threshold's: both start at 3, set apart.
  assert.equal(DEFAULT_STALE_DAYS, 3);

  const sessions = [
    session('old-finished', 'finished', 10),
    session('old-stopped', 'terminated', 4),
    session('fresh-finished', 'finished', 1),
    session('running', 'running', 10),
    session('waiting', 'needs_feedback', 10),
    session('pinned', 'finished', 10),
    session('in-batch', 'finished', 10),
    session('held', 'finished', 10),
    session('archived', 'finished', 10, { archived: true }),
    session('disconnected', 'disconnected', 10),
    session('never-started', 'fresh', 10),
  ];
  const due = toPark(sessions, NOW, parkMs(3), guards({ pinned: new Set(['pinned']), inBatch: new Set(['in-batch']), held: new Set(['held']) }));
  assert.deepEqual(due.map((s) => s.id), ['old-finished', 'old-stopped'], 'oldest first');

  // A longer threshold leaves the 4-day one alone.
  assert.deepEqual(toPark(sessions, NOW, parkMs(5), guards()).map((s) => s.id).includes('old-stopped'), false);

  // Kept (unticked, resumed, undone) until it changes again.
  const kept = { 'old-finished': NOW - 10 * DAY };
  assert.deepEqual(toPark(sessions, NOW, parkMs(3), guards({ kept })).map((s) => s.id), ['held', 'in-batch', 'pinned', 'old-stopped']);
  const changed = { 'old-finished': NOW - 20 * DAY };
  assert.ok(toPark(sessions, NOW, parkMs(3), guards({ kept: changed })).some((s) => s.id === 'old-finished'), 'a newer change lets it park');
});

test('a session in a Dispatch batch that has not settled is kept out; a settled or dismissed batch is not', () => {
  const agent = (id, status) => ({ id, status, archived: false, worktree_id: 'w', recent_prompts: [] });
  const task = (id, agentId, state = 'launched') => ({ id, agentId, state, text: id, target: 'project', context: [], lane: null, launchedAt: 0 });
  const agents = { a1: agent('a1', 'finished'), a2: agent('a2', 'running'), b1: agent('b1', 'finished') };
  const batches = [
    { id: 'going', at: 0, tasks: [task('t1', 'a1'), task('t2', 'a2')] },
    { id: 'settled', at: 0, tasks: [task('t3', 'b1')] },
    { id: 'gone', at: 0, dismissed: true, tasks: [task('t4', 'a2')] },
  ];
  const out = unsettledAgents(batches, agents, () => 0, NOW);
  assert.deepEqual([...out].sort(), ['a1', 'a2'], 'a finished task in a batch still going is held');
});

const thread = (over = {}) => ({
  id: 'ag1',
  thread: 'Sync Retry Backoff',
  project: 'storefront',
  repo: '/Users/me/code/storefront',
  branch: 'cart-sync',
  path: '/Users/me/code/storefront-worktrees/cart-sync',
  prompts: ['add exponential backoff when a cart sync fails'],
  entries: [
    { n: 0, kind: 'you', text: 'add exponential backoff when a cart sync fails', at: 0, steps: [] },
    { n: 1, kind: 'claude', text: 'Done: retries after 1s, 2s, 4s.', at: 0, steps: [] },
  ],
  status_changed_at: NOW - 5 * DAY,
  unseen: false,
  ...over,
});

test("given a thread to park, the idea is its title, moveBrief's brief, its repo and source parked; review or unseen is high priority", () => {
  const t = thread();
  const idea = parkIdea(t, NOW);
  assert.equal(idea.text, 'Sync Retry Backoff');
  assert.equal(idea.project, '/Users/me/code/storefront');
  assert.deepEqual(idea.source, { kind: 'parked', agent: 'ag1' });
  assert.equal(idea.brief, moveBrief({ ...t, why: 'parked in Ideas after 5 days idle', close: 'Pick up from there.' }));
  assert.match(idea.brief, /^This continues “Sync Retry Backoff”, a thread in storefront .*parked in Ideas after 5 days idle\. That thread still has the whole conversation\./);
  assert.match(idea.brief, /Done: retries after 1s, 2s, 4s\./);
  assert.equal(idea.priority, undefined, 'no priority otherwise');

  assert.equal(parkIdea(thread({ label: 'review' }), NOW).priority, 'high');
  assert.equal(parkIdea(thread({ unseen: true }), NOW).priority, 'high');
  assert.equal(parkIdea(thread({ label: 'checked' }), NOW).priority, undefined);
});

/** A stand-in world: ideas in a list, archived ids in a set, every request logged. */
function world({ failArchive = new Set(), failUnarchive = new Set() } = {}) {
  const w = { ideas: [], archived: new Set(), calls: [], started: [] };
  let n = 0;
  w.deps = {
    addIdeas: async (list) => {
      const made = list.map((i) => ({ ...i, id: `i${++n}`, createdAt: NOW }));
      w.ideas.unshift(...made);
      return made;
    },
    deleteIdeas: async (ids) => {
      w.ideas = w.ideas.filter((i) => !ids.includes(i.id));
      return true;
    },
    request: async (variant, { id }) => {
      w.calls.push(`${variant} ${id}`);
      if (variant === 'ArchiveAgent') {
        if (failArchive.has(id)) throw new Error('nope');
        w.archived.add(id);
      } else {
        if (failUnarchive.has(id)) throw new Error('nope');
        w.archived.delete(id);
      }
      return { Ack: null };
    },
  };
  w.markStarted = async (ids, as) => {
    w.started.push([ids, as]);
    w.ideas = w.ideas.map((i) => (ids.includes(i.id) ? { ...i, startedAs: as } : i));
  };
  return w;
}

test('parking writes the ideas and archives each session; one that will not archive keeps going and its idea is taken back', async () => {
  const w = world({ failArchive: new Set(['ag3']) });
  const p = await parkThreads([thread(), thread({ id: 'ag2', thread: 'Two' }), thread({ id: 'ag3', thread: 'Three' })], w.deps, NOW);
  assert.deepEqual([...w.archived].sort(), ['ag1', 'ag2']);
  assert.deepEqual(w.ideas.map((i) => i.text).sort(), ['Sync Retry Backoff', 'Two']);
  assert.equal(p.items.length, 2);
  assert.equal(p.failed.length, 1);
  assert.equal(parkedLine(p), 'Parked 2 idle threads');
  assert.equal(parkedLine({ ...p, items: p.items.slice(0, 1) }), 'Parked 1 idle thread');

  const none = world();
  none.deps.addIdeas = async () => null;
  const q = await parkThreads([thread()], none.deps, NOW);
  assert.equal(none.calls.length, 0, 'no idea saved: nothing archived');
  assert.equal(q.items.length, 0);
});

test('given Undo right after a park, every thread from it is unarchived and its idea removed', async () => {
  const w = world();
  w.ideas.push({ id: 'mine', text: 'an idea of my own', project: null, createdAt: 0 });
  const p = await parkThreads([thread(), thread({ id: 'ag2', thread: 'Two' }), thread({ id: 'ag3', thread: 'Three' })], w.deps, NOW);
  assert.equal(w.archived.size, 3);

  const { restored, errors } = await undoPark(p, w.deps);
  assert.deepEqual(restored, ['ag1', 'ag2', 'ag3']);
  assert.deepEqual(errors, []);
  assert.equal(w.archived.size, 0, 'every one unarchived');
  assert.deepEqual(w.calls.filter((c) => c.startsWith('Unarchive')), ['UnarchiveAgent ag1', 'UnarchiveAgent ag2', 'UnarchiveAgent ag3']);
  assert.deepEqual(w.ideas.map((i) => i.id), ['mine'], 'only the park’s ideas go');

  // One that can't come back keeps its idea, so it's still findable.
  const v = world({ failUnarchive: new Set(['ag2']) });
  const p2 = await parkThreads([thread(), thread({ id: 'ag2', thread: 'Two' })], v.deps, NOW);
  const r2 = await undoPark(p2, v.deps);
  assert.deepEqual(r2.restored, ['ag1']);
  assert.equal(r2.errors.length, 1);
  assert.deepEqual(v.ideas.map((i) => i.text), ['Two']);
});

test('given a parked idea, Resume unarchives the session and marks the idea started; Start fresh opens the brief in its project', async () => {
  const w = world();
  const p = await parkThreads([thread()], w.deps, NOW);
  const idea = w.ideas.find((i) => i.id === p.items[0].idea);

  const id = await resumeParked(idea, { request: w.deps.request, markStarted: w.markStarted });
  assert.equal(id, 'ag1');
  assert.ok(!w.archived.has('ag1'), 'unarchived');
  assert.deepEqual(w.started, [[[idea.id], 'ag1']], 'marked started as that session');

  assert.deepEqual(freshStart(idea), { task: idea.brief, repo: '/Users/me/code/storefront' });
  assert.match(freshStart(idea).task, /^This continues “Sync Retry Backoff”/);
  await assert.rejects(resumeParked({ id: 'x', text: 'plain', project: null, createdAt: 0 }, { request: w.deps.request, markStarted: w.markStarted }));
});
