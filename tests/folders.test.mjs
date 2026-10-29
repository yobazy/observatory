import test from 'node:test';
import assert from 'node:assert/strict';
import { allTags, layout, matches, moveWithin, parseTags, placeIn, reorderFolders } from '../src/nebula/folders.ts';

const p = (repo, name = repo) => ({ repo_path: `/r/${repo}`, name });
const projects = [p('a'), p('b'), p('c'), p('d')];

test('folders take their projects, in their own order; the rest stay loose', () => {
  const prefs = { projectFolders: [{ id: 'f', name: 'Work', projects: ['/r/c', '/r/a', '/r/gone'] }] };
  const { folders, loose } = layout(projects, prefs);
  assert.deepEqual(folders[0].projects.map((x) => x.name), ['c', 'a']);
  assert.deepEqual(loose.map((x) => x.name), ['b', 'd']);
});

test('a project in two folders shows in the first only', () => {
  const prefs = {
    projectFolders: [
      { id: 'f', name: 'One', projects: ['/r/a'] },
      { id: 'g', name: 'Two', projects: ['/r/a', '/r/b'] },
    ],
  };
  const { folders } = layout(projects, prefs);
  assert.deepEqual(folders.map((f) => f.projects.map((x) => x.name)), [['a'], ['b']]);
});

test('tags are typed loosely and kept clean', () => {
  assert.deepEqual(parseTags('Work, client  #urgent work'), ['work', 'client', 'urgent']);
  assert.deepEqual(allTags({ projectTags: { '/r/a': ['work'], '/r/b': ['work', 'art'], '/r/x': ['old'] } }, ['/r/a', '/r/b']), ['work', 'art']);
});

test('the filter finds an alias, the real name, the folder or a tag', () => {
  const prefs = { projectTags: { '/r/a': ['client'] }, projectFolders: [{ id: 'f', name: 'Freelance', projects: ['/r/a'] }] };
  const shop = { repo_path: '/r/a', name: 'Shop' };
  assert.ok(matches(shop, 'storefront-v2', prefs, 'shop'));
  assert.ok(matches(shop, 'storefront-v2', prefs, 'storefront'));
  assert.ok(matches(shop, 'storefront-v2', prefs, 'freelance'));
  assert.ok(matches(shop, 'storefront-v2', prefs, '#cli'));
  assert.ok(!matches(shop, 'storefront-v2', prefs, '#work'));
  assert.ok(!matches(p('b'), 'b', prefs, '#client'));
});

test('a move inside a group leaves everything outside it where it was', () => {
  assert.deepEqual(moveWithin(['a', 'x', 'b', 'y', 'c'], ['a', 'b', 'c'], 'c', 0), ['c', 'x', 'a', 'y', 'b']);
  assert.deepEqual(moveWithin(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 9), ['b', 'c', 'a']);
});

test('putting a project in a folder takes it out of any other', () => {
  const folders = [
    { id: 'f', name: 'One', projects: ['/r/a', '/r/b'] },
    { id: 'g', name: 'Two', projects: [] },
  ];
  assert.deepEqual(placeIn(folders, '/r/a', 'g').map((f) => f.projects), [['/r/b'], ['/r/a']]);
  assert.deepEqual(placeIn(folders, '/r/a', null).map((f) => f.projects), [['/r/b'], []]);
});

test('a folder dragged to a new place takes it, the rest keep their order', () => {
  const folders = ['f', 'g', 'h'].map((id) => ({ id, name: id, projects: [] }));
  const ids = (fs) => fs.map((f) => f.id);
  assert.deepEqual(ids(reorderFolders(folders, 'h', 0)), ['h', 'f', 'g']);
  assert.deepEqual(ids(reorderFolders(folders, 'f', 2)), ['g', 'h', 'f']);
  assert.deepEqual(ids(reorderFolders(folders, 'f', 99)), ['g', 'h', 'f']);
  assert.equal(reorderFolders(folders, 'gone', 0), folders);
});
