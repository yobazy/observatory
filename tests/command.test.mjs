import test from 'node:test';
import assert from 'node:assert/strict';
import { commandIn } from '../src/nebula/command.ts';

test('an untagged one-line command is runnable as it is', () => {
  const cmd = "ssh pc 'cd ~/Programming/site && git pull -q && ./run.sh'";
  assert.equal(commandIn('', cmd), cmd);
});

test('shell blocks run; other languages and prose do not', () => {
  assert.equal(commandIn('bash', 'npm test'), 'npm test');
  assert.equal(commandIn('zsh', '$ ls -la'), 'ls -la');
  assert.equal(commandIn('ts', 'const a = 1'), null);
  assert.equal(commandIn('', 'Hamna said: keep it black and white'), null);
  assert.equal(commandIn('', 'error: build failed'), null);
  assert.equal(commandIn('', '29 pages built'), null);
  assert.equal(commandIn('', '\n\n'), null);
});

test('continuations join, comments drop, and several commands chain with &&', () => {
  assert.equal(commandIn('sh', 'docker run \\\n  --rm \\\n  img'), 'docker run --rm img');
  assert.equal(commandIn('sh', 'cat log |\n  tail -5'), 'cat log | tail -5');
  assert.equal(commandIn('bash', '# build it\nnpm run build\n\nnpm test'), 'npm run build && npm test');
  assert.equal(commandIn('', './scripts/sandbox.sh up'), './scripts/sandbox.sh up');
});
