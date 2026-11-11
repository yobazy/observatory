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

// Drawn by Claude Code 2.1.319, read through a terminal.
const previewFoot = ['', 'Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel'];
const previewed = (marks, topTabs = ['←  ☐ Layout  ☐ Food  ✔ Submit  →']) => [
  rule,
  ...topTabs,
  '',
  'Which layout do you want?',
  '',
  `${marks[0]} 1. Stacked                      ┌──────────────────────────────────────────┐`,
  `${marks[1]} 2. Grid                         │ [ a ]                                    │`,
  '                                  │ [ b ]                                    │',
  '                                  └──────────────────────────────────────────┘',
  '',
  '                                  Notes: press n to add notes',
  '',
  rule,
  `${marks[2]} Chat about this`,
  ...previewFoot,
];

test('choices with previews leave the box out, and a digit needs Enter after it', () => {
  const q = findQuestion(previewed(['❯', ' ', ' ']));
  assert.equal(q.prompt, 'Which layout do you want?');
  assert.deepEqual(q.detail, ['☐ Layout  ☐ Food  ✔ Submit']);
  assert.deepEqual(q.choices.map((c) => [c.label, c.selected, !!c.stays]), [
    ['Stacked', true, true],
    ['Grid', false, true],
    ['Chat about this', false, false],
  ]);
  assert.deepEqual(q.choices[1].keys, ['2', '\r']);
  // Chat has no number, so it's a step down from the last choice.
  assert.deepEqual(q.choices[2].keys, ['2', '\x1b[B', '\r']);
});

test('a lone question with previews ends with its pick, and the mark can sit on Chat', () => {
  const q = findQuestion(previewed([' ', '❯', '❯'], [' ☐ Layout']));
  assert.equal(q.detail, undefined);
  assert.deepEqual(q.choices.map((c) => !!c.stays), [false, false, false]);
  assert.deepEqual(q.choices.map((c) => c.selected), [false, false, true]);
});

test('from the chat row a preview choice steps up first, since a digit does nothing there', () => {
  const q = findQuestion(previewed([' ', '❯', '❯'], [' ☐ Layout']));
  assert.deepEqual(q.choices[0].keys, ['\x1b[A', '1', '\r']);
  assert.deepEqual(q.choices[1].keys, ['\x1b[A', '2', '\r']);
  assert.deepEqual(q.choices[2].keys, ['\r']);
});

test('a preview form with its notes line open is not read, or digits would land in the note', () => {
  const screen = previewed(['❯', ' ', ' ']).map((l) => (l.includes('Notes: press n') ? '                                  Notes: shorter please' : l));
  assert.equal(findQuestion(screen), null);
});

test('in a short terminal the notes row beside the last choice stays out of its label', () => {
  const q = findQuestion([
    rule,
    ' ☐ Layout',
    '',
    'Which layout do you want?',
    '',
    '❯ 1. A                           ┌──────────┐',
    '  2. B                           │ [ a ]    │',
    '  3. C                           └──────────┘',
    '  4. D                           Notes: press n to add notes',
    '',
    rule,
    '  Chat about this',
    ...previewFoot,
  ]);
  assert.deepEqual(q.choices.map((c) => c.label), ['A', 'B', 'C', 'D', 'Chat about this']);
});

test('a preview form that fails to read still counts as a picker', () => {
  const screen = ['  1. Stacked', '  7. Grid', '', '  Chat about this', ...previewFoot];
  assert.equal(findQuestion(screen), null);
  assert.ok(looksLikePicker(screen));
});

test('in a short terminal the tabs stand in for the rule that scrolled off', () => {
  const q = findQuestion([
    '←  ☐ Bus  ☐ Food  ✔ Submit  →',
    '',
    'Do you want the bus?',
    '',
    '❯ 1. No',
    '     Walk there.',
    '  2. Yes',
    '     Take the 5:30 shuttle.',
    '  3. Type something.',
    rule,
    '  4. Chat about this',
    ...footer,
  ]);
  assert.deepEqual(q.detail, ['☐ Bus  ☐ Food  ✔ Submit']);
  assert.deepEqual(q.choices.map((c) => !!c.stays), [true, true, true, false]);
});

test('with no tabs on screen, more steps may follow, so a pick stays', () => {
  const q = findQuestion([
    'Do you want the bus?',
    '',
    '❯ 1. No',
    '  2. Yes',
    '  3. Type something.',
    rule,
    '  4. Chat about this',
    ...footer,
  ]);
  assert.deepEqual(q.choices.map((c) => !!c.stays), [true, true, true, false]);
});

test('a permission prompt keeps an arrow at the end of its command', () => {
  const q = findQuestion([rule, ' Bash command', '', '   echo next →', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No']);
  assert.deepEqual(q.detail, ['Bash command', '', 'echo next →']);
});

// Claude Code asks this before it starts in a folder it hasn't seen, so a
// new project's lead waits on it with nothing in its thread yet.
const trust = [
  '────────────────────────────────────────────────────────────────────────────────',
  ' Accessing workspace:',
  '',
  ' /Users/me/Programming/pixel-pets',
  '',
  " Quick safety check: Is this a project you created or one you trust? (Like your",
  ' own code, a well-known open source project, or work from your team). If not,',
  " take a moment to review what's in this folder first.",
  '',
  " Claude Code'll be able to read, edit, and execute files here.",
  '',
  ' Security guide',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
];

test('the folder trust prompt reads as a question, its choices picked by arrow keys', () => {
  const q = findQuestion(trust);
  assert.match(q.prompt, /^Quick safety check: Is this a project you created or one you trust\?/);
  assert.deepEqual(q.choices.map((c) => c.label), ['No, exit', 'Yes, I trust this folder']);
  assert.deepEqual(q.choices.map((c) => c.selected), [true, false]);
  assert.deepEqual(q.choices.map((c) => c.keys), [['\r'], ['\x1b[B', '\r']]);
});

test('with the mark on the lower row, the upper one is reached by up arrow', () => {
  const q = findQuestion([...trust.slice(0, 13), '   No, exit', ' ❯ Yes, I trust this folder', '', trust.at(-1)]);
  assert.deepEqual(q.choices.map((c) => c.keys), [['\x1b[A', '\r'], ['\r']]);
});

test("Claude Code's input line is no question, with or without a footer", () => {
  assert.equal(findQuestion(['Done.', '', '❯ ', '', '  ? for shortcuts']), null);
  assert.equal(findQuestion(['Done.', '', '❯ fix it', '', ' Enter to confirm']), null);
});
