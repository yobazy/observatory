import test from 'node:test';
import assert from 'node:assert/strict';
import { sandFill } from '../src/nebula/plate.ts';
import { skyAt, skyTokens, skyWell } from '../src/nebula/sky.ts';
import { warmth } from '../src/nebula/warmth.ts';

test('a plate holds more sand the more turns its thread has taken', () => {
  const big = [2, 10, 40, 120].map((t) => sandFill(t, false));
  for (let i = 1; i < big.length; i++) assert.ok(big[i] > big[i - 1]);
  assert.ok(big[0] < 0.1, 'a new thread is a few grains');
  assert.ok(big[3] > 0.8, 'a long one is nearly full');
  assert.ok(sandFill(1e6, false) <= 1);
  assert.ok(sandFill(0, true) >= 0.3, 'a row-sized plate still reads as a dot');
  assert.equal(sandFill(-5, false), sandFill(0, false));
});

test('the sky is deepest before dawn, lighter in the afternoon, and violet at dusk', () => {
  const lum = ([r, g, b]) => r + g + b;
  assert.ok(lum(skyAt(4 * 60)) < lum(skyAt(0)));
  assert.ok(lum(skyAt(16 * 60)) > lum(skyAt(0)));
  const [r, , b] = skyAt(19 * 60);
  assert.ok(r > skyAt(16 * 60)[0], 'dusk leans red');
  assert.ok(b > r);
  // Midnight comes round to where it started, and out-of-range minutes wrap.
  assert.deepEqual(skyAt(1440), skyAt(0));
  assert.deepEqual(skyAt(-60), skyAt(23 * 60));
  assert.match(skyTokens(600)['--night'], /^#[0-9a-f]{6}$/);
});

test('a waiting thread warms the longer it waits', () => {
  const now = 10 * 3600_000;
  const min = 60_000;
  assert.equal(warmth('running', now - 90 * min, now), 0);
  assert.equal(warmth('needs_feedback', now - 1 * min, now), 1);
  assert.equal(warmth('needs_feedback', now - 10 * min, now), 2);
  assert.equal(warmth('needs_feedback', now - 35 * min, now), 3);
  assert.equal(warmth('needs_feedback', now - 2 * 60 * min, now), 4);
});

test("the terminal's well is --term darkened, as the stylesheet mixes it", () => {
  for (const minute of [0, 240, 600, 1140]) {
    const term = skyTokens(minute)['--term'].slice(1).match(/../g).map((h) => parseInt(h, 16));
    const well = skyWell(minute).slice(1).match(/../g).map((h) => parseInt(h, 16));
    term.forEach((v, i) => assert.ok(Math.abs(well[i] - v * 0.7) <= 0.5, `${minute}: ${term} -> ${well}`));
  }
});
