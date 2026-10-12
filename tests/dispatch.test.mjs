import test from 'node:test';
import assert from 'node:assert/strict';

/** A localStorage stand-in: what's saved survives a "reload" of the store. */
function stubStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}
globalThis.localStorage = stubStorage();

const { parseList, pasteList, toggleItem, dispatchItems, reloadItems, loadItems } = await import('../src/nebula/dispatch.ts');

test('blank lines are dropped and indented lines attach to the item above', () => {
  assert.deepEqual(parseList('a\n  ctx for a\nb\n\n'), [
    { text: 'a', context: ['ctx for a'] },
    { text: 'b', context: [] },
  ]);
});

test('an indented line with no item above it is an item of its own', () => {
  assert.deepEqual(parseList('\n   orphan\n\tdetail\nnext'), [
    { text: 'orphan', context: ['detail'] },
    { text: 'next', context: [] },
  ]);
});

test('list markers and checkboxes are dropped from pasted lines', () => {
  assert.deepEqual(parseList('- [ ] go to the gym\n* update my resume\n  - the Akkodis one\n1. message Roger\n• done'), [
    { text: 'go to the gym', context: [] },
    { text: 'update my resume', context: ['the Akkodis one'] },
    { text: 'message Roger', context: [] },
    { text: 'done', context: [] },
  ]);
});

test('Windows line endings parse the same', () => {
  assert.deepEqual(parseList('a\r\n  why\r\nb\r\n'), [
    { text: 'a', context: ['why'] },
    { text: 'b', context: [] },
  ]);
});

test('saved items come back after a reload with the same ids and checked state', () => {
  localStorage.clear();
  reloadItems();
  assert.equal(pasteList('go to the gym\napply to some jobs\n  career-ops\nupdate my resume'), 3);
  const before = dispatchItems();
  assert.equal(new Set(before.map((i) => i.id)).size, 3, 'every item has its own id');
  toggleItem(before[1].id);

  reloadItems();
  const after = dispatchItems();
  assert.deepEqual(after, dispatchItems());
  assert.deepEqual(
    after.map(({ id, text, context, checked }) => ({ id, text, context, checked })),
    [
      { id: before[0].id, text: 'go to the gym', context: [], checked: false },
      { id: before[1].id, text: 'apply to some jobs', context: ['career-ops'], checked: true },
      { id: before[2].id, text: 'update my resume', context: [], checked: false },
    ],
  );
});

test('a second paste adds to the list rather than replacing it', () => {
  localStorage.clear();
  reloadItems();
  pasteList('a');
  pasteList('b\nc');
  assert.deepEqual(loadItems().map((i) => i.text), ['a', 'b', 'c']);
});

test('unreadable storage starts an empty list', () => {
  localStorage.setItem('observatory.dispatch', '{not json');
  assert.deepEqual(loadItems(), []);
  localStorage.setItem('observatory.dispatch', JSON.stringify({ items: [{ id: 'x', text: 'ok', context: [], checked: true, at: 1 }, { nope: 1 }] }));
  assert.deepEqual(loadItems().map((i) => i.id), ['x']);
});
