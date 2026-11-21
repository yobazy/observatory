import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_IN_EVERY_MS, MAX_CHECK_INS, STALE_MS, nextCheckIn, prune, saysRunning, untilText, watching } from '../src/nebula/checkin.ts';

const running = { tone: 'wait', text: 'Keep open: round 3 is running on `pc`.' };
const waiting = { tone: 'wait', text: 'Keep open: waiting on your answer to 2.' };
const done = { tone: 'done', text: 'Safe to close' };
const now = 10_000_000_000;
const replied = Math.floor((now - 10 * 60_000) / 1000); // 10 minutes ago, Unix seconds

test('a waiting verdict that says something is running is watched on its own', () => {
  assert.equal(saysRunning(running), true);
  assert.equal(watching(running, undefined), true);
  assert.equal(watching({ tone: 'wait', text: 'Keep open: the batch is in progress' }, undefined), true);
  assert.equal(watching(waiting, undefined), false);
  assert.equal(watching(done, undefined), false);
  assert.equal(watching({ tone: 'bad', text: "Don't close: tests running red" }, undefined), false);
});

test('turning it off or on wins over the wording, but only while the thread waits', () => {
  assert.equal(watching(running, { on: false }), false);
  assert.equal(watching(waiting, { on: true }), true);
  assert.equal(watching(done, { on: true }), false);
});

test('the next check-in is half an hour after the reply or the last one sent', () => {
  assert.equal(nextCheckIn(running, undefined, replied, now), replied * 1000 + CHECK_IN_EVERY_MS);
  const sent = now - 5 * 60_000;
  assert.equal(nextCheckIn(running, { sent, count: 1 }, replied, now), sent + CHECK_IN_EVERY_MS);
  assert.equal(nextCheckIn(waiting, undefined, replied, now), null);
  assert.equal(nextCheckIn(running, undefined, null, now), null);
});

test('it stops after the cap, and leaves old threads alone unless turned on', () => {
  assert.equal(nextCheckIn(running, { count: MAX_CHECK_INS }, replied, now), null);
  const old = Math.floor((now - STALE_MS - 60_000) / 1000);
  assert.equal(nextCheckIn(running, undefined, old, now), null);
  assert.notEqual(nextCheckIn(running, { on: true }, old, now), null);
});

test('untilText reads as minutes, then hours', () => {
  assert.equal(untilText(now + 12 * 60_000, now), '12m');
  assert.equal(untilText(now + 65 * 60_000, now), '1h 5m');
  assert.equal(untilText(now + 120 * 60_000, now), '2h');
  assert.equal(untilText(now - 1, now), '1m');
});

test('prune drops threads the daemon no longer has', () => {
  assert.deepEqual(prune({ a: { on: true }, b: { count: 2 } }, (id) => id === 'a'), { a: { on: true } });
});
