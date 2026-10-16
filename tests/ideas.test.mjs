import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, due, dueLabel, filterIdeas, groupIdeas, localDay, openCounts, sortIdeas } from '../src/nebula/ideaList.ts';

const today = '2026-10-16';
const idea = (id, o = {}) => ({ id, text: id, project: null, createdAt: Number(id.replace(/\D/g, '')) || 0, ...o });

test('deadlines count whole days, and read the way you would say them', () => {
  assert.equal(daysUntil('2026-10-18', today), 2);
  assert.equal(daysUntil('2026-10-15', today), -1);
  assert.equal(daysUntil('2026-11-01', today), 16);
  assert.equal(dueLabel('2026-10-16', today), 'due today');
  assert.equal(dueLabel('2026-10-17', today), 'due tomorrow');
  assert.equal(dueLabel('2026-10-13', today), '3 days late');
  assert.equal(dueLabel('2026-12-01', today), 'due 2026-12-01');
  assert.match(localDay(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('an open idea is overdue or due soon; a done one is neither', () => {
  assert.equal(due(idea('a', { deadline: '2026-10-15' }), today), 'overdue');
  assert.equal(due(idea('b', { deadline: '2026-10-18' }), today), 'soon');
  assert.equal(due(idea('c', { deadline: '2026-10-25' }), today), null);
  assert.equal(due(idea('d', { deadline: '2026-10-15', doneAt: 1 }), today), null);
  assert.equal(due(idea('e'), today), null);
});

test('priority order puts what is late first, then high to none, deadlines breaking ties', () => {
  const list = [
    idea('n1'),
    idea('l2', { priority: 'low' }),
    idea('h3', { priority: 'high', deadline: '2026-10-30' }),
    idea('h4', { priority: 'high', deadline: '2026-10-20' }),
    idea('m5', { priority: 'medium', deadline: '2026-10-10' }),
  ];
  assert.deepEqual(sortIdeas(list, 'priority', today).map((i) => i.id), ['m5', 'h4', 'h3', 'l2', 'n1']);
  assert.deepEqual(sortIdeas(list, 'deadline', today).map((i) => i.id), ['m5', 'h4', 'h3', 'l2', 'n1']);
  assert.deepEqual(sortIdeas(list, 'newest', today).map((i) => i.id), ['m5', 'h4', 'h3', 'l2', 'n1'].sort((a, b) => b.slice(1) - a.slice(1)));
});

test('the filter keeps open ideas by default, and narrows by project, priority, due and text or #tag', () => {
  const list = [
    idea('a1', { project: '/r/shop', tags: ['ui'] }),
    idea('b2', { project: null, priority: 'high' }),
    idea('c3', { project: '/r/shop', doneAt: 5 }),
    idea('d4', { project: '/r/blog', deadline: '2026-10-14', text: 'fix the RSS feed' }),
    idea('e5', { project: '/r/blog', startedAs: 'agent-1' }),
  ];
  const ids = (f) => filterIdeas(list, f, today).map((i) => i.id);
  assert.deepEqual(ids({}), ['a1', 'b2', 'd4']);
  assert.deepEqual(ids({ show: 'done' }), ['c3', 'e5']);
  assert.deepEqual(ids({ project: 'unsorted' }), ['b2']);
  assert.deepEqual(ids({ project: '/r/shop', show: 'all' }), ['a1', 'c3']);
  assert.deepEqual(ids({ priority: 'high' }), ['b2']);
  assert.deepEqual(ids({ dueOnly: true }), ['d4']);
  assert.deepEqual(ids({ query: 'rss' }), ['d4']);
  assert.deepEqual(ids({ query: '#u' }), ['a1']);
});

test('groups put Unsorted first, then projects in the sidebar order', () => {
  const list = [idea('a', { project: '/r/blog' }), idea('b'), idea('c', { project: '/r/shop' }), idea('d', { project: '/r/zzz' })];
  const groups = groupIdeas(list, ['/r/shop', '/r/blog']);
  assert.deepEqual(groups.map((g) => g.project), [null, '/r/shop', '/r/blog', '/r/zzz']);
  assert.deepEqual([...openCounts([...list, idea('e', { project: '/r/shop', doneAt: 1 })])].sort(), [[null, 1], ['/r/blog', 1], ['/r/shop', 1], ['/r/zzz', 1]].sort());
});
