import test from 'node:test';
import assert from 'node:assert/strict';
import { addToDraft, draftFor, fileTarget, keepDraft, onDraftAdded, withPath } from '../src/nebula/drafts.ts';

test('a path goes at the end of what you wrote, once', () => {
  assert.equal(withPath('', '/r/a.html'), '/r/a.html');
  assert.equal(withPath('  ', '/r/a.html'), '/r/a.html');
  assert.equal(withPath('look at', '/r/a.html'), 'look at /r/a.html');
  assert.equal(withPath('look at\n', '/r/a.html'), 'look at\n/r/a.html');
  assert.equal(withPath('look at /r/a.html', '/r/a.html'), 'look at /r/a.html');
});

test('a file goes where the agent reads next', () => {
  assert.equal(fileTarget({ reading: true, queued: 2, alive: true }), 'draft');
  assert.equal(fileTarget({ reading: false, queued: 1, alive: true }), 'queue');
  assert.equal(fileTarget({ reading: false, queued: 0, alive: true }), 'terminal');
  // Asleep: into the reply box rather than waking it.
  assert.equal(fileTarget({ reading: false, queued: 0, alive: false }), 'draft');
});

test('a file added from outside the box lands in the draft and says so', () => {
  const heard = [];
  const off = onDraftAdded((id) => heard.push(id));
  keepDraft('a1', 'compare it with');
  addToDraft('a1', '/r/b.png');
  assert.equal(draftFor('a1'), 'compare it with /r/b.png');
  assert.deepEqual(heard, ['a1']);
  off();
  addToDraft('a1', '/r/c.png');
  assert.deepEqual(heard, ['a1']);
  keepDraft('a1', '');
  assert.equal(draftFor('a1'), '');
});
