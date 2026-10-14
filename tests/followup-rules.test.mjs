import test from 'node:test';
import assert from 'node:assert/strict';
import { afterStatus, settled } from '../src/nebula/followupRules.ts';

const task = (status, extra = {}) => ({ id: 'a1', status, archived: false, ...extra });

test('a turn that ends while you are away flags the task, marked as the app’s', () => {
  const next = afterStatus({}, task('finished'), 'running', false, 1000);
  assert.deepEqual(next.followUps, { a1: 1000 });
  assert.deepEqual(next.autoFollowUps, { a1: true });
});

test('no flag when you were watching, when it was already flagged, or for other moves', () => {
  assert.equal(afterStatus({}, task('finished'), 'running', true, 1), null, 'watching');
  assert.equal(afterStatus({ followUps: { a1: 5 } }, task('finished'), 'running', false, 1), null, 'already flagged');
  assert.equal(afterStatus({}, task('finished'), 'fresh', false, 1), null, 'not the end of a turn');
  assert.equal(afterStatus({}, task('needs_feedback'), 'running', false, 1), null, 'waiting has its own list');
  assert.equal(afterStatus({}, task('finished', { archived: true }), 'running', false, 1), null, 'archived');
});

test('opening the task leaves the flag; acting on it clears the app’s flag', () => {
  const prefs = { followUps: { a1: 1000 }, autoFollowUps: { a1: true } };
  assert.equal(settled(prefs, { a1: task('finished') }), null, 'only seen');
  for (const [why, tasks] of [
    ['replied, so it runs again', { a1: task('running') }],
    ['archived', { a1: task('finished', { archived: true }) }],
    ['deleted', {}],
  ]) {
    const next = settled(prefs, tasks);
    assert.deepEqual(next.followUps, {}, why);
    assert.deepEqual(next.autoFollowUps, {}, why);
  }
});

test('flags you set yourself never clear on their own', () => {
  const prefs = { followUps: { a1: 1000, b2: 2000 }, autoFollowUps: { a1: true } };
  const next = settled(prefs, { a1: task('running'), b2: { id: 'b2', status: 'running', archived: false } });
  assert.deepEqual(next.followUps, { b2: 2000 });
});
