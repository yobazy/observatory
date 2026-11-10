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
  BATCH_SIZE,
  TAIL_CHARS,
  ackState,
  acknowledge,
  batches,
  buildTriagePrompt,
  changeKey,
  finalLabel,
  loadAcks,
  loadTriage,
  nextInQueue,
  parseTriage,
  queueRows,
  rankQueue,
  reloadTriage,
  saveTriage,
  staleMs,
  tailText,
  toTriage,
  triagePass,
} = await import('../src/nebula/triage.ts');

const NOW = 1_800_000_000_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const session = (id, extra = {}) => ({ id, status: 'finished', status_changed_at: NOW - HOUR, length: 10, ...extra });
const recordFor = (s, label = 'review') => ({ label, need: 'x', key: changeKey(s), at: NOW - HOUR });

test('only sessions changed since their last triage are sent, and none when none changed', () => {
  const sessions = Array.from({ length: 30 }, (_, i) => session(`s${i}`));
  const records = Object.fromEntries(sessions.map((s) => [s.id, recordFor(s)]));
  const changed = sessions.map((s, i) =>
    i === 3 ? { ...s, status: 'needs_feedback' } : i === 7 ? { ...s, status_changed_at: s.status_changed_at + 5 } : i === 12 ? { ...s, length: 14 } : s,
  );
  const { send, stale } = toTriage(changed, records, NOW, staleMs(3));
  assert.deepEqual(send.map((s) => s.id), ['s3', 's7', 's12']);
  assert.deepEqual(stale, []);
  assert.deepEqual(toTriage(sessions, records, NOW, staleMs(3)).send, []);
});

test('a pass with nothing changed makes no model call, and a pass with triage off makes none at all', async () => {
  const sessions = [session('a'), session('b')].map((s) => ({ ...s, name: s.id, project: 'p', lastPrompt: '', held: false }));
  let records = Object.fromEntries(sessions.map((s) => [s.id, recordFor(s)]));
  let calls = 0;
  const deps = {
    on: true,
    sessions,
    records: () => records,
    save: (r) => (records = r),
    length: async (s) => s.length,
    context: async () => ({ tail: '', summary: '' }),
    run: async () => {
      calls++;
      return '{"sessions":[]}';
    },
    now: () => NOW,
  };
  const r = await triagePass(deps);
  assert.equal(r.calls, 0);
  assert.equal(calls, 0);
  const off = await triagePass({ ...deps, on: false, sessions: [{ ...sessions[0], status: 'needs_feedback' }] });
  assert.equal(off.calls, 0);
  assert.equal(calls, 0);
});

test('a session unchanged past the stale threshold is labelled stale without a model call', async () => {
  const old = { ...session('old', { status_changed_at: NOW - 4 * DAY }), name: 'Old', project: 'p', lastPrompt: '', held: false };
  const waiting = { ...session('wait', { status: 'needs_feedback', status_changed_at: NOW - 9 * DAY }), name: 'W', project: 'p', lastPrompt: '', held: false };
  let records = {};
  const prompts = [];
  const r = await triagePass({
    on: true,
    sessions: [old, waiting],
    records: () => records,
    save: (next) => (records = next),
    length: async () => 3,
    context: async () => ({ tail: '', summary: '' }),
    run: async (p, parts) => {
      prompts.push(parts.map((x) => x.id));
      return JSON.stringify({ sessions: parts.map((x) => ({ id: x.id, label: 'review', need: 'n' })) });
    },
    now: () => NOW,
    staleMs: staleMs(3),
  });
  assert.equal(records.old.label, 'stale');
  assert.equal(records.old.need, 'Idle 4 days');
  assert.deepEqual(prompts, [['wait']], 'only the waiting one, never stale, goes to the model');
  assert.equal(records.wait.label, 'decision');
  assert.equal(r.stale, 1);
  // The threshold is editable.
  assert.deepEqual(toTriage([old], {}, NOW, staleMs(7)).stale, []);
  // And an already-stale one isn't written again.
  assert.deepEqual(toTriage([{ ...old, length: null }], records, NOW, staleMs(3)).stale, []);
});

const part = (id, extra = {}) => ({
  id,
  title: `Thread ${id}`,
  project: 'proj',
  status: 'finished',
  lastPrompt: 'do the thing',
  summary: 'Edited 2 files · Tests passed',
  tail: 'x'.repeat(10_000),
  ...extra,
});

test('each session part holds at most 3,000 characters of tail plus summary, last prompt and status, 10 per call', () => {
  const prompt = buildTriagePrompt([part('a'), part('b')]);
  for (const id of ['a', 'b']) {
    const start = prompt.indexOf(`## [${id}]`);
    const end = prompt.indexOf('## [', start + 1);
    const section = prompt.slice(start, end < 0 ? undefined : end);
    assert.match(section, /status finished/);
    assert.match(section, /Last prompt: "do the thing"/);
    assert.match(section, /Latest turn: Edited 2 files · Tests passed/);
    const tail = section.split('Transcript tail:\n')[1].trim();
    assert.ok(tail.length <= TAIL_CHARS, `tail is ${tail.length}`);
    assert.ok(tail.length > TAIL_CHARS - 10);
  }
  assert.equal(BATCH_SIZE, 10);
  assert.deepEqual(batches(Array.from({ length: 23 }, (_, i) => i), BATCH_SIZE).map((b) => b.length), [10, 10, 3]);
});

test('tailText keeps the end of the transcript', () => {
  const entries = [
    { kind: 'you', text: 'first' },
    { kind: 'steps', text: '', steps: [{ tool: 'Bash', target: 'npm test', ok: true }] },
    { kind: 'claude', text: 'y'.repeat(5000) + ' Shall I merge?' },
  ];
  const t = tailText(entries, () => 'Ran npm test');
  assert.ok(t.length <= TAIL_CHARS);
  assert.ok(t.endsWith('Shall I merge?'));
  assert.equal(tailText(entries.slice(0, 2), () => 'Ran npm test'), 'You: first\n[Ran npm test]');
});

test('parseTriage gives each session one of five labels and a need of at most 100 characters', () => {
  const reply = JSON.stringify({
    sessions: [
      { id: 'a', label: 'decision', need: 'Pick A or B' },
      { id: 'b', label: 'Review', need: 'z'.repeat(300) },
      { id: 'c', label: 'checked', need: 'Nothing' },
      { id: 'd', label: 'stuck', need: 'Tests keep failing' },
      { id: 'e', label: 'stale', need: '' },
      { id: 'zz', label: 'review', need: 'not sent' },
    ],
  });
  const r = parseTriage('Here you go:\n' + reply, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(r.error, null);
  assert.deepEqual(Object.keys(r.results), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(r.results.b.label, 'review');
  assert.equal(r.results.b.need.length, 100);
  assert.ok(r.results.b.need.endsWith('…'));
});

test('an unknown label, a missing session or non-JSON keep previous labels and report one error', async () => {
  const r = parseTriage(JSON.stringify({ sessions: [{ id: 'a', label: 'urgent', need: 'x' }, { id: 'b', label: 'review', need: 'y' }] }), ['a', 'b', 'c']);
  assert.deepEqual(Object.keys(r.results), ['b']);
  assert.equal(typeof r.error, 'string');
  assert.match(r.error, /1 with a label it doesn't know and 1 left out/);
  const bad = parseTriage('not json at all', ['a']);
  assert.deepEqual(bad.results, {});
  assert.match(bad.error, /no JSON/);

  // Through a pass: the previous labels stay, and there's one error.
  const sessions = ['a', 'b', 'c'].map((id) => ({ ...session(id, { length: 20 }), name: id, project: 'p', lastPrompt: '', held: false }));
  const before = Object.fromEntries(sessions.map((s) => [s.id, { label: 'checked', need: 'old', key: 'older', at: 1 }]));
  let records = before;
  const result = await triagePass({
    on: true,
    sessions,
    records: () => records,
    save: (next) => (records = next),
    length: async (s) => s.length,
    context: async () => ({ tail: '', summary: '' }),
    run: async () => 'nope',
    now: () => NOW,
  });
  assert.equal(result.errors.length, 1);
  assert.deepEqual(records, before);
});

test('a session waiting on you, or held at a usage limit, is a decision whatever the model says; a running one is not queued', async () => {
  assert.equal(finalLabel('needs_feedback', false, 'checked'), 'decision');
  assert.equal(finalLabel('finished', true, 'review'), 'decision');
  assert.equal(finalLabel('finished', false, 'review'), 'review');

  const sessions = [
    { ...session('w', { status: 'needs_feedback' }), name: 'w', project: 'p', lastPrompt: '', held: false },
    { ...session('h'), name: 'h', project: 'p', lastPrompt: '', held: true },
    { ...session('r', { status: 'running' }), name: 'r', project: 'p', lastPrompt: '', held: false },
  ];
  let records = {};
  const sent = [];
  await triagePass({
    on: true,
    sessions,
    records: () => records,
    save: (next) => (records = next),
    length: async () => 1,
    context: async () => ({ tail: '', summary: '' }),
    run: async (_p, parts) => {
      sent.push(...parts.map((p) => p.id));
      return JSON.stringify({ sessions: parts.map((p) => ({ id: p.id, label: 'checked', need: 'done' })) });
    },
    now: () => NOW,
  });
  assert.deepEqual(sent, ['w', 'h']);
  assert.equal(records.w.label, 'decision');
  assert.equal(records.h.label, 'decision');
  assert.equal(records.r, undefined);
  const q = queueRows([...sessions, session('r2', { status: 'running' })], { ...records, r2: { label: 'review', need: '', key: '', at: 0 } }, {}, (id) => id === 'h');
  assert.deepEqual(q.rows.map((r) => r.id).sort(), ['h', 'w']);
});

test('saveTriage writes only {label, need, key, at} per session, no transcript text', () => {
  saveTriage({
    a: { label: 'review', need: 'Look at it', key: 'k', at: 5, tail: 'secret transcript', summary: 'x', transcript: [1, 2] },
  });
  const stored = JSON.parse(localStorage.getItem('observatory.triage'));
  assert.deepEqual(stored, { a: { label: 'review', need: 'Look at it', key: 'k', at: 5 } });
  assert.ok(!localStorage.getItem('observatory.triage').includes('secret'));
  reloadTriage();
  assert.deepEqual(loadTriage(), stored);
});

test('the queue ranks decision, stuck, review, checked, folds stale away, and puts the longest waiting first', () => {
  const rows = [
    { id: 'c1', label: 'checked', need: '', since: 5 },
    { id: 's1', label: 'stale', need: '', since: 1 },
    { id: 'r2', label: 'review', need: '', since: 9 },
    { id: 'd2', label: 'decision', need: '', since: 8 },
    { id: 'k1', label: 'stuck', need: '', since: 7 },
    { id: 'r1', label: 'review', need: '', since: 2 },
    { id: 'd1', label: 'decision', need: '', since: 3 },
  ];
  const q = rankQueue(rows);
  assert.deepEqual(q.rows.map((r) => r.id), ['d1', 'd2', 'k1', 'r1', 'r2', 'c1']);
  assert.deepEqual(q.stale.map((r) => r.id), ['s1']);
});

test('"Got it" takes a row out of the queue until the session changes again', () => {
  localStorage.clear();
  reloadTriage();
  const s = session('a');
  const recs = { a: recordFor(s, 'checked') };
  assert.deepEqual(queueRows([s], recs, loadAcks()).rows.map((r) => r.id), ['a']);
  acknowledge('a', ackState(s));
  assert.deepEqual(queueRows([s], recs, loadAcks()).rows, []);
  reloadTriage();
  assert.deepEqual(queueRows([s], recs, loadAcks()).rows, [], 'it stays acknowledged across a reload');
  const changed = { ...s, status_changed_at: s.status_changed_at + 1000 };
  assert.deepEqual(queueRows([changed], recs, loadAcks()).rows.map((r) => r.id), ['a']);
});

test('⌘J opens the top row, then moves down the queue', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(nextInQueue(rows, null).id, 'a');
  assert.equal(nextInQueue(rows, 'zzz').id, 'a');
  assert.equal(nextInQueue(rows, 'a').id, 'b');
  assert.equal(nextInQueue(rows, 'c').id, 'a');
  assert.equal(nextInQueue([], 'a'), null);
});
