import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTag,
  deleteTag,
  filterThreads,
  renameTag,
  searchTerms,
  setThreadTags,
  tagCounts,
  threadShows,
} from '../src/nebula/threadtags.ts';
import { pruned } from '../src/nebula/prune.ts';

const REPO = '/r/client-branding';
const OTHER = '/r/other';
const rec = (tags, by = 'you') => ({ tags, by, at: 1 });

test('addTag cleans the name, keeps a tag once, and refuses an empty one', () => {
  const added = addTag({}, REPO, '#BLK Wtr');
  assert.deepEqual(added.threadTagLists[REPO], ['blk-wtr']);
  assert.equal(addTag(added, REPO, 'blk-wtr'), added, 'already there: no change');
  assert.deepEqual(addTag(added, REPO, '#Blk  wtr').threadTagLists[REPO], ['blk-wtr']);
  assert.equal(addTag({}, REPO, '#'), null);
  assert.equal(addTag({}, REPO, '  '), null);
  assert.deepEqual(addTag(added, REPO, 'hoam').threadTagLists[REPO], ['blk-wtr', 'hoam'], 'in the order added');
});

test('renameTag keeps its place in the list, renames it on threads, and merges into a name already there', () => {
  const prefs = {
    threadTagLists: { [REPO]: ['acme', 'blkwtr', 'hoam'] },
    threadTags: { A: rec(['blkwtr']), B: rec(['blkwtr', 'hoam']) },
  };
  const renamed = renameTag(prefs, REPO, 'blkwtr', 'blackwater', ['A', 'B']);
  assert.deepEqual(renamed.threadTagLists[REPO], ['acme', 'blackwater', 'hoam']);
  assert.deepEqual(renamed.threadTags.A.tags, ['blackwater']);
  assert.deepEqual(renamed.threadTags.B.tags, ['blackwater', 'hoam']);

  const merged = renameTag(prefs, REPO, 'blkwtr', 'hoam', ['A', 'B']);
  assert.deepEqual(merged.threadTagLists[REPO], ['acme', 'hoam']);
  assert.deepEqual(merged.threadTags.A.tags, ['hoam']);
  assert.deepEqual(merged.threadTags.B.tags, ['hoam'], 'no thread carries it twice');

  assert.equal(renameTag(prefs, REPO, 'blkwtr', '#'), null, 'an empty name is refused');
});

test('deleteTag takes it off the list and its threads, and leaves other projects alone', () => {
  const prefs = {
    threadTagLists: { [REPO]: ['blkwtr', 'hoam'], [OTHER]: ['blkwtr'] },
    threadTags: { A: rec(['blkwtr', 'hoam']), B: rec(['blkwtr']), C: rec(['blkwtr']) },
  };
  const next = deleteTag(prefs, REPO, 'blkwtr', ['A', 'B']);
  assert.deepEqual(next.threadTagLists[REPO], ['hoam']);
  assert.deepEqual(next.threadTags.A.tags, ['hoam']);
  assert.deepEqual(next.threadTags.B.tags, []);
  assert.deepEqual(next.threadTagLists[OTHER], ['blkwtr'], "another project's list");
  assert.deepEqual(next.threadTags.C.tags, ['blkwtr'], "another project's thread");
});

test('setThreadTags from the menu is yours, clearing every tag included', () => {
  const tagged = setThreadTags({}, 'A', ['hoam'], 5);
  assert.deepEqual(tagged.threadTags.A, { tags: ['hoam'], by: 'you', at: 5 });
  const fromPrompt = { threadTags: { A: rec(['hoam'], 'prompt') } };
  const cleared = setThreadTags(fromPrompt, 'A', [], 6);
  assert.deepEqual(cleared.threadTags.A, { tags: [], by: 'you', at: 6 });
});

test('pruned() drops tags of deleted threads, and the tag list of a removed project', () => {
  const s = {
    loaded: true,
    projects: { p1: { id: 'p1', repo_path: REPO } },
    worktrees: { w1: { id: 'w1', project_id: 'p1' } },
    agents: { A: { id: 'A', worktree_id: 'w1' } },
  };
  const prefs = {
    threadTagLists: { [REPO]: ['blkwtr'], [OTHER]: ['hoam'] },
    threadTags: { A: rec(['blkwtr']), gone: rec(['blkwtr']), inOther: rec(['hoam']) },
  };
  const next = pruned(s, prefs);
  assert.deepEqual(Object.keys(next.threadTags), ['A']);
  assert.deepEqual(next.threadTagLists, { [REPO]: ['blkwtr'] });
  assert.equal(pruned({ ...s, loaded: false }, prefs), prefs, 'left alone before the first snapshot');
});

test('filterThreads shows only the chip’s threads, archived ones and other branches included', () => {
  const threads = [
    { id: 'a', worktree_id: 'main', archived: false },
    { id: 'b', worktree_id: 'main', archived: true },
    { id: 'c', worktree_id: 'feature', archived: false },
    { id: 'd', worktree_id: 'feature', archived: false },
    { id: 'e', worktree_id: 'main', archived: false },
  ];
  const prefs = {
    threadTagLists: { [REPO]: ['blkwtr', 'hoam', 'acme'] },
    threadTags: { a: rec(['blkwtr']), b: rec(['blkwtr']), c: rec(['blkwtr', 'x']), d: rec(['hoam']) },
  };
  assert.deepEqual(filterThreads(threads, prefs, 'blkwtr').map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(filterThreads(threads, prefs, null).length, 5);
  assert.deepEqual(filterThreads(threads, prefs, 'acme'), []);
  assert.deepEqual([...tagCounts(threads, prefs, REPO)], [['blkwtr', 3], ['hoam', 1], ['acme', 0]]);
});

test('with a search typed and a chip on, a row shows only when it matches both', () => {
  const prefs = { threadTags: { A: rec(['blkwtr']), B: rec(['hoam']) } };
  const terms = searchTerms('  Logo ');
  assert.equal(threadShows(prefs, 'A', 'blkwtr', terms, ['New logo', 'main']), true, 'both');
  assert.equal(threadShows(prefs, 'A', 'blkwtr', terms, ['Pricing page', 'main']), false, 'tag only');
  assert.equal(threadShows(prefs, 'B', 'blkwtr', terms, ['New logo', 'main']), false, 'search only');
  assert.equal(threadShows(prefs, 'B', null, terms, ['New logo']), true, 'no chip: the search alone');
  assert.equal(threadShows(prefs, 'A', 'blkwtr', [], ['anything']), true, 'no search: the chip alone');
});
