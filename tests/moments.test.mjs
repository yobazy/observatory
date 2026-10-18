import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { within, RECENT_MS } = await import('../src/nebula/uselog.ts');
const { snapshot, isMarkKey } = await import('../src/nebula/moments.ts');

test('a moment keeps only the last minute of events', () => {
  const now = Date.parse('2026-10-18T14:02:11Z');
  const at = (ms, e) => ({ t: new Date(now - ms).toISOString(), e });
  const events = [at(RECENT_MS + 1, 'old'), at(RECENT_MS, 'edge'), at(5000, 'click'), at(0, 'key')];
  assert.deepEqual(within(events, now).map((e) => e.e), ['edge', 'click', 'key']);
});

test('only ⇧⌘M marks a moment', () => {
  const k = (over) => ({ code: 'KeyM', metaKey: true, shiftKey: true, altKey: false, ctrlKey: false, ...over });
  assert.equal(isMarkKey(k()), true);
  assert.equal(isMarkKey(k({ shiftKey: false })), false);
  assert.equal(isMarkKey(k({ altKey: true })), false);
  assert.equal(isMarkKey(k({ code: 'KeyN' })), false);
});

test('the snapshot names what was on screen', () => {
  const s = {
    view: 'sessions',
    link: { state: 'disconnected', reason: 'No nebula daemon is listening.' },
    loaded: true,
    projects: { p1: { id: 'p1', name: 'demo-api' } },
    worktrees: { w1: { id: 'w1', project_id: 'p1', branch: 'fix-login' } },
    agents: {
      a1: { id: 'a1', worktree_id: 'w1', name: 'Fix login', kind: 'claude', status: 'waiting', archived: false },
      a2: { id: 'a2', worktree_id: 'w1', name: 'Old', kind: 'claude', status: 'finished', archived: true },
      a3: { id: 'a3', worktree_id: 'w1', name: 'Docs', kind: 'codex', status: 'running', archived: false },
    },
    terminals: {},
    selectedProject: 'p1',
    selectedSession: { Agent: 'a1' },
    preview: { files: [{ path: '/Users/me/demo-api/mock.html' }], active: 0 },
    notice: null,
    mode: 'dark',
  };
  assert.deepEqual(snapshot(s), {
    view: 'sessions',
    link: { state: 'disconnected', reason: 'No nebula daemon is listening.' },
    loaded: true,
    project: 'demo-api',
    session: { kind: 'agent', id: 'a1', name: 'Fix login', harness: 'claude', status: 'waiting', branch: 'fix-login' },
    preview: ['mock.html'],
    notice: null,
    agents: { waiting: 1, running: 1 },
    mode: 'dark',
  });
});
