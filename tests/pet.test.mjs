import test from 'node:test';
import assert from 'node:assert/strict';
import { CAT_W, H, SCOPE_AT, SCOPE_W, W, pickNext, step } from '../src/components/petBrain.ts';
import { FRAMES, TELESCOPE, TELESCOPE_W } from '../src/components/petFrames.ts';

const cat = (over = {}) => ({ x: 20, dir: -1, mode: 'sit', left: 20, frame: 'sit', step: 0, bubble: null, bubbleLeft: 0, ball: null, ...over });

test('every frame, and the telescope, is the size the sprite draws', () => {
  for (const [name, rows] of Object.entries(FRAMES)) {
    assert.equal(rows.length, H, name);
    for (const r of rows) assert.equal(r.length, W, `${name}: ${r}`);
  }
  assert.equal(TELESCOPE.length, H);
  for (const r of TELESCOPE) assert.equal(r.length, TELESCOPE_W);
  assert.equal(SCOPE_W, TELESCOPE_W * 2);
});

test("the telescope points right, its eyepiece at the cat's eye", () => {
  // The eyepiece is the leftmost pixel of the tube, in the rows of the eyes.
  const eyeRow = FRAMES.gazeA.findIndex((r) => r.includes('K'));
  assert.equal(TELESCOPE[eyeRow][0], 'E');
  // The hood, the far end, is at the right.
  assert.ok(TELESCOPE[0].trimEnd().endsWith('H') && !TELESCOPE[0].startsWith('H'));
  // And it stands where the cat's face ends.
  assert.equal(SCOPE_AT, CAT_W - 4);
});

test('stargazing faces right, with room for the telescope', () => {
  const width = 200;
  const c = pickNext(cat({ x: 190 }), width, 0.7);
  assert.equal(c.mode, 'gaze');
  assert.equal(c.dir, 1);
  assert.ok(c.x + SCOPE_AT + SCOPE_W <= width);
  // A sidebar too narrow for it doesn't get it.
  assert.notEqual(pickNext(cat(), SCOPE_AT + SCOPE_W, 0.7).mode, 'gaze');
});

test('a falling star is caught or lands, never left hanging', () => {
  let caught = 0;
  for (let trial = 0; trial < 50; trial++) {
    let c = pickNext(cat({ x: 60 }), 220, 0.9);
    assert.equal(c.mode, 'catch');
    let ticks = 0;
    while (c.star && ticks < 200) {
      c = step(c, 220);
      ticks++;
    }
    assert.ok(!c.star, `still falling after ${ticks} ticks`);
    assert.ok(ticks < 80, `took ${ticks} ticks`);
    if (c.bubble === 'star') caught++;
  }
  // It gets under the star while it falls, so it nearly always catches it.
  assert.ok(caught >= 40, `caught ${caught} of 50`);
});

test('grooming and stretching end on their own', () => {
  // When one ends, the next pick is random and can be the same mode again,
  // so pin the next pick to a walk.
  const random = Math.random;
  try {
    Math.random = () => 0.1;
    for (const r of [0.78, 0.85]) {
      let c = pickNext(cat(), 220, r);
      const mode = c.mode;
      assert.ok(mode === 'groom' || mode === 'stretch', mode);
      for (let i = 0; i < 60 && c.mode === mode; i++) c = step(c, 220);
      assert.notEqual(c.mode, mode);
    }
  } finally {
    Math.random = random;
  }
});
