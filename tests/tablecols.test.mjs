import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_COL, resized } from '../src/nebula/tablecols.ts';

test('dragging an edge changes only that column', () => {
  assert.deepEqual(resized([60, 200, 80], 1, 45), [60, 245, 80]);
  assert.deepEqual(resized([60, 200, 80], 0, -10), [50, 200, 80]);
});

test('a column never drags narrower than the minimum', () => {
  assert.deepEqual(resized([60, 200], 0, -500), [MIN_COL, 200]);
});

test('widths stay whole pixels', () => {
  assert.deepEqual(resized([60.4, 99.6], 1, 0.3), [60.4, 100]);
});
