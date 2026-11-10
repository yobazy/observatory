import test from 'node:test';
import assert from 'node:assert/strict';
import { matches, searchWords } from '../src/nebula/settingsSearch.ts';

test('a blank query searches nothing', () => {
  assert.deepEqual(searchWords('   '), []);
  assert.deepEqual(searchWords(' Dispatch  Router '), ['dispatch', 'router']);
});

test('every word has to start a word, in any case and order', () => {
  const row = 'General Dispatch Router The agent CLI that turns a pasted list into a plan';
  assert.ok(matches(row, searchWords('router dispatch')));
  assert.ok(matches(row, searchWords('PAST')));
  assert.ok(!matches(row, searchWords('router budget')));
  assert.ok(matches('Thread tagging', searchWords('tag')));
  assert.ok(!matches('Check before done in its stage', searchWords('tag')));
});

test('key names before a key are one shortcut', () => {
  assert.deepEqual(searchWords('cmd k'), ['⌘k']);
  assert.deepEqual(searchWords('cmd shift m'), ['⇧⌘m']);
  assert.ok(matches('⌘K Command palette', searchWords('cmd k')));
  assert.ok(!matches('⌘J Next in the triage queue, or the next session', searchWords('cmd k')));
  assert.ok(matches('⇧⌘M Mark this moment', searchWords('shift cmd m')));
  assert.ok(matches('⌥⌘B Hide or show the tasks column', searchWords('alt cmd b')));
});

test('a key name alone finds the word or its symbol', () => {
  assert.deepEqual(searchWords('command palette'), ['command', 'palette']);
  assert.ok(matches('Router command The agent CLI', searchWords('command')));
  assert.ok(matches('⌘U Agent usage', searchWords('cmd')));
  assert.ok(matches('⇧↵ Newline in a Claude Code prompt', searchWords('enter')));
});
