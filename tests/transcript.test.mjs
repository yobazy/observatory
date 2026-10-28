import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, stepsLine } from '../src/nebula/transcript.ts';

const e = (n, kind = 'claude', text = `e${n}`) => ({ n, kind, text, at: 0, steps: [] });
const s = (tool, target = '', ok = true) => ({ tool, target, ok });

test('new entries replace the ones from where they start', () => {
  const prev = [e(0), e(1), e(2, 'steps')];
  const next = [{ ...e(2, 'steps'), steps: [s('Read')] }, e(3)];
  assert.deepEqual(merge(prev, next, 0).map((x) => x.n), [0, 1, 2, 3]);
  assert.equal(merge(prev, next, 0)[2].steps.length, 1);
});

test('entries no longer kept fall away', () => {
  assert.deepEqual(merge([e(0), e(1)], [e(2)], 1).map((x) => x.n), [1, 2]);
  assert.deepEqual(merge([e(0), e(1)], [], 1).map((x) => x.n), [1]);
});

test('a run of tool calls reads as one line', () => {
  assert.equal(
    stepsLine([s('Read', '/r/a.ts'), s('Grep'), s('Edit', '/r/src/sync.ts'), s('Edit', '/r/src/sync.ts'), s('Bash', 'npm test', false)]),
    'Read 2 files, edited sync.ts, ran npm test, 1 failed',
  );
  assert.equal(stepsLine([s('Edit', '/a'), s('Write', '/b'), s('Edit', '/c'), s('Bash', 'x'), s('Bash', 'y')]), 'Edited 3 files, ran 2 commands');
  assert.equal(stepsLine([s('mcp__x__y')]), 'Used 1 tool');
  assert.equal(stepsLine([s('Read'), s('TaskUpdate')]), 'Read 1 file, used 1 other tool');
});

test('the step under way is said as what it is doing', async () => {
  const { doingLine } = await import('../src/nebula/transcript.ts');
  const s = (tool, target = '') => ({ tool, target, ok: null });
  assert.equal(doingLine(s('Edit', '/r/src/sync.ts')), 'Editing sync.ts');
  assert.equal(doingLine(s('Bash', 'npm test\nmore')), 'Running npm test');
  assert.equal(doingLine(s('Grep', 'foo')), 'Looking through files');
  assert.equal(doingLine(s('mcp__pencil__execute')), 'Using execute');
});

test('working lines skip the cd and shorten mcp names', async () => {
  const { doingLine } = await import('../src/nebula/transcript.ts');
  assert.equal(doingLine({ tool: 'Bash', target: 'cd /a/b && npm test', ok: null }), 'Running npm test');
  assert.equal(doingLine({ tool: 'mcp__claude_ai_Gmail__send_message', target: '', ok: null }), 'Using send message');
});

test('finding in the thread ignores case and doesn\'t overlap', async () => {
  const { findAll } = await import('../src/nebula/transcript.ts');
  assert.deepEqual(findAll('Sync the sync, SYNC', 'sync'), [0, 9, 15]);
  assert.deepEqual(findAll('aaaa', 'aa'), [0, 2]);
  assert.deepEqual(findAll('abc', ''), []);
});

test('the working line says how long the turn has run', async () => {
  const { clock } = await import('../src/nebula/transcript.ts');
  assert.equal(clock(45.9), '45s');
  assert.equal(clock(80), '1m 20s');
  assert.equal(clock(3900), '1h 5m');
  assert.equal(clock(-3), '0s');
});

test('the step under way is sorted for the working line\'s cat', async () => {
  const { actOf } = await import('../src/nebula/transcript.ts');
  const s = (tool) => ({ tool, target: '', ok: null });
  assert.equal(actOf(s('Write')), 'edit');
  assert.equal(actOf(s('Grep')), 'read');
  assert.equal(actOf(s('Bash')), 'run');
  assert.equal(actOf(s('WebSearch')), 'web');
  assert.equal(actOf(s('Agent')), 'wait');
  assert.equal(actOf(s('mcp__pencil__execute')), 'other');
});
