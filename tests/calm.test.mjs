import test from 'node:test';
import assert from 'node:assert/strict';
import { PATIENCE, remember, settle, smooth } from '../src/nebula/calm.ts';

const m = (o) => new Map(Object.entries(o));
const margin = { rel: 0.2, abs: 2 };
const start = (order) => ({ order, ahead: new Map() });

test('smoothing moves part of the way to each new read', () => {
  const a = smooth(new Map(), m({ x: 100 }));
  assert.equal(a.get('x'), 100);
  const b = smooth(a, m({ x: 0, y: 5 }));
  assert.equal(b.get('x'), 60);
  assert.equal(b.get('y'), 5);
  assert.ok(!smooth(b, m({ y: 5 })).has('x'));
});

test('new rows land by value; the first read is just sorted', () => {
  assert.deepEqual(settle(start([]), m({ a: 1, b: 9, c: 5 }), margin).order, ['b', 'c', 'a']);
  assert.deepEqual(settle(start(['b', 'a']), m({ a: 1, b: 9, c: 5 }), margin).order, ['b', 'c', 'a']);
});

test('a small lead leaves the order alone', () => {
  // b is ahead of a, but by less than the margin.
  const r = settle(start(['a', 'b']), m({ a: 50, b: 55 }), margin);
  assert.deepEqual(r.order, ['a', 'b']);
});

test('a clear lead moves a row up at once, past several', () => {
  const r = settle(start(['a', 'b', 'c']), m({ a: 10, b: 9, c: 80 }), margin);
  assert.deepEqual(r.order, ['c', 'a', 'b']);
});

test('a small lead that lasts moves it up after a few reads', () => {
  let r = start(['a', 'b']);
  for (let i = 1; i < PATIENCE; i++) {
    r = settle(r, m({ a: 50, b: 55 }), margin);
    assert.deepEqual(r.order, ['a', 'b'], `read ${i}`);
  }
  r = settle(r, m({ a: 50, b: 55 }), margin);
  assert.deepEqual(r.order, ['b', 'a']);
});

test('a lead that comes and goes never adds up', () => {
  let r = start(['a', 'b']);
  for (let i = 0; i < 10; i++) r = settle(r, m({ a: 50, b: i % 2 ? 55 : 45 }), margin);
  assert.deepEqual(r.order, ['a', 'b']);
});

test('the absolute floor keeps tiny numbers from shuffling', () => {
  // 0.9 is triple 0.3, but under 2 points ahead.
  assert.deepEqual(settle(start(['a', 'b']), m({ a: 0.3, b: 0.9 }), margin).order, ['a', 'b']);
});

test('gone rows go; history keeps the last n reads', () => {
  assert.deepEqual(settle(start(['a', 'b']), m({ b: 1 }), margin).order, ['b']);
  let h = new Map();
  for (let i = 0; i < 25; i++) h = remember(h, m({ x: i }), 20);
  assert.equal(h.get('x').length, 20);
  assert.equal(h.get('x')[19], 24);
});
