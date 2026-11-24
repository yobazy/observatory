import test from 'node:test';
import assert from 'node:assert/strict';
import { addToDraft, draftFor, fileTarget, keepDraft, onDraftAdded, picturesIn, withPath, withoutToken } from '../src/nebula/drafts.ts';

test('a path goes at the end of what you wrote, once', () => {
  assert.equal(withPath('', '/r/a.html'), '/r/a.html');
  assert.equal(withPath('  ', '/r/a.html'), '/r/a.html');
  assert.equal(withPath('look at', '/r/a.html'), 'look at /r/a.html');
  assert.equal(withPath('look at\n', '/r/a.html'), 'look at\n/r/a.html');
  assert.equal(withPath('look at /r/a.html', '/r/a.html'), 'look at /r/a.html');
  assert.equal(withPath("look at '/r/a b.html' now", "'/r/a b.html'"), "look at '/r/a b.html' now");
  // Only the whole path counts as there already, not a longer one it starts.
  assert.equal(withPath('compare /r/a.html.bak with', '/r/a.html'), 'compare /r/a.html.bak with /r/a.html');
});

test('a file goes where the agent reads next', () => {
  const on = { reading: false, queued: 0, alive: true, waiting: false, canRead: true };
  assert.equal(fileTarget({ ...on, reading: true, queued: 2 }), 'draft');
  assert.equal(fileTarget({ ...on, queued: 1 }), 'queue');
  assert.equal(fileTarget(on), 'terminal');
  // Asleep: into the reply box rather than waking it.
  assert.equal(fileTarget({ ...on, alive: false }), 'draft');
  // Waiting on a menu: a paste could answer it, so not the terminal.
  assert.equal(fileTarget({ ...on, waiting: true }), 'draft');
  assert.equal(fileTarget({ ...on, waiting: true, queued: 1 }), 'queue');
});

test('a file for a reply box that a thread without a log lacks goes nowhere', () => {
  const on = { reading: false, queued: 0, alive: true, waiting: false, canRead: false };
  // Awake and free: its terminal, as a dropped file.
  assert.equal(fileTarget(on), 'terminal');
  // Asleep: not its terminal, which would wake it; refused instead.
  assert.equal(fileTarget({ ...on, alive: false }), 'nowhere');
  // Waiting on you: refused too, so a paste can't answer its menu.
  assert.equal(fileTarget({ ...on, waiting: true }), 'nowhere');
  assert.equal(fileTarget({ ...on, alive: false, waiting: true }), 'nowhere');
  // A queued prompt still takes it.
  assert.equal(fileTarget({ ...on, alive: false, queued: 1 }), 'queue');
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

test('the pictures a reply names, quoted for a shell or bare, each once', () => {
  const text = "look '/a/Screenshot 2026-11-24 at 3.16.40 PM.png' and /b/c.JPG /b/c.JPG, /x/notes.md '/d/it'\\''s.png'";
  assert.deepEqual(picturesIn(text), [
    { path: '/a/Screenshot 2026-11-24 at 3.16.40 PM.png', token: "'/a/Screenshot 2026-11-24 at 3.16.40 PM.png'" },
    { path: '/b/c.JPG', token: '/b/c.JPG' },
    { path: "/d/it's.png", token: "'/d/it'\\''s.png'" },
  ]);
  // Not a path of its own: inside a word, or relative.
  assert.deepEqual(picturesIn('src/a.png and x/b/c.png'), []);
});

test('taking a picture out of a reply leaves the rest as it was', () => {
  assert.equal(withoutToken("look '/a/S 1.png' and more", "'/a/S 1.png'"), 'look and more');
  assert.equal(withoutToken("'/a/S 1.png'", "'/a/S 1.png'"), '');
  assert.equal(withoutToken('/a/b.png\nwhy', '/a/b.png'), '\nwhy');
  assert.equal(withoutToken('see /a/b.png', '/a/b.png'), 'see');
  assert.equal(withoutToken('/a/b.png then', '/a/b.png'), 'then');
  // Spacing elsewhere in the reply stays as you typed it.
  assert.equal(withoutToken('see /a/b.png\n  - one  two', '/a/b.png'), 'see\n  - one  two');
});
