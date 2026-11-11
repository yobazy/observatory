import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { flash, getState } = await import('../src/nebula/store.ts');

const undo = { label: 'Undo', run: () => {} };

test("a plain notice doesn't wipe an Undo before it's due to go; a newer Undo does", () => {
  flash('Cleared 3 done tasks', 50, undo);
  flash('Approved the plan');
  assert.equal(getState().notice, 'Cleared 3 done tasks');
  assert.equal(getState().noticeAction, undo);

  const other = { label: 'Undo', run: () => {} };
  flash('Dismissed a batch of 5', 50, other);
  assert.equal(getState().notice, 'Dismissed a batch of 5');
  assert.equal(getState().noticeAction, other);
});

test('once the Undo has gone, a plain notice shows', async () => {
  flash('Cleared 1 done task', 20, undo);
  await new Promise((r) => setTimeout(r, 40));
  flash('Approved the plan', 20);
  assert.equal(getState().notice, 'Approved the plan');
  assert.equal(getState().noticeAction, null);
  await new Promise((r) => setTimeout(r, 40));
});
