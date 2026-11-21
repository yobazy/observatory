import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionSync } from '../src/nebula/permissions.ts';

const card = (over = {}) => ({ description: '', skills: [], skillNotes: {}, taskKinds: [], policy: 'isolated', concurrency: 1, isHome: false, homeFolder: null, schedulingInstruction: '', pushAfterTurn: false, ...over });
const projects = { p1: { repo_path: '/code/shop' }, p2: { repo_path: '/code/blog' }, p3: { repo_path: '/code/api' } };

test('only Run free projects are handed over, by their main checkout, sorted', () => {
  const cards = { p1: card({ permissions: 'free' }), p2: card(), p3: card({ permissions: 'free' }) };
  assert.deepEqual(permissionSync(cards, projects, null), {
    projects: [{ root: '/code/api', level: 'free' }, { root: '/code/shop', level: 'free' }],
    skip: [],
  });
});

test('a plain folder that is Home goes by its path; a card with no project is skipped', () => {
  const cards = { 'folder:/Users/me/home': card({ permissions: 'free', isHome: true }), gone: card({ permissions: 'free' }) };
  assert.deepEqual(permissionSync(cards, projects, null).projects, [{ root: '/Users/me/home', level: 'free' }]);
});

test('leads, the top lead among them, are left to their own guard', () => {
  const cards = { p1: card({ permissions: 'free', lead: { agentId: 'lead-a', model: '', notes: '' } }) };
  assert.deepEqual(permissionSync(cards, projects, { agentId: 'top' }).skip, ['lead-a', 'top']);
});

test('nothing on Run free hands over no projects, which takes the hook out', () => {
  assert.deepEqual(permissionSync({ p1: card() }, projects, null).projects, []);
});
