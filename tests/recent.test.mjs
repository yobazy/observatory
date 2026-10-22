import test from 'node:test';
import assert from 'node:assert/strict';
import { recentProjects, visit } from '../src/nebula/recentList.ts';

const p = (repo) => ({ id: repo, repo_path: `/r/${repo}`, name: repo });

test('a visit moves its project to the front, once', () => {
  let v = [];
  v = visit(v, '/r/a', 1);
  v = visit(v, '/r/b', 2);
  v = visit(v, '/r/a', 3);
  assert.deepEqual(v, [{ repo: '/r/a', at: 3 }, { repo: '/r/b', at: 2 }]);
});

test('only so many visits are kept', () => {
  let v = [];
  for (let i = 0; i < 30; i++) v = visit(v, `/r/${i}`, i);
  assert.equal(v.length, 20);
  assert.equal(v[0].repo, '/r/29');
});

test('recent marks the project you are in, leaves out ones that are gone, up to the count', () => {
  const projects = ['a', 'b', 'c', 'd', 'e'].map(p);
  const v = ['/r/c', '/r/gone', '/r/a', '/r/b', '/r/d', '/r/e'].map((repo, i) => ({ repo, at: 10 - i }));
  const shown = recentProjects(v, projects, projects[2], 3);
  assert.deepEqual(shown.map((r) => [r.project.name, r.here]), [['c', true], ['a', false], ['b', false]]);
  assert.equal(shown[1].at, 8);
});
