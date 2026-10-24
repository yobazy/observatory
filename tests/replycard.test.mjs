import test from 'node:test';
import assert from 'node:assert/strict';
import { answerText, isCard, pointerText, readAsk, readCard, readChips, replyQuote } from '../src/nebula/replycard.ts';

const reply = `**Yes. The Read view already exists, so cards are a small step.**

✅ Read view exists · 🟠 nothing renders a card yet · ⚪ Codex only for now

Screenshot: \`/tmp/shots/reader-after.png\`

**What it would take:** teach the Reader the pattern.

**Needs you**
1. Where should the card show?  A above the terminal · B inside Read only · C both
2. Should decision buttons send right away?  A send on tap · B fill the reply box

I'd pick **1A, 2B**.

**Details**
- The data side is done.
- \`transcript.ts\` already has it.`;

test('a card reply reads as its parts', () => {
  const c = readCard(reply);
  assert.equal(c.headline, 'Yes. The Read view already exists, so cards are a small step.');
  assert.deepEqual(c.chips, [
    { tone: 'done', text: 'Read view exists' },
    { tone: 'wait', text: 'nothing renders a card yet' },
    { tone: 'idle', text: 'Codex only for now' },
  ]);
  assert.match(c.body, /^Screenshot:/);
  assert.match(c.body, /What it would take/);
  assert.equal(c.asks.length, 2);
  assert.deepEqual(c.asks[0], {
    n: 1,
    text: 'Where should the card show?',
    options: [
      { letter: 'A', label: 'above the terminal' },
      { letter: 'B', label: 'inside Read only' },
      { letter: 'C', label: 'both' },
    ],
  });
  assert.equal(c.asksNote, "I'd pick **1A, 2B**.");
  assert.match(c.details, /^- The data side is done\./);
  assert.deepEqual(c.images, ['/tmp/shots/reader-after.png']);
  assert.ok(isCard(c));
});

test('a plain reply stays prose', () => {
  const text = 'Sync applied every update with `Promise.all`, so they **raced**.\n\n- Updates apply in order';
  const c = readCard(text);
  assert.equal(c.headline, null);
  assert.deepEqual(c.chips, []);
  assert.equal(c.body, text);
  assert.equal(isCard(c), false);
});

test('a bold opening that is only part of the line is not a headline', () => {
  assert.equal(readCard('**Note:** this is prose.').headline, null);
  assert.equal(readCard('**One** and **two**').headline, null);
});

test('a status line needs a dot on every part', () => {
  assert.equal(readChips('✅ done · and something else'), null);
  assert.deepEqual(readChips('🔴 broken'), [{ tone: 'bad', text: 'broken' }]);
});

test('options are read from the first A that starts a run of them', () => {
  assert.deepEqual(readAsk(3, 'Is A the right name?  A yes · B no'), {
    n: 3,
    text: 'Is A the right name?',
    options: [
      { letter: 'A', label: 'yes' },
      { letter: 'B', label: 'no' },
    ],
  });
  assert.deepEqual(readAsk(1, 'Ship it today?').options, []);
  assert.deepEqual(readAsk(1, 'Pick one  A this · C that').options, []);
});

test('a Needs you heading inside code is not a section', () => {
  const c = readCard('Here:\n\n```md\n**Needs you**\n1. x  A a · B b\n```');
  assert.equal(c.asks.length, 0);
});

test('answers go first, then what you typed', () => {
  assert.equal(answerText({ 2: 'B', 1: 'A' }, ''), '1 A, 2 B');
  assert.equal(answerText({ 1: 'A' }, 'and push it'), '1 A. and push it');
  assert.equal(answerText({}, ' hi '), 'hi');
  assert.equal(answerText({ 1: '' }, ''), '');
});

test('a reply is named by its opening words', () => {
  assert.equal(replyQuote('\n**Yes. It works.**\n\nmore'), 'Yes. It works.');
  assert.equal(replyQuote('- `a` item'), 'a item');
  assert.equal(replyQuote('x'.repeat(100), 10), 'xxxxxxxxx…');
});

test('pointing at a reply says which, how it looked, then the note', () => {
  assert.equal(
    pointerText('Yes. It works.', '/m/shot.png', ' options wrap oddly '),
    'About your reply that starts "Yes. It works." (how the Read view showed it: /m/shot.png)\n\noptions wrap oddly',
  );
  assert.equal(pointerText('Hi', null, ''), 'About your reply that starts "Hi"');
});

test('options read however a reply letters them', () => {
  const opts = (line) => readAsk(1, line).options.map((o) => `${o.letter}=${o.label}`);
  assert.deepEqual(opts('Ship today?  A: today · B: Monday'), ['A=today', 'B=Monday']);
  assert.deepEqual(opts('Update it?  A · yes  ·  B · not now'), ['A=yes', 'B=not now']);
  assert.deepEqual(opts('Remove them? **A** remove · **B** leave them'), ['A=remove', 'B=leave them']);
  assert.deepEqual(opts('Which phone? A) iPhone · B) Android'), ['A=iPhone', 'B=Android']);
});

test('decisions read as bullets, in bold, and with options on their own lines', () => {
  const card = readCard(`**Done.**

**Needs you (optional)**
- **Restart the Git plugin.** Obsidian still runs the old settings.
- **1. Vault on your phone?**
  - A: Obsidian Sync, the paid option
  - **B (free):** iCloud
  - C: Mac only
- **2. Keep the backup?** A: keep it · B: remove it
3. Send the draft yourself when you're ready.

**Details**
- More.`);
  assert.deepEqual(card.asks.map((a) => [a.n, a.text, a.options.map((o) => `${o.letter}=${o.label}`)]), [
    [1, 'Vault on your phone?', ['A=Obsidian Sync, the paid option', 'B=(free) iCloud', 'C=Mac only']],
    [2, 'Keep the backup?', ['A=keep it', 'B=remove it']],
    [3, "Send the draft yourself when you're ready.", []],
  ]);
  assert.match(card.asksNote, /Restart the Git plugin/);
});

test('a lone option line, or prose starting with a capital, is not a choice', () => {
  const card = readCard(`**Needs you**
1. Try it once.
   A lot depends on the first run.
2. Pick one?
   - A: this`);
  assert.deepEqual(card.asks.map((a) => a.options.length), [0, 0]);
  assert.equal(card.asks[1].text, 'Pick one?\n   - A: this');
});

test('a Needs you line can say it inline', () => {
  const card = readCard(`**Done.**

**Needs you:** nothing tonight.`);
  assert.equal(card.asksNote, 'nothing tonight.');
  assert.equal(card.body, '');
});

test('a message that opens with answers says which', async () => {
  const { answersIn } = await import('../src/nebula/replycard.ts');
  assert.deepEqual(answersIn('1 A, 2 B. Also rename it'), { 1: 'A', 2: 'B' });
  assert.deepEqual(answersIn('2A'), { 2: 'A' });
  assert.deepEqual(answersIn('3D printing next?'), {});
  assert.deepEqual(answersIn('ship it'), {});
});

test('round 2: asides inline, bare bulleted options, bare section words, dictated answers', async () => {
  const { answersIn } = await import('../src/nebula/replycard.ts');
  const opts = (line) => readAsk(1, line).options.map((o) => `${o.letter}=${o.label}`);
  assert.deepEqual(opts('Ship? **A (recommended):** today · **B:** Monday'), ['A=(recommended) today', 'B=Monday']);
  const bul = readCard(`**Needs you**
1. Ship today?
   - A today
   - B Monday
2. Rename it?
   - A rename`);
  assert.deepEqual(bul.asks.map((a) => a.options.map((o) => o.label)), [['today', 'Monday'], []]);
  assert.equal(bul.asks[1].text, 'Rename it?\n   - A rename');
  const prose = readCard('Some text\nDetails\nmore');
  assert.equal(prose.details, null);
  assert.deepEqual(answersIn('1a 2b'), { 1: 'A', 2: 'B' });
  assert.deepEqual(answersIn('1: A and 2: B'), { 1: 'A', 2: 'B' });
  assert.deepEqual(answersIn('1 A, 2 B'), { 1: 'A', 2: 'B' });
});

test('round 3: answers read in linear time, with trailing words after two or more', async () => {
  const { answersIn } = await import('../src/nebula/replycard.ts');
  assert.deepEqual(answersIn('1 A, 2 B thanks'), { 1: 'A', 2: 'B' });
  assert.deepEqual(answersIn('1A 2B also do X'), { 1: 'A', 2: 'B' });
  assert.deepEqual(answersIn('2 B thanks'), {});
  assert.deepEqual(answersIn('5 a.m. works'), {});
  const t = performance.now();
  answersIn('1 a '.repeat(500) + 'x y');
  readCard('Details' + ' '.repeat(5000) + 'x');
  assert.ok(performance.now() - t < 200);
});

test('a card offers the answers it recommends', async () => {
  const { suggested } = await import('../src/nebula/replycard.ts');
  assert.deepEqual(suggested(readCard(reply)), { 1: 'A', 2: 'B' });
  assert.deepEqual(
    suggested(readCard(`**Needs you**
1. Ship?
   - **A (recommended):** today
   - B: Monday`)),
    { 1: 'A' },
  );
  assert.deepEqual(suggested(readCard(`**Needs you**
1. Ship?  A today · B Monday`)), {});
  // A pick naming an option the card doesn't have is no suggestion.
  assert.deepEqual(suggested(readCard(`**Needs you**
1. Ship?  A today · B Monday

I'd pick 1C.`)), {});
});

const decisions = `9. ✅ **On my way looked already on:** her screenshot shows the bug fixed yesterday.

**Decisions**
2. Sticker button? A make "Stick something on" a real button · B that, plus tapping empty space opens the stickers
3. Vibes? A they only dress the pets · B leave as is

I'm also saving her feedback to the vault.

🟠 Keep open: waiting on 2 to 3 (1 I'll do either way).`;

test('a Decisions heading reads like Needs you', () => {
  const c = readCard(decisions);
  assert.deepEqual(c.asks.map((a) => [a.n, a.text, a.options.length]), [
    [2, 'Sticker button?', 2],
    [3, 'Vibes?', 2],
  ]);
  assert.equal(c.asksNote, "I'm also saving her feedback to the vault.");
});

test('the close verdict comes off the end as its own part', () => {
  const c = readCard(decisions);
  assert.deepEqual(c.verdict, { tone: 'wait', text: "Keep open: waiting on 2 to 3 (1 I'll do either way)." });
  assert.doesNotMatch(c.asksNote, /Keep open/);
  assert.deepEqual(readCard('Done.\n\n**✅ Safe to close.**').verdict, { tone: 'done', text: 'Safe to close.' });
  assert.deepEqual(readCard('x\n\n🔴 **Don\'t close:** unpushed').verdict, { tone: 'bad', text: "Don't close: unpushed" });
  assert.ok(isCard(readCard('Done.\n\n✅ Safe to close')));
  // Only on the last line, and not a reply that's nothing else.
  assert.equal(readCard('✅ Safe to close').verdict, null);
  assert.equal(readCard('✅ Safe to close\n\nmore after').verdict, null);
});

test('decisions run together on one line split back apart', () => {
  const c = readCard('**Decisions** 2. Sticker? A real button · B tap space 3. Vibes? A pets only · B leave 4. New chill? A shorter · B trim');
  assert.deepEqual(c.asks.map((a) => [a.n, a.text, a.options.map((o) => o.label)]), [
    [2, 'Sticker?', ['real button', 'tap space']],
    [3, 'Vibes?', ['pets only', 'leave']],
    [4, 'New chill?', ['shorter', 'trim']],
  ]);
  // A number inside a question that isn't the next decision stays put.
  const one = readCard('**Needs you**\n1. Keep it under 2. Then what?  A yes · B no');
  assert.equal(one.asks.length, 1);
  assert.equal(one.asks[0].text, 'Keep it under 2. Then what?');
});
