// Copied from pixel-pets (github.com/yobazy/pixel-pets/src/brain.ts). Don't edit here: change pixel-pets, then run its sync.sh.
/**
 * The pet's behaviour: a little pixel animal living along a strip (its
 * "yard"). Pure functions of the critter and the yard's width, so it can be
 * simulated and tested; each app draws it its own way (any chills:
 * components/Critter.tsx). First written for Observatory's sidebar cat.
 */
import { FRAME_W, PACE, type CritterKind, type FrameName } from './frames.ts';

/** Points per frame pixel: 27×18 frames come out 36×24 pt. */
export const SCALE = 4 / 3;
export const CRITTER_W = FRAME_W * SCALE;
export const TICK_MS = 140;
/** Ticks a chase may spend not closing in on the ball before it loses interest (~8 s). */
const CHASE_PATIENCE = 60;
const BALL_W = 8;
/** The fly a frog hunts: how wide it is, the band it buzzes in (pt above the ground), and how long the frog keeps at it (~12 s). */
export const FLY_W = 10;
const FLY_LOW = 4;
const FLY_HIGH = 26;
/** It can only catch the fly with its tongue: low enough, and no further than this past its nose. */
const TONGUE_Y = 13;
const TONGUE_REACH = 9;
const HUNT_PATIENCE = 85;
const CATCH_CHANCE = 0.6;

export type Mode = 'walk' | 'sit' | 'sleep' | 'chase' | 'hunt' | 'alert' | 'party' | 'groom' | 'stretch';
export type Bubble = 'heart' | '!' | 'z' | 'note' | 'star' | null;

export type Critter = {
  x: number;
  dir: 1 | -1;
  mode: Mode;
  /** Ticks left in the current mode. */
  left: number;
  frame: FrameName;
  step: number;
  bubble: Bubble;
  bubbleLeft: number;
  ball: { x: number; v: number; bats: number } | null;
  /** A frog's fly: where it is (y is pt above the ground), its drift, misses so far, and whether it's leaving. */
  fly: { x: number; y: number; vx: number; misses: number; gone: boolean } | null;
  /** Ticks since anyone paid it attention (a tap, a mood). */
  idle: number;
  /** How far off the ground it is this tick, in pt (a frog mid-leap). */
  lift: number;
};

/** After this long with nothing happening (about 4 minutes) it winds down: longer naps, no ball. */
export const SLEEPY_AFTER = 1700;

export const START: Critter = {
  x: 12,
  dir: 1,
  mode: 'sit',
  left: 20,
  frame: 'sit',
  step: 0,
  bubble: null,
  bubbleLeft: 0,
  ball: null,
  fly: null,
  idle: 0,
  lift: 0,
};

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

/**
 * How an animal moves: its pace relative to the cat, what it plays with (a
 * ball for cats and dogs, a fly for frogs; turtles just plod), and whether it
 * hops instead of walking (frogs).
 */
export type Gait = { pace: number; toy: 'ball' | 'fly' | null; hops?: boolean };
export const CAT_GAIT: Gait = { pace: 1, toy: 'ball' };

export function gaitFor(kind: CritterKind): Gait {
  if (kind === 'turtle') return { pace: PACE[kind], toy: null };
  if (kind === 'frog') return { pace: PACE[kind], toy: 'fly', hops: true };
  return { pace: PACE[kind], toy: 'ball' };
}

/**
 * A frog's hop, a tick at a time (owner, 2026-10-25: "frogs leap instead of
 * walking"): it crouches, leaps in an arc (lift in pt), lands, and goes again.
 */
const HOP: { frame: FrameName; lift: number }[] = [
  { frame: 'stand', lift: 0 },
  { frame: 'stand', lift: 0 },
  { frame: 'walkB', lift: 4 },
  { frame: 'walkB', lift: 7 },
  { frame: 'walkB', lift: 7 },
  { frame: 'walkB', lift: 4 },
  { frame: 'stand', lift: 0 },
  { frame: 'stand', lift: 0 },
];
const AIR_TICKS = HOP.filter((h) => h.lift > 0).length;

/**
 * One tick of getting about at `speed` pt a tick. Walkers step every tick;
 * hoppers only move in the air, further, so they cover the same ground.
 */
export function stride(gait: Gait, t: number, speed: number): { frame: FrameName; lift: number; dx: number } {
  if (!gait.hops) return { frame: t % 2 ? 'walkA' : 'walkB', lift: 0, dx: speed };
  const hop = HOP[t % HOP.length];
  return { frame: hop.frame, lift: hop.lift, dx: hop.lift > 0 ? (speed * HOP.length) / AIR_TICKS : 0 };
}

/** Moves the critter one tick. */

export function step(c: Critter, width: number, gait: Gait = CAT_GAIT): Critter {
  const maxX = Math.max(0, width - CRITTER_W);
  // Whatever it's doing, it stays in the yard when the yard narrows.
  const n: Critter = { ...c, x: Math.min(c.x, maxX), step: c.step + 1, left: c.left - 1, idle: c.idle + 1, lift: 0 };
  if (n.bubbleLeft > 0) n.bubbleLeft -= 1;
  else if (n.bubble !== 'z') n.bubble = null;

  // The ball rolls on its own, slowing, bouncing off the ends.
  if (n.ball) {
    let { x, v } = n.ball;
    x += v;
    v *= 0.86;
    if (x < 0 || x > width - BALL_W) {
      v = -v;
      x = Math.max(0, Math.min(width - BALL_W, x));
    }
    n.ball = { ...n.ball, x, v: Math.abs(v) < 0.3 ? 0 : v };
  }

  // The fly buzzes about on its own, drifting and bobbing; once it's leaving it just goes up and away.
  if (n.fly) {
    let { x, y, vx } = n.fly;
    if (n.fly.gone) {
      x += vx;
      y += 3;
    } else {
      vx = Math.max(-3, Math.min(3, vx + (Math.random() - 0.5) * 1.8));
      x += vx;
      if (x < 0 || x > width - FLY_W) {
        vx = -vx;
        x = Math.max(0, Math.min(width - FLY_W, x));
      }
      y = Math.max(FLY_LOW, Math.min(FLY_HIGH, y + (Math.random() - 0.5) * 5));
    }
    n.fly = y > FLY_HIGH + 30 ? null : { ...n.fly, x, y, vx };
  }

  switch (n.mode) {
    case 'walk': {
      const s = stride(gait, n.step, 1.6 * gait.pace);
      n.x += s.dx * n.dir;
      // Turn at the end it's heading into (a frog waiting at an end isn't walking into it).
      if ((n.x <= 0 && n.dir === -1) || (n.x >= maxX && n.dir === 1)) {
        n.x = Math.max(0, Math.min(maxX, n.x));
        n.dir = n.dir === 1 ? -1 : 1;
      }
      n.frame = s.frame;
      n.lift = s.lift;
      // A frog finishes its leap before doing anything else.
      if (n.left <= 0 && n.lift === 0) return pickNext(n, width, Math.random(), gait);
      return n;
    }
    case 'chase': {
      if (!n.ball || n.left <= 0) return pickNext(n, width, Math.random(), gait);
      const ball = n.ball.x + BALL_W / 2;
      const mid = n.x + CRITTER_W / 2;
      // Turn by the body's middle, and only once the ball is clearly on the other side.
      if (ball > mid + 4) n.dir = 1;
      else if (ball < mid - 4) n.dir = -1;
      const nose = n.x + (n.dir === 1 ? CRITTER_W - 4 : 4);
      const ahead = (ball - nose) * n.dir;
      const canMove = Math.max(0, Math.min(maxX, n.x + 3 * gait.pace * n.dir)) !== n.x;
      // Mid-leap, a frog lands before it bats.
      if ((ahead > 6 && canMove) || c.lift > 0) {
        const s = stride(gait, n.step, 3 * gait.pace);
        n.x = Math.max(0, Math.min(maxX, n.x + s.dx * n.dir));
        n.frame = s.frame;
        n.lift = s.lift;
        n.left = c.left; // closing in is progress
      } else if (Math.abs(n.ball.v) < 1) {
        // Bat it away, with a little randomness.
        n.frame = 'pounce';
        const bats = n.ball.bats + 1;
        n.ball = { ...n.ball, v: n.dir * rand(7, 13), bats };
        n.left = CHASE_PATIENCE;
        if (bats >= rand(3, 5)) {
          n.mode = 'sit';
          n.left = rand(20, 40);
        }
      } else {
        n.frame = 'stand';
      }
      return n;
    }
    case 'hunt': {
      if (!n.fly || n.fly.gone) return pickNext(n, width, Math.random(), gait);
      if (n.left <= 0) {
        // It gives up; the fly wanders off.
        n.fly = { ...n.fly, gone: true };
        return { ...n, mode: 'sit', left: rand(20, 40), frame: 'stand' };
      }
      const fly = n.fly.x + FLY_W / 2;
      const mid = n.x + CRITTER_W / 2;
      // Turn only on the ground, and only once the fly is clearly on the other side.
      if (c.lift === 0) {
        if (fly > mid + 4) n.dir = 1;
        else if (fly < mid - 4) n.dir = -1;
      }
      const nose = n.x + (n.dir === 1 ? CRITTER_W - 4 : 4);
      const ahead = (fly - nose) * n.dir;
      const canMove = Math.max(0, Math.min(maxX, n.x + 3 * gait.pace * n.dir)) !== n.x;
      if (c.lift === 0 && ahead >= -2 && ahead <= TONGUE_REACH && n.fly.y <= TONGUE_Y) {
        // Tongue out.
        n.frame = 'pounce';
        if (Math.random() < CATCH_CHANCE) {
          return { ...n, fly: null, mode: 'sit', left: rand(20, 40), bubble: 'heart', bubbleLeft: 12 };
        }
        const misses = n.fly.misses + 1;
        // Missed: the fly darts off up and away from the tongue, and after a few misses it's gone for good.
        n.fly = { ...n.fly, misses, vx: n.dir * rand(3, 5), y: FLY_HIGH, gone: misses >= 3 };
        if (misses >= 3) return { ...n, mode: 'sit', left: rand(20, 40) };
        return n;
      }
      if ((ahead > TONGUE_REACH && canMove) || c.lift > 0) {
        const s = stride(gait, n.step, 3 * gait.pace);
        n.x = Math.max(0, Math.min(maxX, n.x + s.dx * n.dir));
        n.frame = s.frame;
        n.lift = s.lift;
      } else {
        // Waiting under it, watching.
        n.frame = n.fly.y > TONGUE_Y + 6 ? 'lookUp' : 'stand';
      }
      return n;
    }
    case 'party': {
      // Hops in place, turning now and then (a frog really leaves the ground).
      n.frame = n.step % 4 < 2 ? (gait.hops ? 'walkB' : 'pounce') : 'stand';
      if (gait.hops && n.step % 4 < 2) n.lift = 6;
      if (n.step % 4 === 0) n.dir = n.dir === 1 ? -1 : 1;
      if (n.left <= 0) return { ...pickNext(n, width, Math.random(), gait), bubble: null };
      return n;
    }
    case 'sit':
    case 'alert': {
      n.frame = n.mode === 'alert' ? 'lookUp' : n.step % 23 === 0 ? 'blink' : 'sit';
      if (n.left <= 0) return pickNext(n, width, Math.random(), gait);
      return n;
    }
    case 'groom': {
      n.frame = Math.floor(n.step / 3) % 2 ? 'groomB' : 'groomA';
      if (n.left <= 0) return pickNext(n, width, Math.random(), gait);
      return n;
    }
    case 'stretch': {
      n.frame = 'stretch';
      if (n.left <= 0) return { ...n, mode: 'sit', left: rand(15, 30), frame: 'stand' };
      return n;
    }
    case 'sleep': {
      n.frame = 'sleep';
      n.bubble = 'z';
      if (n.left <= 0) {
        n.bubble = null;
        return pickNext(n, width, Math.random(), gait);
      }
      return n;
    }
  }
}

/** What the critter does next; `r` (0 to 1) picks, so tests can choose. */
export function pickNext(c: Critter, width: number, r = Math.random(), gait: Gait = CAT_GAIT): Critter {
  // A fly that's already leaving finishes flying off.
  const idle = { ...c, ball: null, fly: c.fly?.gone ? c.fly : null };
  // Left alone for a while, it winds down: mostly naps (long ones), a sit or a groom, no ball.
  if (c.idle > SLEEPY_AFTER) {
    if (r < 0.6) return { ...idle, mode: 'sleep', left: rand(240, 520) };
    if (r < 0.85) return { ...idle, mode: 'sit', left: rand(40, 90) };
    return { ...idle, mode: 'groom', left: rand(18, 36) };
  }
  if (r < 0.22 && width > 120 && gait.toy === 'fly') {
    const x = rand(0, Math.max(0, width - FLY_W));
    return { ...idle, mode: 'hunt', left: HUNT_PATIENCE, fly: { x, y: FLY_HIGH, vx: 0, misses: 0, gone: false } };
  }
  if (r < 0.22 && width > 120 && gait.toy === 'ball') {
    return { ...idle, mode: 'chase', left: CHASE_PATIENCE, ball: { x: rand(0, Math.max(0, width - BALL_W)), v: 0, bats: 0 } };
  }
  if (r < 0.5) return { ...idle, mode: 'walk', left: Math.round(rand(20, 60) / Math.max(gait.pace, 0.3)), dir: Math.random() < 0.5 ? 1 : -1 };
  if (r < 0.68) return { ...idle, mode: 'sit', left: rand(25, 60) };
  if (r < 0.8) return { ...idle, mode: 'groom', left: rand(18, 36) };
  if (r < 0.86) return { ...idle, mode: 'stretch', left: rand(8, 14) };
  return { ...idle, mode: 'sleep', left: rand(80, 220) };
}

/** Something happened in the app; the critter reacts. */
export type Mood = 'heart' | 'party' | 'alert' | 'happy';

export function react(c: Critter, mood: Mood): Critter {
  const roused = { ...c, idle: 0 };
  const awake = roused.mode === 'sleep' ? { ...roused, mode: 'sit' as Mode, left: 30, bubble: null } : roused;
  switch (mood) {
    case 'heart':
      return { ...awake, bubble: 'heart', bubbleLeft: 12 };
    case 'party':
      return { ...awake, mode: 'party', left: 28, ball: null, fly: null, bubble: 'star', bubbleLeft: 28 };
    case 'alert':
      return c.mode === 'party' ? c : { ...awake, mode: 'alert', left: 30, ball: null, fly: null, bubble: '!', bubbleLeft: 20 };
    case 'happy':
      return { ...awake, bubble: 'note', bubbleLeft: 14 };
  }
}

// A tiny mood bus: anything in the app can nudge the critter without knowing where it lives.
type Listener = (mood: Mood) => void;
const listeners = new Set<Listener>();

export function critterMood(mood: Mood) {
  for (const l of listeners) l(mood);
}

export function onCritterMood(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Which animal, which coat, its name; `lastKind` keeps the animal while it's switched off. */
export type CritterSetting = { kind: CritterKind | 'off'; coat: string; name?: string; lastKind?: CritterKind };
export const DEFAULT_CRITTER: CritterSetting = { kind: 'cat', coat: 'orange' };
