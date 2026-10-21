import test from 'node:test';
import assert from 'node:assert/strict';
import { byPriority, priorityLabel, rank } from '../src/nebula/priority.ts';
import { layout } from '../src/nebula/folders.ts';

test('urgent and high go first, low last, and none between them', () => {
  const items = [['a'], ['b', 'low'], ['c', 'high'], ['d'], ['e', 'urgent'], ['f', 'high']];
  assert.deepEqual(byPriority(items, (x) => x[1]).map((x) => x[0]), ['e', 'c', 'f', 'a', 'd', 'b']);
});

test('a priority this build does not know sorts as none', () => {
  assert.equal(rank('someday'), rank(undefined));
  assert.equal(rank('toString'), rank(undefined));
  assert.equal(priorityLabel('someday'), undefined);
  assert.equal(priorityLabel('high'), 'High');
});

test('a folder keeps its own order within each priority', () => {
  const p = (repo) => ({ repo_path: `/r/${repo}`, name: repo });
  const prefs = {
    projectFolders: [{ id: 'f', name: 'Work', projects: ['/r/a', '/r/b', '/r/c'] }],
    projectPriorities: { '/r/c': 'urgent', '/r/a': 'low' },
  };
  const { folders } = layout([p('a'), p('b'), p('c'), p('d')], prefs);
  assert.deepEqual(folders[0].projects.map((x) => x.name), ['c', 'b', 'a']);
});
