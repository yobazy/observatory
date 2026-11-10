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
  NOT_TRUSTED,
  CHECK_CHANGED,
  TWICE,
  buildReviewPrompt,
  criteriaFor,
  failsSoFar,
  freshRound,
  hasChanges,
  keysMatch,
  loadReviews,
  needsReview,
  parseVerdict,
  promptedTurn,
  reloadReviews,
  reviewKey,
  reviewPass,
  reviewedLabel,
  saveReview,
  withChecks,
  withReviews,
} = await import('../src/nebula/review.ts');

const NOW = 1_800_000_000_000;

/** A GitStatus with `over` on top: a clean checkout at commit abc. */
const git = (over = {}) => ({
  branch: 'fix', head: 'abc', upstream: null, upstreamGone: false, ahead: 0, behind: 0,
  staged: 0, unstaged: 0, untracked: 0, conflicted: 0, insertions: 0, deletions: 0,
  baseAhead: 0, lastCommit: null, ...over,
});
const dirty = git({ unstaged: 2, insertions: 10, deletions: 3 });

/** reviewPass's effects, faked: the checkout's state, the checks and the
 *  reviewer's reply are given; what was sent and saved is kept. */
function world(over = {}) {
  const w = {
    sent: [],
    saved: [],
    calls: 0,
    states: ['s0', 's0', 's0'],
    checks: [{ command: 'npm test', code: 0, output: 'ok' }],
    reply: '{"pass":true,"failures":[]}',
    busy: false,
    idle: true,
    queued: [],
    ...over,
  };
  let at = 0;
  w.deps = (more = {}) => ({
    on: true,
    fails: 0,
    key: reviewKey(dirty),
    checks: ['npm test'],
    context: async () => ({ project: 'app', branch: 'fix', criteria: 'Make the login page reject empty passwords', files: [] }),
    snapshot: async () => w.states[at++] ?? w.states[w.states.length - 1],
    runChecks: async () => w.checks,
    runReviewer: async (prompt) => {
      w.calls++;
      w.prompt = prompt;
      return w.reply;
    },
    busy: () => w.busy,
    // queue.ts's enqueue, stubbed: sent at once when idle, else queued.
    send: async (text) => {
      if (w.idle) w.sent.push(text);
      else w.queued.push(text);
      return w.idle ? 'sent' : 'queued';
    },
    save: (rec) => w.saved.push(rec),
    now: () => NOW,
    ...more,
  });
  return w;
}

test('S10: a turn ending with a diff, a non-decision label and checks on the card needs review; no diff, or the same HEAD and diff already passed, does not', () => {
  const key = reviewKey(dirty);
  const base = { changed: hasChanges(dirty), label: 'review', checks: ['npm test'], key };
  assert.equal(needsReview(base), true);
  assert.equal(needsReview({ ...base, label: undefined }), true, 'untriaged is fine');
  assert.equal(needsReview({ ...base, changed: hasChanges(git()) }), false, 'no diff');
  assert.equal(needsReview({ ...base, label: 'decision' }), false);
  assert.equal(needsReview({ ...base, checks: [] }), false, 'nothing to check against');
  const passed = { state: 'passed', key, failures: [], fails: 0, at: NOW };
  assert.equal(needsReview({ ...base, rec: passed }), false, 'this HEAD and diff already passed');
  assert.equal(needsReview({ ...base, rec: passed, key: reviewKey(git({ unstaged: 3, insertions: 12 })) }), true, 'a new edit since');
  assert.equal(needsReview({ ...base, rec: passed, key: reviewKey(git({ head: 'def' })) }), true, 'a new commit since');
  // New commits during the turn count as changes, even with nothing uncommitted.
  assert.equal(hasChanges(git({ head: 'def' }), 'abc'), true);
  assert.equal(hasChanges(git({ head: 'abc' }), 'abc'), false);
  assert.equal(hasChanges(git({ head: 'def' }), undefined), false);
});

test('S10: a review is only for a turn that was prompted, not a status flicker on an old thread opened to read', () => {
  const prompts = [{ text: 'fix the login', submitted_at: NOW - 60_000 }];
  assert.equal(promptedTurn(prompts, NOW - 30_000), true);
  assert.equal(promptedTurn([{ text: 'old', submitted_at: NOW - 3 * 86400_000 }], NOW), false);
  assert.equal(promptedTurn([], NOW), false);
  assert.equal(promptedTurn(prompts, undefined), true, 'a turn under way at launch');
});

test('S10: a reviewer reply parses to {pass, failures}; output that is not JSON is a failed review run and the row says "Couldn\'t check: <error>"', () => {
  assert.deepEqual(parseVerdict('{"pass":true,"failures":[]}'), { pass: true, failures: [] });
  assert.deepEqual(parseVerdict('Here you go:\n```json\n{"pass":false,"failures":["login.ts accepts an empty password","no test for it"]}\n```'), {
    pass: false,
    failures: ['login.ts accepts an empty password', 'no test for it'],
  });
  assert.equal(parseVerdict('{"pass":true,"failures":["but this is broken"]}').pass, false, 'a pass with problems is no pass');
  const bad = parseVerdict('I looked and it seems fine.');
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.failures, []);
  assert.match(bad.error, /no JSON/);
  assert.match(parseVerdict('{"verdict":"ok"}').error, /"pass"/);
  // A failed check fails the review even when the reviewer passed it.
  const v = withChecks({ pass: true, failures: [] }, [{ command: 'npm test', code: 1, output: 'boom' }]);
  assert.deepEqual(v, { pass: false, failures: ['`npm test` failed, exit 1'] });
});

test('S10: a failed review run is saved as an error, not a fail, and its row says "Couldn\'t check"', async () => {
  const w = world({ reply: 'not json at all' });
  const rec = await reviewPass(w.deps());
  assert.equal(rec.state, 'error');
  assert.equal(rec.fails, 0);
  assert.deepEqual(w.sent, [], 'nothing goes back to the builder');
  const row = reviewedLabel('review', 'Look over the fix', { changed: true, rec, key: rec.key });
  assert.equal(row.label, 'review');
  assert.match(row.need, /^Couldn't check: the reply had no JSON in it$/);
  // The reviewer CLI failing (refused while off, crashed) is the same.
  const crash = await reviewPass(world().deps({ runReviewer: async () => { throw new Error('The check before done is off'); } }));
  assert.equal(crash.state, 'error');
  assert.equal(crash.error, 'The check before done is off');
});

test('S10: a pass labels it checked; without one, a session with changes is never checked, even when the model says so', async () => {
  const w = world();
  const rec = await reviewPass(w.deps());
  assert.equal(rec.state, 'passed');
  assert.equal(w.calls, 1);
  assert.match(w.prompt, /Make the login page reject empty passwords/, 'the criteria are in the prompt');
  assert.match(w.prompt, /\$ npm test {3}\(passed\)/, 'the checks are in the prompt');
  const key = reviewKey(dirty);
  assert.deepEqual(reviewedLabel('review', 'Look over it', { changed: true, rec, key }), { label: 'checked', need: 'Checks passed' });
  // The model says checked, but there's no pass for this checkout.
  assert.equal(reviewedLabel('checked', 'All done', { changed: true }).label, 'review');
  assert.equal(reviewedLabel('checked', 'All done', { changed: true, rec, key: reviewKey(git({ unstaged: 5 })) }).label, 'review', 'a pass for an older state');
  assert.equal(reviewedLabel('checked', 'All done', { changed: false }).label, 'checked', 'no changes: the model can say so');
  assert.equal(reviewedLabel('decision', 'Pick one', { changed: true, rec, key }).label, 'decision', 'a decision stays one');
});

test('S10: a fail sends the builder one follow-up listing the failures (queued when busy) and the row says "Fixing: 2 checks failed"; a second fail sends nothing and labels it stuck', async () => {
  const reply = JSON.stringify({ pass: false, failures: ['login.ts accepts an empty password', 'tests/login.test.ts fails'] });
  const w = world({ reply, idle: false });
  const first = await reviewPass(w.deps());
  assert.equal(first.state, 'failed');
  assert.equal(first.fails, 1);
  assert.deepEqual(w.sent, []);
  assert.equal(w.queued.length, 1, 'busy: queued with queue.ts');
  assert.match(w.queued[0], /- login\.ts accepts an empty password\n- tests\/login\.test\.ts fails/);
  assert.equal(first.sent, w.queued[0]);
  assert.deepEqual(reviewedLabel('review', '', { changed: true, rec: first, key: first.key }), { label: 'review', need: 'Fixing: 2 checks failed' });

  // The builder's fix, then a second fail at its new state.
  const fixedKey = reviewKey(git({ unstaged: 3, insertions: 12 }));
  assert.equal(freshRound(first, [{ text: first.sent, submitted_at: NOW + 1000 }]), false, 'our follow-up is not a new round');
  assert.equal(needsReview({ changed: true, label: 'review', checks: ['npm test'], key: fixedKey, rec: first, fresh: false }), true);
  const w2 = world({ reply: JSON.stringify({ pass: false, failures: ['still broken'] }) });
  const second = await reviewPass(w2.deps({ prev: first, fails: failsSoFar(first, false), key: fixedKey }));
  assert.equal(second.state, 'failed');
  assert.equal(second.fails, 2);
  assert.deepEqual(w2.sent, [], 'no more follow-ups');
  assert.deepEqual(w2.queued, []);
  assert.deepEqual(reviewedLabel('review', 'x', { changed: true, rec: second, key: fixedKey }), { label: 'stuck', need: TWICE });
  assert.equal(needsReview({ changed: true, label: 'stuck', checks: ['npm test'], key: reviewKey(git({ head: 'zzz' })), rec: second, fresh: false }), false);
  // You prompting it again starts a new round.
  assert.equal(freshRound(second, [{ text: 'try another way', submitted_at: NOW + 5000 }]), true);

  // A fix turn that changed nothing is the second fail, with no reviewer call.
  const w3 = world();
  const same = await reviewPass(w3.deps({ prev: first, fails: 1, key: first.key }));
  assert.equal(w3.calls, 0);
  assert.equal(same.fails, 2);
  assert.deepEqual(w3.sent, []);

  // An idle builder gets it sent straight away.
  const w4 = world({ reply });
  await reviewPass(w4.deps());
  assert.equal(w4.sent.length, 1);
});

test('S10: a reviewer that changed the checkout has its verdict thrown away and the row says "Reviewer changed files; not trusted"', async () => {
  const w = world({ states: ['s0', 's0', 's1'] });
  const rec = await reviewPass(w.deps());
  assert.equal(rec.state, 'untrusted');
  assert.equal(rec.error, NOT_TRUSTED);
  assert.deepEqual(w.sent, []);
  const row = reviewedLabel('checked', 'Done', { changed: true, rec, key: rec.key });
  assert.deepEqual(row, { label: 'review', need: 'Reviewer changed files; not trusted' });
  // A check that wrote to the checkout is caught the same way.
  const c = await reviewPass(world({ states: ['s0', 's1', 's1'] }).deps());
  assert.equal(c.state, 'untrusted');
  assert.equal(c.error, CHECK_CHANGED);
  // The thread working again mid-review: nothing is saved.
  const w2 = world({ busy: true });
  assert.equal(await reviewPass(w2.deps()), null);
  assert.deepEqual(w2.saved, []);
});

test('S10: a card with the check turned off gets no review, and nothing runs while reviews are off', async () => {
  assert.equal(needsReview({ changed: true, label: 'review', checks: ['npm test'], key: 'k', off: true }), false);
  const w = world();
  let ran = 0;
  const rec = await reviewPass(w.deps({ on: false, runChecks: async () => { ran++; return []; }, snapshot: async () => { ran++; return ''; } }));
  assert.equal(rec, null);
  assert.equal(ran, 0);
  assert.equal(w.calls, 0);
});

test('S10: results are kept by agent id for later stories, and the queue shows reviewed threads', () => {
  localStorage.clear();
  reloadReviews();
  saveReview('a1', { state: 'passed', key: reviewKey(dirty), failures: [], fails: 0, at: NOW, extra: 'dropped' });
  saveReview('a2', { state: 'failed', key: 'k', failures: ['x'], fails: 2, at: NOW });
  reloadReviews();
  const recs = loadReviews();
  assert.deepEqual(Object.keys(recs).sort(), ['a1', 'a2']);
  assert.equal(recs.a1.state, 'passed');
  assert.equal('extra' in recs.a1, false);
  const agents = {
    a1: { id: 'a1', worktree_id: 'w1', status: 'finished', status_changed_at: NOW - 1000, archived: false },
    a2: { id: 'a2', worktree_id: 'w2', status: 'finished', status_changed_at: NOW - 5000, archived: false },
    a3: { id: 'a3', worktree_id: 'w1', status: 'running', status_changed_at: NOW, archived: false },
  };
  const q = withReviews({ rows: [], stale: [] }, { agents, git: { w1: dirty, w2: dirty } }, recs);
  assert.deepEqual(q.rows.map((r) => [r.id, r.label, r.need]), [
    ['a2', 'stuck', TWICE],
    ['a1', 'checked', 'Checks passed'],
  ]);
  assert.equal(criteriaFor('Dispatch task text', 'first prompt'), 'Dispatch task text');
  assert.equal(criteriaFor(null, 'first prompt'), 'first prompt');
});

test('S10: the prompt carries the criteria, each check with its result and output, and the diff', () => {
  const p = buildReviewPrompt({
    project: 'app',
    branch: 'fix',
    criteria: 'Reject empty passwords',
    checks: [{ command: 'npm test', code: 1, output: 'FAIL login' }],
    files: [{ path: 'login.ts', oldPath: null, status: 'modified', binary: false, tooBig: false, insertions: 1, deletions: 0, hunks: [{ header: '@@ -1 +1,2 @@', lines: [{ kind: 'add', text: 'if (!pw) throw', old: null, new: 1 }] }] }],
  });
  assert.match(p, /Reject empty passwords/);
  assert.match(p, /\$ npm test {3}\(failed, exit 1\)\nFAIL login/);
  assert.match(p, /--- login\.ts \(modified, \+1 -0\)\n@@ -1 \+1,2 @@\n\+if \(!pw\) throw/);
  assert.match(p, /read-only/);
});

test('a fix on the same line as the break gets its own key and a second review; the same content keeps the key', async () => {
  // A one-line break and its one-line fix: the same counts, different content.
  const shape = git({ head: '6af8b3c', unstaged: 1, insertions: 1, deletions: 1 });
  const broken = reviewKey(shape, '6af8b3c|refs/heads/fix|1111|M add.sh  (a + b)');
  const fixed = reviewKey(shape, '6af8b3c|refs/heads/fix|2222|M add.sh  (a - b)');
  assert.notEqual(broken, fixed, 'same size, different content: a new key');
  assert.equal(reviewKey(shape, '6af8b3c|refs/heads/fix|1111|M add.sh  (a + b)'), broken, 'identical content: the same key');
  assert.equal(reviewKey(shape), '6af8b3c|0|1|0|0|1|1', 'the shape alone, as the polled state gives it');

  // The first review fails at the broken state and sends the follow-up.
  const reply = JSON.stringify({ pass: false, failures: ['sh test.sh fails: add.sh subtracts'] });
  const first = await reviewPass(world({ reply }).deps({ key: broken }));
  assert.equal(first.fails, 1);

  // The builder's fix: the same counts, new content. It's reviewed again, for real.
  const trigger = { changed: true, label: 'review', checks: ['sh test.sh'], rec: first, fresh: false };
  assert.equal(needsReview({ ...trigger, key: fixed }), true);
  const w = world();
  const second = await reviewPass(w.deps({ prev: first, fails: 1, key: fixed }));
  assert.equal(w.calls, 1, 'the reviewer ran');
  assert.equal(second.state, 'passed');
  assert.notEqual(reviewedLabel('review', '', { changed: true, rec: second, key: fixed }).label, 'stuck');

  // A fix turn that changed nothing is still the second fail, with no call.
  assert.equal(needsReview({ ...trigger, key: broken }), true);
  const w2 = world();
  const again = await reviewPass(w2.deps({ prev: first, fails: 1, key: broken }));
  assert.equal(w2.calls, 0);
  assert.equal(again.fails, 2);
  assert.deepEqual(reviewedLabel('review', '', { changed: true, rec: again, key: broken }), { label: 'stuck', need: TWICE });
});

test('the queue reads a review as current from the polled counts, which carry no content', () => {
  const shape = git({ head: 'abc', unstaged: 1, insertions: 1, deletions: 1 });
  const rec = { state: 'passed', key: reviewKey(shape, 'content A'), failures: [], fails: 0, at: NOW };
  assert.equal(keysMatch(rec.key, reviewKey(shape)), true);
  assert.equal(keysMatch(rec.key, reviewKey(git({ head: 'abc', unstaged: 2 }))), false);
  assert.equal(keysMatch(rec.key, reviewKey(shape, 'content B')), false);
  assert.equal(reviewedLabel('review', '', { changed: true, rec, key: reviewKey(shape) }).label, 'checked');
  // A record saved before keys had content still matches by its shape.
  assert.equal(keysMatch('abc|0|1|0|0|1|1', reviewKey(shape, 'content A')), true);
});
