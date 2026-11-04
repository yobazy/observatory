import test from 'node:test';
import assert from 'node:assert/strict';
import { commandIn, commandOf, stepOf } from '../src/nebula/command.ts';

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

test("a prompt starting with ! is a command to run", () => {
  assert.equal(commandOf("! npm test\n"), "npm test");
  assert.equal(commandOf("!ls"), "ls");
  assert.equal(commandOf("run ! this"), null);
});

test("a run's step counts once it has stopped or gone to the background", () => {
  const run = { command: "npm test  && x", at: 100_500 };
  const at = (n, step) => ({ n, kind: "steps", text: "", at: n, steps: [step] });
  const bash = { tool: "Bash", target: "npm test && x" };
  assert.equal(stepOf(run, [at(100, { ...bash, ok: null })]), null);
  assert.equal(stepOf(run, [at(99, { ...bash, ok: true })]), null);
  assert.equal(stepOf(run, [at(100, { ...bash, target: "other", ok: true })]), null);
  assert.equal(stepOf(run, [at(100, { ...bash, ok: true })]).ok, true);
  assert.equal(stepOf(run, [at(101, { ...bash, ok: null, detail: "moved" })]).detail, "moved");
});
