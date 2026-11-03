import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SUGGEST,
  MAX_PROMPTS,
  buildSuggestPrompt,
  readSuggestions,
  suggestCommand,
} from '../src/nebula/nextprompts.ts';

test('the command defaults to a cheap model and can be turned off', () => {
  assert.equal(suggestCommand(undefined), DEFAULT_SUGGEST);
  assert.equal(suggestCommand('  '), DEFAULT_SUGGEST);
  assert.equal(suggestCommand('Off'), null);
  assert.equal(suggestCommand(' codex exec '), 'codex exec');
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
