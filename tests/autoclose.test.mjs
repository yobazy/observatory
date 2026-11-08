import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, closable, CLOSE_AFTER_MS, readingAllows } from '../src/nebula/autoclose.ts';

const now = 10_000_000_000;
const day = CLOSE_AFTER_MS;
// The reply landed as the thread finished, in Unix seconds like the log.
const replied = Math.floor((now - day) / 1000);
const agent = (id, over = {}) => ({
  id, worktree_id: 'w1', name: id, status: 'finished', archived: false, kind: 'claude', session_id: `s-${id}`,
  status_changed_at: now - day, recent_prompts: [{ text: 'go', submitted_at: (replied - 60) * 1000 }], ...over,
});
const state = (agents, over = {}) => ({
  loaded: true,
  agents: Object.fromEntries(agents.map((a) => [a.id, a])),
  selectedSession: null,
  queue: {},
  prefs: {},
  ...over,
});
const safe = { tone: 'done', last: replied };
const all = (r) => () => r;

test('a thread that said ✅ Safe to close and sat finished a day is closed', () => {
  assert.deepEqual(closable(state([agent('a')]), now, all(safe)), ['a']);
});

test('one finished for less than a day stays', () => {
  const a = agent('a', { status_changed_at: now - day + 1 });
  assert.deepEqual(closable(state([a]), now, all(safe)), []);
});

test('🟠 Keep open, 🔴 Don\'t close, no verdict, or an unread log keep it', () => {
  const s = state([agent('a')]);
  for (const r of [{ tone: 'wait', last: replied }, { tone: 'bad', last: replied }, { tone: null, last: replied }, null, undefined]) {
    assert.deepEqual(closable(s, now, all(r)), [], JSON.stringify(r));
  }
});

test('a prompt sent after the reply keeps it; the turn\'s own prompt in that second does not', () => {
  const later = agent('a', { recent_prompts: [{ text: 'and also', submitted_at: (replied + 5) * 1000 }] });
  assert.equal(readingAllows(later, safe), false);
  const same = agent('a', { recent_prompts: [{ text: 'go', submitted_at: replied * 1000 + 400 }] });
  assert.equal(readingAllows(same, safe), true);
});

test('running, waiting, fresh, or already archived threads stay', () => {
  for (const over of [{ status: 'running' }, { status: 'waiting' }, { status: 'fresh' }, { archived: true }]) {
    assert.deepEqual(closable(state([agent('a', over)]), now, all(safe)), [], JSON.stringify(over));
  }
});

test('a pinned thread stays', () => {
  const s = state([agent('a'), agent('b')], { prefs: { pinnedTasks: { w1: ['a'] } } });
  assert.deepEqual(closable(s, now, all(safe)), ['b']);
});

test('the thread you have open stays', () => {
  const s = state([agent('a'), agent('b')], { selectedSession: { Agent: 'a' } });
  assert.deepEqual(closable(s, now, all(safe)), ['b']);
});

test('a follow-up flag you set keeps it; one the app set does not', () => {
  const mine = state([agent('a')], { prefs: { followUps: { a: 1 } } });
  assert.deepEqual(closable(mine, now, all(safe)), []);
  const auto = state([agent('a')], { prefs: { followUps: { a: 1 }, autoFollowUps: { a: true } } });
  assert.deepEqual(closable(auto, now, all(safe)), ['a']);
});

test('a queued prompt or an unsent draft keeps it', () => {
  const queued = state([agent('a')], { queue: { a: [{ id: 'q', text: 'then push', at: now }] } });
  assert.deepEqual(closable(queued, now, all(safe)), []);
  assert.deepEqual(closable(state([agent('a')]), now, all(safe), day, (id) => id === 'a'), []);
});

test('only threads whose log the app reads, with a session', () => {
  for (const over of [{ kind: 'shell' }, { kind: 'custom' }, { session_id: null }]) {
    assert.deepEqual(closable(state([agent('a', over)]), now, all(safe)), [], JSON.stringify(over));
  }
  assert.deepEqual(closable(state([agent('a', { kind: 'codex' })]), now, all(safe)), ['a']);
});

test('switched off, or before the daemon has loaded, nothing is closed or read', () => {
  assert.deepEqual(candidates(state([agent('a')], { prefs: { autoCloseSafe: false } }), now), []);
  assert.deepEqual(candidates(state([agent('a')], { loaded: false }), now), []);
  assert.equal(candidates(state([agent('a')], { prefs: { autoCloseSafe: true } }), now).length, 1);
});

test('a shorter wait can be given', () => {
  const a = agent('a', { status_changed_at: now - 60_000 });
  assert.deepEqual(closable(state([a]), now, all(safe), 60_000), ['a']);
});
