import test from 'node:test';
import assert from 'node:assert/strict';
import { fromLabel, matchProject, parseHandoff } from '../src/nebula/handoff.ts';

test('a new-task link gives its project, prompt and sender', () => {
  assert.deepEqual(parseHandoff('observatory://new-task?project=observatory&prompt=fix%20the%20thing&from=01K9'), {
    project: 'observatory',
    prompt: 'fix the thing',
    from: '01K9',
  });
  assert.deepEqual(parseHandoff('observatory://new-task/?prompt=x'), { project: null, prompt: 'x', from: null });
});

test('a link with no prompt, another action, or too long a prompt is refused', () => {
  assert.ok('error' in parseHandoff('observatory://new-task?project=a'));
  assert.ok('error' in parseHandoff('observatory://delete-everything?prompt=x'));
  assert.ok('error' in parseHandoff(`observatory://new-task?prompt=${'a'.repeat(20_001)}`));
  assert.ok('error' in parseHandoff('https://new-task?prompt=x'));
  assert.ok('error' in parseHandoff('not a url'));
});

const projects = [
  { id: 'p1', name: 'observatory', repo_path: '/Users/me/code/observatory' },
  { id: 'p2', name: 'career-ops', repo_path: '/Users/me/code/career-ops' },
];

test('a project is found by name, repo path, or a path inside it', () => {
  assert.equal(matchProject(projects, 'Observatory')?.id, 'p1');
  assert.equal(matchProject(projects, '/Users/me/code/career-ops/')?.id, 'p2');
  assert.equal(matchProject(projects, '/Users/me/code/observatory/src/App.tsx')?.id, 'p1');
  assert.equal(matchProject(projects, '/private/Users/me/code/observatory')?.id, 'p1');
});

test('no match or several leaves the pick to you', () => {
  assert.equal(matchProject(projects, 'nebula'), null);
  assert.equal(matchProject(projects, null), null);
  assert.equal(matchProject([...projects, { id: 'p3', name: 'Observatory', repo_path: '/x' }], 'observatory'), null);
});

test('only an agent the daemon knows is named as the sender', () => {
  const agents = { a1: { name: 'Fix login', worktree_id: 'w1' } };
  const projectOf = (w) => (w === 'w1' ? { name: 'career-ops' } : undefined);
  assert.equal(fromLabel('a1', agents, projectOf), 'From Fix login in career-ops');
  assert.equal(fromLabel('nope', agents, projectOf), 'From a link');
  assert.equal(fromLabel(null, agents, projectOf), 'From a link');
});
