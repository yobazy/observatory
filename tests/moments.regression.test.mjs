// Marked moments that found a Read view bug, replayed from their fixtures in
// tests/fixtures/moments (see the README there). Each fixture's checks run
// through the code that decides what the Read view shows. "transcript"
// checks read a Claude log, which is Rust's job: src-tauri/src/transcript.rs
// runs those.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { findQuestion } from '../src/nebula/question.ts';
import { readCard } from '../src/nebula/replycard.ts';
import { landedNote } from '../src/nebula/prwatch.ts';
import { canSendQueued, holdNext, readyForNext, reads } from '../src/nebula/queuegate.ts';
import { heldAtPrompt } from '../src/nebula/transcript.ts';
import { isReport } from '../src/nebula/typed.ts';

const dir = new URL('./fixtures/moments/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }));

/** A time as fixtures write it: ISO, or already ms. */
const ms = (v) => (typeof v === 'string' ? Date.parse(v) : v);

const checks = {
  card({ text }, expect) {
    const card = readCard(text);
    if (expect.asks) {
      assert.deepEqual(card.asks.map((a) => a.n), expect.asks.map((a) => a.n), 'the decisions found');
      for (const [i, want] of expect.asks.entries()) {
        const got = card.asks[i];
        assert.equal(got.options.map((o) => o.letter).join(''), want.letters, `the options of decision ${want.n}`);
        if (want.labels) assert.deepEqual(got.options.map((o) => o.label), want.labels, `decision ${want.n}'s labels`);
        for (const [j, start] of (want.labelsStart ?? []).entries()) {
          assert.ok(got.options[j]?.label.startsWith(start), `decision ${want.n}'s option ${j + 1} starts "${start}": ${got.options[j]?.label}`);
        }
      }
    }
    if (expect.verdict !== undefined) assert.equal(card.verdict?.tone ?? null, expect.verdict, 'the verdict');
  },

  screen({ screen }, expect) {
    const q = findQuestion(screen);
    assert.ok(q, 'a question is read from the screen');
    if (expect.promptEnds) assert.ok(q.prompt.endsWith(expect.promptEnds), `the prompt: ${q.prompt}`);
    assert.deepEqual(q.choices.map((c) => c.label), expect.choices);
    if (expect.selected) assert.equal(q.choices.find((c) => c.selected)?.label, expect.selected);
  },

  landed({ text, states }, expect) {
    assert.equal(landedNote(readCard(text).verdict, states), expect.landed);
  },

  queue(input, expect) {
    const agent = { ...input.agent, status_changed_at: ms(input.agent.status_changed_at) };
    const sends = Object.fromEntries(Object.entries(input.sends).map(([k, v]) => [k, ms(v)]));
    const now = ms(input.now);
    const ended = input.turnEndedAt === undefined ? null : ms(input.turnEndedAt);
    if ('held' in expect) assert.equal(heldAtPrompt(agent, ended, sends.lastSent, now), expect.held, 'held at its prompt');
    if ('hold' in expect) assert.equal(holdNext(agent, sends, input.onScreen, now), expect.hold, "the queue runner's hold");
    if ('canSendNow' in expect) {
      assert.equal(canSendQueued(agent, ended, sends, now), expect.canSendNow, 'Send now');
      // A reply from the box goes straight in rather than queueing.
      assert.equal(reads(agent, ended, sends, now) || readyForNext(agent, sends, now), expect.canSendNow, 'a reply sends');
    }
  },

  reports({ data }, expect) {
    for (const d of data) assert.equal(isReport(d), expect.report, JSON.stringify(d));
  },
};

test('every fixture says where it came from and checks something', () => {
  assert.ok(fixtures.length > 0);
  for (const f of fixtures) {
    assert.equal(f.moment, f.file.replace(/\.json$/, ''), `${f.file}: named after its moment`);
    assert.ok(['choices', 'sent', 'queue'].includes(f.family), `${f.file}: family`);
    assert.ok(f.note && f.source, `${f.file}: note and source`);
    assert.ok(f.fixedBy || f.todo, `${f.file}: fixedBy, or todo for a live bug`);
    assert.ok(f.checks?.length, `${f.file}: checks`);
    for (const c of f.checks) assert.ok(c.reads === 'transcript' || checks[c.reads], `${f.file}: unknown reads "${c.reads}"`);
  }
});

for (const f of fixtures) {
  const mine = f.checks.filter((c) => c.reads !== 'transcript');
  if (!mine.length) continue;
  const name = `${f.moment} (${f.family}): ${f.note}`;
  const run = () => mine.forEach((c) => checks[c.reads](c.input, c.expect));
  if (f.todo) {
    // A bug still live: the test passes while it's broken, and fails once
    // it's fixed, so the fix takes the todo out.
    test(`${name} [known bug: ${f.todo}]`, () => assert.throws(run, 'fixed now? Take "todo" out of the fixture'));
  } else {
    test(name, run);
  }
}
