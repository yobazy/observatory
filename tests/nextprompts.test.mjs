import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SUGGEST,
  MAX_PROMPTS,
  buildSuggestPrompt,
  readSuggestions,
  freshReply,
  suggestCommand,
} from '../src/nebula/nextprompts.ts';

test('suggestions are off until turned on, then default to a cheap model', () => {
  assert.equal(suggestCommand(undefined, undefined), null);
  assert.equal(suggestCommand(false, 'codex exec'), null);
  assert.equal(suggestCommand(true, undefined), DEFAULT_SUGGEST);
  assert.equal(suggestCommand(true, '  '), DEFAULT_SUGGEST);
  assert.equal(suggestCommand(true, 'Off'), null);
  assert.equal(suggestCommand(true, ' codex exec '), 'codex exec');
});

test('only a reply new to you gets suggestions, not an old thread opened to read', () => {
  assert.equal(freshReply(false, false), false);
  assert.equal(freshReply(false, true), true);
  assert.equal(freshReply(true, false), true);
});

test('the prompt carries the ends of your message and the reply', () => {
  const p = buildSuggestPrompt('fix the login', `${'x'.repeat(9000)}Needs you: pick A or B`);
  assert.match(p, /fix the login/);
  assert.match(p, /Needs you: pick A or B\n>>>$/);
  assert.ok(p.length < 8000);
  assert.match(buildSuggestPrompt('', 'done'), /\(none\)/);
});

test('reads prompts from JSON, fenced or in prose', () => {
  assert.deepEqual(readSuggestions('{"prompts": ["Open a PR", "Run the tests"]}'), ['Open a PR', 'Run the tests']);
  assert.deepEqual(readSuggestions('Sure!\n```json\n{"prompts": ["Ship it"]}\n```'), ['Ship it']);
  assert.deepEqual(readSuggestions('{"prompts":["Merge it"]} — hope that helps'), ['Merge it']);
  assert.deepEqual(readSuggestions('{"prompts": []}'), []);
});

test('cleans, dedupes and caps what it reads', () => {
  const got = readSuggestions(
    JSON.stringify({ prompts: ['1. Open a PR', '"open a pr"', 7, '  - Run   the tests ', 'x'.repeat(200), 'One', 'Two'] }),
  );
  assert.deepEqual(got, ['Open a PR', 'Run the tests', 'One']);
  assert.equal(got.length, MAX_PROMPTS);
});

test('no JSON, or the wrong shape, reads as null', () => {
  assert.equal(readSuggestions('I have no idea'), null);
  assert.equal(readSuggestions('{"prompts": "Open a PR"}'), null);
  assert.equal(readSuggestions('{nope}'), null);
});
