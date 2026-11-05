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

test("a Bash prompt carries the command it's asking about", () => {
  const q = findQuestion([
    '⏺ Checking whether each branch adds anything:',
    '',
    '────────────────────────────────────────────────',
    ' Bash command',
    '',
    '   git merge-tree --write-tree origin/main thread-tags',
    '',
    '   Check what the branch would add',
    '',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. No, and tell Claude what to do differently (esc)',
    '',
    ' Esc to cancel · Tab to amend',
  ]);
  assert.equal(q.prompt, 'Do you want to proceed?');
  assert.deepEqual(q.detail, [
    'Bash command',
    '',
    'git merge-tree --write-tree origin/main thread-tags',
    '',
    'Check what the branch would add',
  ]);
  assert.equal(findQuestion(claudeEdit).detail, undefined);
});

test('a hint line under the choices is fine', () => {
  const q = findQuestion(['Allow this command?', '› 1. Yes', '  2. No', '', 'Esc to cancel']);
  assert.equal(q.prompt, 'Allow this command?');
  assert.equal(q.choices.length, 2);
});

test('a prompt partway down a tall pane, over blank rows, is still read', () => {
  const blank = Array(12).fill('');
  const q = findQuestion([...claudeEdit, ...blank]);
  assert.equal(q.prompt, 'Do you want to make this edit to sync.ts?');
  assert.equal(q.choices.length, 3);
  assert.equal(looksLikePicker(['Run it on project x?', '❯ Accept    Decline', ...blank]), true);
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

test('choices on one row read as a question, picked by arrow keys and Enter', () => {
  const screen = [
    '────────────────────────────────────────────────',
    '  MCP server “claude.ai Supabase” requests your input',
    '',
    '  This SQL includes destructive operations (DROP, DELETE, TRUNCATE or UPDATE without WHERE).',
    '  It may permanently remove data, tables, schemas or other objects.',
    '  Run it on project qdczbudnpdvuxpjmhpnk?',
    '',
    '  ❯ Accept    Decline',
    '',
    '  Esc to cancel · ↑/↓ to navigate',
  ];
  const q = findQuestion(screen);
  assert.equal(
    q.prompt,
    'This SQL includes destructive operations (DROP, DELETE, TRUNCATE or UPDATE without WHERE). It may permanently remove data, tables, schemas or other objects. Run it on project qdczbudnpdvuxpjmhpnk?',
  );
  assert.deepEqual(q.detail, ['MCP server “claude.ai Supabase” requests your input']);
  assert.deepEqual(q.choices.map((c) => [c.label, c.selected, c.keys]), [
    ['Accept', true, ['\r']],
    ['Decline', false, ['\x1b[C', '\r']],
  ]);
  const back = findQuestion(['Run it?', '  Accept    ❯ Decline']);
  assert.deepEqual(back.choices.map((c) => c.keys), [['\x1b[D', '\r'], ['\r']]);
  assert.equal(looksLikePicker(screen), true, 'and a typed reply is still never sent into it');
});

test('a row with no choice marked yet is not read', () => {
  assert.equal(findQuestion(['Run it?', '   Accept     Decline   (press an arrow key to choose)']), null);
});

test("the ordinary input line is not a menu", () => {
  assert.equal(looksLikePicker(['⏺ Done.', '', '❯ ', '  ? for shortcuts']), false);
  assert.equal(looksLikePicker(['❯ fix the build please']), false);
});

// Drawn by Claude Code 2.1.318, read through a terminal.
const rule = '─'.repeat(90);
const tabs = (...rows) => [rule, ...rows];
const footer = ['', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'];

test("an agent's question reads past the rule above Chat about this, with a note under each choice", () => {
  const q = findQuestion([
    '⏺ Calling Flowsavvy 4 times…',
    ...tabs(
      '←  ☐ Sangeet bus  ☐ Wedding bus  ☐ Old block  ✔ Submit  →',
      '',
      "│ Devon and Ishita's RSVP form requires shuttle answers before it can be submitted. Both",
      '│ shuttles leave from the Sheraton Parkway hotel. Do you want the Sangeet shuttle?',
      '',
      '❯ 1. No, thank you',
      '     You get to the Sangeet yourself. This is what is selected in the',
      '     unsubmitted form.',
      '  2. Yes, please',
      '     Take the 5:30 PM shuttle from the Sheraton Parkway.',
      '  3. Type something.',
      rule,
      '  4. Chat about this',
      ...footer,
    ),
  ]);
  assert.match(q.prompt, /^Devon and Ishita's RSVP .* Sangeet shuttle\?$/);
  assert.deepEqual(q.detail, ['☐ Sangeet bus  ☐ Wedding bus  ☐ Old block  ✔ Submit']);
  assert.deepEqual(q.choices.map((c) => [c.key, c.label]), [
    ['1', 'No, thank you'],
    ['2', 'Yes, please'],
    ['3', 'Type something.'],
    ['4', 'Chat about this'],
  ]);
  assert.equal(q.choices[0].note, 'You get to the Sangeet yourself. This is what is selected in the unsubmitted form.');
  assert.ok(q.choices[0].selected);
  // More questions follow, so the session is still waiting after a pick;
  // only leaving for a chat ends it.
  assert.deepEqual(q.choices.map((c) => !!c.stays), [true, true, true, false]);
  assert.deepEqual(q.choices.map((c) => !!c.typed), [false, false, true, false]);
});

test('a single question ends with its pick, and its lone tab is left out', () => {
  const q = findQuestion(tabs(
    ' ☐ Bus',
    '',
    'Do you want the bus option?',
    '',
    '❯ 1. No',
    '     Do not use the bus.',
    '  2. Yes',
    '     Use the bus.',
    '  3. Type something.',
    rule,
    '  4. Chat about this',
    ...footer,
  ));
  assert.equal(q.detail, undefined);
  assert.deepEqual(q.choices.map((c) => !!c.stays), [false, false, true, false]);
});

test('boxes keep the session waiting, and Tab goes on to the next step', () => {
  const q = findQuestion(tabs(
    '←  ☒ Bus  ☒ Food  ☐ Old block  ✔ Submit  →',
    '',
    'Which foods do you like?',
    '',
    '❯ 1. [✔] Fish',
    '         Fish as a main dish.',
    '  2. [ ] Lamb',
    '         Lamb as a main dish.',
    '  3. [ ] Type something',
    '     Next',
    rule,
    '  4. Chat about this',
    ...footer,
  ));
  assert.deepEqual(q.choices.map((c) => [c.label, c.checked, !!c.stays]), [
    ['Fish', true, true],
    ['Lamb', false, true],
    ['Type something', false, true],
    ['Next', undefined, true],
    ['Chat about this', undefined, false],
  ]);
  assert.equal(q.choices[0].note, 'Fish as a main dish.');
  assert.deepEqual(q.choices[3].keys, ['\t']);
});

test('the review step shows your answers, and its Submit ends the prompt', () => {
  const q = findQuestion(tabs(
    '←  ☒ Bus  ☒ Food  ✔ Submit  →',
    '',
    'Review your answers',
    '',
    ' ● Do you take the bus?',
    '   → Yes',
    '',
    'Ready to submit your answers?',
    '',
    '❯ 1. Submit answers',
    '  2. Cancel',
  ));
  assert.equal(q.prompt, 'Ready to submit your answers?');
  assert.deepEqual(q.detail.slice(0, 2), ['☒ Bus  ☒ Food  ✔ Submit', '']);
  assert.ok(!q.choices[0].stays);
});

test('with the mark on your own answer, digits would type there, so choices are not offered', () => {
  const q = findQuestion(tabs(
    ' ☐ Bus',
    '',
    'Do you want the bus option?',
    '',
    '  1. No',
    '     Do not use the bus.',
    '  2. Yes',
    '     Use the bus.',
    '❯ 3. walk',
    rule,
    '  4. Chat about this',
    ...footer,
  ));
  assert.equal(q, null);
});
