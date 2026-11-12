import test from 'node:test';
import assert from 'node:assert/strict';
import { step, words } from '../src/nebula/reveal.ts';

test('splits a reply into words that keep their spaces', () => {
  assert.deepEqual(words('  Hello there,\nworld '), ['  Hello ', 'there,\n', 'world ']);
  assert.equal(words('one two  three').join(''), 'one two  three');
  assert.deepEqual(words(''), []);
});

test('paces about 40 words a second, faster for a long reply', () => {
  assert.equal(step(1), 0);
  assert.equal(step(20), 24);
  // The last of 1,000 words still starts within 1.4s.
  assert.ok(step(1000) * 999 <= 1400);
  assert.ok(step(1000) > 0);
});
