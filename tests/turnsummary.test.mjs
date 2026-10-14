import test from 'node:test';
import assert from 'node:assert/strict';
import { duration, summarize } from '../src/nebula/turnsummary.ts';

const step = (tool, target, ok = true, note = null) => ({ tool, target, note, ok, at: 0 });
const turn = (steps, more = {}) => ({ number: 1, prompt: 'p', started: 0, last: 60, steps, dropped: 0, said: null, interrupted: false, ...more });
const headline = (s) => s.headline.map((p) => p.text);

test('a turn reads as what it changed and how its checks went', () => {
  const s = summarize(turn([
    step('Read', '/repo/src/a.ts'),
    step('Edit', '/repo/src/nebula/a.ts'),
    step('Edit', '/repo/src/nebula/b.ts'),
    step('Edit', '/repo/src/nebula/a.ts'),
    step('Bash', 'npm test', false),
    step('Bash', 'npm test', true),
    step('Bash', 'git add -A && git commit -m x'),
    step('Bash', 'ls'),
  ]), '/repo');
  assert.deepEqual(headline(s), ['Tests passed', 'Edited 2 files in src/nebula', 'Committed', 'Ran 1 command']);
  assert.deepEqual(s.edited, ['src/nebula/a.ts', 'src/nebula/b.ts']);
  assert.equal(s.looked, 1);
});

test('one file is named, and failures say so', () => {
  const s = summarize(turn([step('Write', '/repo/README.md'), step('Bash', 'cargo test --locked', false), step('Bash', 'curl x', false)]), '/repo');
  assert.deepEqual(headline(s), ['Tests failed', 'Edited README.md', 'Ran 1 command, 1 failed']);
  assert.equal(s.headline[0].tone, 'bad');
});

test('a broken build is named; a passing one is not', () => {
  assert.deepEqual(headline(summarize(turn([step('Bash', 'npm run build', false)]), '/r')), ['Build failed']);
  assert.deepEqual(headline(summarize(turn([step('Bash', 'npm run build'), step('Edit', '/r/a.ts')]), '/r')), ['Edited a.ts']);
  assert.deepEqual(headline(summarize(turn([step('Bash', 'npm run build')]), '/r')), ['Build passed'], 'unless there is nothing else');
});

test('a failed lint is named and not counted again', () => {
  assert.deepEqual(headline(summarize(turn([step('Bash', 'npm run lint', false), step('Bash', 'ls')]), '/r')), ['Lint failed', 'Ran 1 command']);
});

test('a question it is waiting on comes first', () => {
  const s = summarize(turn([step('Edit', '/r/a.ts'), step('AskUserQuestion', 'Which port?', null)]), '/r');
  assert.equal(s.headline[0].text, 'Asking you a question');
  assert.equal(s.asking, 'Which port?');
  const asked = summarize(turn([], { said: 'Should I merge it?' }), '/r', true);
  assert.equal(asked.asking, 'Should I merge it?');
  assert.equal(summarize(turn([], { said: 'Should I merge it?' }), '/r', false).asking, null);
});

test('a turn with only reading or talking still says something', () => {
  assert.deepEqual(headline(summarize(turn([step('Read', '/r/a'), step('Grep', 'x')]), '/r')), ['Looked through 2 files']);
  assert.deepEqual(headline(summarize(turn([], { said: 'Done.' }), '/r')), ['Replied']);
  assert.deepEqual(headline(summarize(turn([], { interrupted: true }), '/r')), ['Stopped by you']);
});

test('a running check reads as running', () => {
  assert.deepEqual(headline(summarize(turn([step('Bash', 'pytest -q', null)]), '/r')), ['Running tests']);
});

test('durations read short', () => {
  assert.equal(duration(42), '42s');
  assert.equal(duration(240), '4m');
  assert.equal(duration(3900), '1h 5m');
  assert.equal(duration(7200), '2h');
});
