import test from 'node:test';
import assert from 'node:assert/strict';
import { liveThreads } from '../src/nebula/live.ts';

const agent = (id, status, at, extra = {}) => ({ id, status, status_changed_at: at, archived: false, unseen: false, ...extra });

test('shows what needs you, then what works, then unread finished turns, newest first', () => {
  const got = liveThreads([
    agent('run-old', 'running', 1),
    agent('done-unread', 'finished', 9, { unseen: true }),
    agent('wait', 'needs_feedback', 2),
    agent('run-new', 'running', 5),
  ]).map((a) => a.id);
  assert.deepEqual(got, ['wait', 'run-new', 'run-old', 'done-unread']);
});

test('leaves out read turns, fresh and stopped threads, and archived ones', () => {
  const got = liveThreads([
    agent('done-read', 'finished', 3),
    agent('fresh', 'fresh', 3),
    agent('gone', 'terminated', 3),
    agent('archived', 'running', 3, { archived: true }),
  ]);
  assert.deepEqual(got, []);
});
