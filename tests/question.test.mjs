import test from 'node:test';
import assert from 'node:assert/strict';
import { findQuestion, looksLikePicker } from '../src/nebula/question.ts';

const claudeEdit = [
  '⏺ Update(src/cart/sync.ts)',
  '╭──────────────────────────────────────────────╮',
  '│ Do you want to make this edit to sync.ts?    │',
  '│ ❯ 1. Yes                                     │',
  "│   2. Yes, and don't ask again this session   │",
  '│   3. No, and tell Claude what to do          │',
  '│      differently (esc)                       │',
  '╰──────────────────────────────────────────────╯',
];

test('a Claude Code permission prompt reads as its question and choices', () => {
  const q = findQuestion(claudeEdit);
  assert.equal(q.prompt, 'Do you want to make this edit to sync.ts?');
  assert.deepEqual(q.choices.map((c) => [c.key, c.label, c.selected]), [
    ['1', 'Yes', true],
    ['2', "Yes, and don't ask again this session", false],
    ['3', 'No, and tell Claude what to do differently (esc)', false],
  ]);
});

test('a hint line under the choices is fine', () => {
  const q = findQuestion(['Allow this command?', '› 1. Yes', '  2. No', '', 'Esc to cancel']);
  assert.equal(q.prompt, 'Allow this command?');
  assert.equal(q.choices.length, 2);
});

test('a numbered list in a reply is not a question', () => {
  const screen = ['Plan:', '1. Read the code', '2. Fix it', '', '> '];
  assert.equal(findQuestion(screen), null);
  assert.equal(looksLikePicker(screen), true, 'but it is enough to send you to the terminal');
});

test('choices that skip a number, or start past 1, are not a question', () => {
  assert.equal(findQuestion(['Pick', '❯ 1. A', '  3. C']), null);
  assert.equal(findQuestion(['Pick', '❯ 2. B', '  3. C']), null);
});
