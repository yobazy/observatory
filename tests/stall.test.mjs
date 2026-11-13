import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIET_MS, screenIdle, stalled } from '../src/nebula/stall.ts';

const idlePrompt = [
  '⏺ Adding the mascot.',
  '  ⎿  API Error: Request timed out.',
  '',
  '────────────────────────────────',
  '> ',
  '────────────────────────────────',
  '  ? for shortcuts',
];

test('an input box with no spinner is idle', () => {
  assert.equal(screenIdle(idlePrompt), true);
});

test('a spinner, with or without its hint, is busy', () => {
  assert.equal(screenIdle([...idlePrompt.slice(0, 2), '✻ Thinking… (12s · ↓ 300 tokens · esc to interrupt)', ...idlePrompt.slice(3)]), false);
  assert.equal(screenIdle([...idlePrompt.slice(0, 2), '✶ Pondering… (3s)', ...idlePrompt.slice(3)]), false);
});

test('a menu waiting on you is not idle', () => {
  assert.equal(
    screenIdle([' Bash command', '', '   rm -rf build', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently']),
    false,
  );
});

const t0 = 1_000_000;
const running = { status: 'running', status_changed_at: t0 };
const later = t0 + QUIET_MS + 1;

test('quiet at its prompt with the turn never ended in the log is stalled', () => {
  assert.equal(stalled(running, t0, { turnEndedAt: null }, later), true);
  // The turn before it ended long ago: still this turn never did.
  assert.equal(stalled(running, t0, { turnEndedAt: t0 - 5_000 }, later), true);
});

test('not yet quiet long enough, or busy, is not', () => {
  assert.equal(stalled(running, later - 1_000, { turnEndedAt: null }, later), false);
  assert.equal(stalled(running, null, { turnEndedAt: null }, later), false);
  assert.equal(stalled({ status: 'running', status_changed_at: later - 1_000 }, t0, { turnEndedAt: null }, later), false);
});

test('a turn that ended with subagents still out stays running', () => {
  assert.equal(stalled(running, t0, { turnEndedAt: t0 + 2_000 }, later), false);
});

test('no log to read, or not running, is left alone', () => {
  assert.equal(stalled(running, t0, null, later), false);
  assert.equal(stalled({ status: 'needs_feedback', status_changed_at: t0 }, t0, { turnEndedAt: null }, later), false);
});
