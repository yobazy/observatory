import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { chord, clip, changes, event } = await import('../src/nebula/uselog.ts');

const key = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

test('only chords and Esc reach the log, never typing', () => {
  assert.equal(chord(key('a')), null);
  assert.equal(chord(key('A', { shiftKey: true })), null);
  assert.equal(chord(key('Enter')), null);
  assert.equal(chord(key('Meta', { metaKey: true })), null);
  assert.equal(chord(key('n', { metaKey: true })), '⌘N');
  assert.equal(chord(key('N', { metaKey: true, shiftKey: true })), '⇧⌘N');
  assert.equal(chord(key('u', { metaKey: true, altKey: true })), '⌥⌘U');
  assert.equal(chord(key('c', { ctrlKey: true })), '⌃C');
  assert.equal(chord(key('Escape')), 'Esc');
});

test('labels are one line and clipped', () => {
  assert.equal(clip('  Start\n   task '), 'Start task');
  assert.equal(clip('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
});

test('an event leaves out empty fields', () => {
  const e = event('click', { label: 'Done', in: '', ms: 0, gone: undefined }, new Date(0));
  assert.deepEqual(e, { t: '1970-01-01T00:00:00.000Z', e: 'click', label: 'Done', ms: 0 });
});

const base = { view: 'sessions', selectedSession: null, agents: {}, preview: null, notice: null };

test('state changes become view, session, preview and notice lines', () => {
  const agents = { a1: { id: 'a1', kind: 'claude', status: 'waiting', unseen: true } };
  const next = { ...base, view: 'usage', agents, selectedSession: { Agent: 'a1' }, preview: { files: [], active: 0 }, notice: "Couldn't save" };
  const lines = changes(base, next, 4200).map(({ t, ...rest }) => rest);
  assert.deepEqual(lines, [
    { e: 'view', from: 'sessions', to: 'usage', ms: 4200 },
    { e: 'session', kind: 'agent', harness: 'claude', status: 'waiting', unseen: true },
    { e: 'preview.open' },
    { e: 'notice', text: "Couldn't save" },
  ]);
  assert.deepEqual(changes(next, next, 10), []);
  assert.deepEqual(changes(next, { ...next, selectedSession: null, preview: null }, 10).map((l) => l.e), ['preview.close']);
});
