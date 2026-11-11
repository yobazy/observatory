import test from 'node:test';
import assert from 'node:assert/strict';
import { readCard } from '../src/nebula/replycard.ts';
import { NO_ANSWER, firstQuestion, outgoing, pickedWords, recommendedFor } from '../src/nebula/inboxAnswers.ts';

const card = readCard(`**Retries back off now.**

**Needs you**
1. **Commit and push this?** A commit & push · B leave it for now
2. Also cap retries at 30s? A yes · B no

I'd pick 1A, 2A.`);

test('Decisions sends the latest answers, then earlier ones in their own paragraph', () => {
  const earlier = [{ entry: 3, quote: 'Pick a colour', asks: [] }];
  assert.equal(outgoing([], NO_ANSWER), '');
  assert.equal(outgoing([], { ...NO_ANSWER, picks: { 1: 'A', 2: 'B' }, draft: 'thanks' }), '1 A, 2 B. thanks');
  assert.equal(
    outgoing(earlier, { picks: { 1: 'A' }, draft: '', back: { 3: { 1: 'B' } } }),
    '1 A\n\nAbout your reply that starts "Pick a colour": 1 B',
  );
});

test('a card offers its recommendation only until you start on it', () => {
  assert.deepEqual(recommendedFor(card, NO_ANSWER), { 1: 'A', 2: 'A' });
  assert.deepEqual(recommendedFor(card, { ...NO_ANSWER, picks: { 1: 'B' } }), {});
  assert.deepEqual(recommendedFor(card, { ...NO_ANSWER, draft: 'hold on' }), {});
  // A tap taken back doesn't count as started.
  assert.deepEqual(recommendedFor(card, { ...NO_ANSWER, picks: { 1: '' } }), { 1: 'A', 2: 'A' });
});

test('the queue shows an answer in the options\' own words', () => {
  assert.equal(pickedWords(card, { ...NO_ANSWER, picks: { 2: 'A', 1: 'B' } }), 'leave it for now · yes');
  assert.equal(pickedWords(card, { ...NO_ANSWER, picks: { 1: 'keep it a week' }, draft: 'and ping me' }), 'keep it a week · “and ping me”');
  assert.equal(pickedWords(card, { ...NO_ANSWER, picks: { 1: '' } }), '');
});

test('the queue line is the first question, in plain words', () => {
  assert.deepEqual(firstQuestion(card), { text: 'Commit and push this?', more: 1 });
  assert.equal(firstQuestion(null), null);
});
