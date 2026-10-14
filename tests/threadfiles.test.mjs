import test from 'node:test';
import assert from 'node:assert/strict';
import { byThread } from '../src/nebula/threadfiles.ts';

const f = (path) => ({ path, insertions: 1, deletions: 0 });
const shape = (groups) => groups.map((g) => [g.agentId, g.files.map((p) => p.file.path + (p.alsoBy.length ? ` (+${p.alsoBy})` : ''))]);

test('each uncommitted file goes under the thread that changed it', () => {
  const groups = byThread([f('a.ts'), f('b.ts'), f('README.md')], '/repo', {
    t1: [{ path: '/repo/a.ts', at: 100 }],
    t2: [{ path: '/repo/b.ts', at: 200 }],
  }, null);
  assert.deepEqual(shape(groups), [
    ['t2', ['b.ts']],
    ['t1', ['a.ts']],
    [null, ['README.md']],
  ], 'newest thread first, files no thread changed last');
});

test('a file two threads changed sits with the later one and names the other', () => {
  const groups = byThread([f('q.ts')], '/repo', {
    t1: [{ path: '/repo/q.ts', at: 100 }],
    t2: [{ path: '/repo/q.ts', at: 300 }],
  }, null);
  assert.deepEqual(shape(groups), [['t2', ['q.ts (+t1)']]]);
});

test('edits from before the last commit are already committed', () => {
  const groups = byThread([f('a.ts')], '/repo', {
    old: [{ path: '/repo/a.ts', at: 50 }],
    now: [{ path: '/repo/a.ts', at: 150 }],
  }, 100);
  assert.deepEqual(shape(groups), [['now', ['a.ts']]]);
  assert.deepEqual(shape(byThread([f('a.ts')], '/repo', { old: [{ path: '/repo/a.ts', at: 50 }] }, 100)), [[null, ['a.ts']]]);
});

test('paths match through a trailing slash and macOS /private', () => {
  const groups = byThread([f('x.md')], '/tmp/wt/', { t: [{ path: '/private/tmp/wt/x.md', at: 1 }] }, null);
  assert.deepEqual(shape(groups), [['t', ['x.md']]]);
});

test('edits outside the checkout are ignored', () => {
  const groups = byThread([f('a.ts')], '/repo', { t: [{ path: '/other/a.ts', at: 1 }] }, null);
  assert.deepEqual(shape(groups), [[null, ['a.ts']]]);
});
