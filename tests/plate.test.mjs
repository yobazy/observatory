import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, field, hash, scatter, settle, workMode } from '../src/nebula/plate.ts';

test('a seed always picks the same figure', () => {
  assert.deepEqual(workMode('cart-sync', 3), workMode('cart-sync', 3));
  assert.equal(hash('a'), hash('a'));
  assert.notEqual(hash('a'), hash('b'));
});

test('each unit of work moves to a new figure, and visits every one before repeating', () => {
  const seen = new Set();
  for (let w = 0; w < MODES.length; w++) seen.add(workMode('thread', w).join());
  assert.equal(seen.size, MODES.length);
  assert.notDeepEqual(workMode('thread', 4), workMode('thread', 5));
});

test('negative or fractional work is read as whole units from 0', () => {
  assert.deepEqual(workMode('t', -3), workMode('t', 0));
  assert.deepEqual(workMode('t', 2.9), workMode('t', 2));
});

test('the field blends from one mode to the next', () => {
  const a = MODES[0], b = MODES[4];
  assert.deepEqual(field(a, b, 0, 0.3, 0.6), field(a, a, 1, 0.3, 0.6));
  assert.deepEqual(field(a, b, 1, 0.3, 0.6), field(b, b, 1, 0.3, 0.6));
  const mid = field(a, b, 0.5, 0.3, 0.6)[0];
  const ends = (field(a, a, 1, 0.3, 0.6)[0] + field(b, b, 1, 0.3, 0.6)[0]) / 2;
  assert.ok(Math.abs(mid - ends) < 1e-12);
});

test('scattered grains are the same for a seed and stay on the plate', () => {
  const g = scatter(500, 'x');
  assert.deepEqual(g, scatter(500, 'x'));
  assert.ok(g.every((v) => v >= 0 && v < 1));
});

test('settling gathers the sand onto the still lines and keeps it on the plate', () => {
  const mode = MODES[3];
  const g = scatter(2000, 'sand');
  const off = (grains) => {
    let sum = 0;
    for (let i = 0; i < grains.length; i += 2) sum += Math.abs(field(mode, mode, 1, grains[i], grains[i + 1])[0]);
    return sum / (grains.length / 2);
  };
  const before = off(g);
  let s = 7;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) settle(g, mode, mode, 1, 0.35, 0, random);
  assert.ok(off(g) < before / 5, `settled ${off(g)} from ${before}`);
  assert.ok(g.every((v) => v >= 0 && v <= 1));
});
