import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { within, RECENT_MS } = await import('../src/nebula/uselog.ts');
const mod = await import('../src/nebula/moments.ts');
const { snapshot, isMarkKey } = mod;

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
    pane: 'terminal',
    preview: ['mock.html'],
    notice: null,
    agents: { waiting: 1, running: 1 },
    mode: 'dark',
  });
});

test('a task started from a moment points the agent at it', () => {
  const { momentPrompt } = mod;
  const p = momentPrompt('/m/2026-10-22T19-52-43-529Z', '  copying from the reader is hard ');
  assert.ok(p.startsWith('copying from the reader is hard\n\n'));
  assert.ok(p.includes('/m/2026-10-22T19-52-43-529Z'));
  assert.ok(p.includes('screenshot.png'));
  assert.ok(momentPrompt('/m/x', '').startsWith('Look into what I marked'));
});

test('a moment task works in its own worktree and ends in a PR a second agent reviews', () => {
  const p = mod.momentPrompt('/m/x', 'fix it');
  assert.ok(p.indexOf('nebula worktree') < p.indexOf('open a PR'));
  assert.ok(p.includes('nebula spawn "Review PR'));
  assert.ok(p.includes('gh pr merge'));
});

test('a moment task sees the app itself: replay before the fix, screenshots after, on the PC when it answers', () => {
  const p = mod.momentPrompt('/m/moments/2026-10-29T10-00-00-000Z', 'fix it');
  assert.ok(p.includes('scripts/drive replay /m/moments/2026-10-29T10-00-00-000Z'));
  assert.ok(p.includes('scripts/pc up'));
  assert.ok(p.indexOf('scripts/drive replay') < p.indexOf('open a PR'));
});

test('moments started at once get their own worktrees', () => {
  const { momentBranch, momentPrompt } = mod;
  const a = momentBranch('/m/moments/2026-10-22T19-52-43-529Z');
  const b = momentBranch('/m/moments/2026-10-22T19-52-44-001Z/');
  assert.equal(a, 'moment-2026-10-22t19-52-43-529z');
  assert.notEqual(a, b);
  assert.ok(momentPrompt('/m/moments/2026-10-22T19-52-43-529Z', '').includes(`nebula worktree ${a} `));
  assert.ok(momentPrompt('/m/x', '').includes('gh pr list'));
});

test('a moment task goes to the last project picked, else the one you are in', () => {
  const { momentProject } = mod;
  const s = { projects: { p1: {}, p2: {} }, selectedProject: 'p1' };
  assert.equal(momentProject(s), 'p1');
  globalThis.localStorage.getItem = () => 'p2';
  assert.equal(momentProject(s), 'p2');
  globalThis.localStorage.getItem = () => 'gone';
  assert.equal(momentProject(s), 'p1');
  assert.equal(momentProject({ projects: {}, selectedProject: null }), null);
  globalThis.localStorage.getItem = () => null;
});
