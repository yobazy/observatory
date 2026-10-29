// The sidebar cat's behavior, apart from its drawing (Pet.tsx): pure
// functions of the cat and the yard's width, so it can be simulated.

export type Frame =
  | "stand"
  | "walkA"
  | "walkB"
  | "sit"
  | "blink"
  | "pounce"
  | "sleep"
  | "gazeA"
  | "gazeB"
  | "groomA"
  | "groomB"
  | "stretch"
  | "lookUp"
  | "typeA"
  | "typeB"
  | "readA"
  | "readB";

export const W = 18;
export const H = 12;
export const SCALE = 2;
export const CAT_W = W * SCALE;
export const TICK_MS = 140;
/** Ticks a chase may spend not closing in on the yarn (waiting, or stuck)
 *  before the cat loses interest (~8s), so whatever goes wrong it never
 *  loops in place for long. Reset per bat. */
const CHASE_PATIENCE = 60;
/** The telescope stands this far right of the cat's left edge, its
 *  eyepiece at the cat's eye, and is this wide (both px). */
export const SCOPE_AT = CAT_W - 4;
export const SCOPE_W = 32;
/** A falling star starts this high over the ground (px) and falls this fast. */
const STAR_FROM = 30;
const STAR_FALL = 1.1;

export type Mode = "walk" | "sit" | "sleep" | "chase" | "alert" | "party" | "gaze" | "groom" | "stretch" | "catch";

export interface Cat {
  x: number;
  dir: 1 | -1;
  mode: Mode;
  /** Ticks left in the current mode. */
  left: number;
  frame: Frame;
  step: number;
  bubble: "heart" | "!" | "z" | "note" | "star" | "sweat" | null;
  bubbleLeft: number;
  ball: { x: number; v: number; bats: number } | null;
  /** A star falling into the yard, for the cat to catch: x from the left,
   *  y over the ground (px). */
  star?: { x: number; y: number; drift: number } | null;
}

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

/** Moves a cat one tick. Pure, so the whole behavior reads in one place. */
export function step(c: Cat, width: number): Cat {
  const maxX = Math.max(0, width - CAT_W);
  // Whatever it's doing, it stays in the yard when the sidebar narrows.
  const n: Cat = { ...c, x: Math.min(c.x, maxX), step: c.step + 1, left: c.left - 1 };
  if (n.bubbleLeft > 0) n.bubbleLeft -= 1;
  else if (n.bubble !== "z") n.bubble = null;

  // The ball rolls on its own, slowing, bouncing off the ends.
  if (n.ball) {
    let { x, v } = n.ball;
    x += v;
    v *= 0.86;
    if (x < 0 || x > width - 8) {
      v = -v;
      x = Math.max(0, Math.min(width - 8, x));
    }
    n.ball = { ...n.ball, x, v: Math.abs(v) < 0.3 ? 0 : v };
  }

  switch (n.mode) {
    case "walk": {
      n.x += 1.6 * n.dir;
      if (n.x <= 0 || n.x >= maxX) {
        n.x = Math.max(0, Math.min(maxX, n.x));
        n.dir = n.dir === 1 ? -1 : 1;
      }
      n.frame = n.step % 2 ? "walkA" : "walkB";
      if (n.left <= 0) return pickNext(n, width);
      return n;
    }
    case "chase": {
      if (!n.ball || n.left <= 0) return pickNext(n, width);
      const ball = n.ball.x + 4; // the yarn's center
      const mid = n.x + CAT_W / 2;
      // Turn by the body's middle, and only once the yarn is clearly on the
      // other side. Turning by the nose, which jumps a body length on each
      // turn, flipped the cat back and forth every tick with yarn underfoot.
      if (ball > mid + 4) n.dir = 1;
      else if (ball < mid - 4) n.dir = -1;
      const nose = n.x + (n.dir === 1 ? CAT_W - 4 : 4);
      // How far ahead of the nose the yarn is; underfoot counts as in reach.
      const ahead = (ball - nose) * n.dir;
      const nextX = Math.max(0, Math.min(maxX, n.x + 3 * n.dir));
      if (ahead > 6 && nextX !== n.x) {
        n.x = nextX;
        n.frame = n.step % 2 ? "walkA" : "walkB";
        // Closing in is progress: patience only runs down while it isn't,
        // so a long run across the yard doesn't end in giving up.
        n.left = c.left;
      } else if (Math.abs(n.ball.v) < 1) {
        // Bat it: away from the cat, with a little randomness.
        n.frame = "pounce";
        const bats = n.ball.bats + 1;
        n.ball = { ...n.ball, v: n.dir * rand(7, 13), bats };
        n.left = CHASE_PATIENCE;
        if (bats >= rand(3, 5)) {
          n.mode = "sit";
          n.left = rand(20, 40);
        }
      } else {
        // In reach but still rolling: wait for it.
        n.frame = "stand";
      }
      return n;
    }
    case "party": {
      // Hops in place: a pounce, then back on its feet.
      n.frame = n.step % 4 < 2 ? "pounce" : "stand";
      if (n.step % 4 === 0) n.dir = n.dir === 1 ? -1 : 1;
      if (n.left <= 0) return { ...pickNext(n, width), bubble: null };
      return n;
    }
    case "sit":
    case "alert": {
      n.frame = n.mode === "sit" && n.step % 23 === 0 ? "blink" : "sit";
      if (n.left <= 0) return pickNext(n, width);
      return n;
    }
    case "gaze": {
      // At the telescope, facing right, toward the terminal; the tail now
      // and then.
      n.dir = 1;
      n.x = Math.min(n.x, Math.max(0, width - SCOPE_AT - SCOPE_W));
      n.frame = n.step % 20 < 2 ? "gazeB" : "gazeA";
      if (n.left <= 0) return pickNext(n, width);
      return n;
    }
    case "groom": {
      n.frame = Math.floor(n.step / 3) % 2 ? "groomB" : "groomA";
      if (n.left <= 0) return pickNext(n, width);
      return n;
    }
    case "stretch": {
      n.frame = "stretch";
      if (n.left <= 0) return { ...n, mode: "sit", left: rand(15, 30), frame: "stand" };
      return n;
    }
    case "catch": {
      const star = n.star;
      if (!star || n.left <= 0) return { ...pickNext(n, width), star: null };
      const s = { ...star, y: star.y - STAR_FALL, x: Math.max(0, Math.min(width - 6, star.x + star.drift)) };
      const mid = n.x + CAT_W / 2;
      if (s.x + 3 > mid + 4) n.dir = 1;
      else if (s.x + 3 < mid - 4) n.dir = -1;
      const nose = n.x + (n.dir === 1 ? CAT_W - 4 : 4);
      const near = Math.abs(s.x + 3 - nose) < 12;
      if (s.y <= 14 && near) {
        // Caught: a sparkle, then a sit to admire it.
        return { ...n, star: null, frame: "pounce", mode: "sit", left: rand(20, 35), bubble: "star", bubbleLeft: 10 };
      }
      if (s.y <= 0) return { ...n, star: null, mode: "sit", left: rand(15, 30), frame: "sit" };
      // Get under it while it falls, then wait, looking up.
      if (Math.abs(s.x + 3 - nose) > 6) {
        n.x = Math.max(0, Math.min(maxX, n.x + 1.6 * n.dir));
        n.frame = n.step % 2 ? "walkA" : "walkB";
      } else n.frame = "lookUp";
      n.star = s;
      return n;
    }
    case "sleep": {
      n.frame = "sleep";
      n.bubble = "z";
      if (n.left <= 0) {
        n.bubble = null;
        return pickNext(n, width);
      }
      return n;
    }
  }
}

/** What the cat does next; `r` (0 to 1) picks, so tests can choose. */
export function pickNext(c: Cat, width: number, r = Math.random()): Cat {
  const idle = { ...c, ball: null, star: null };
  if (r < 0.24 && width > 120) {
    // Toss the yarn somewhere and go after it.
    return { ...idle, mode: "chase", left: CHASE_PATIENCE, ball: { x: rand(0, Math.max(0, width - 8)), v: 0, bats: 0 } };
  }
  if (r < 0.48) return { ...idle, mode: "walk", left: rand(20, 60), dir: Math.random() < 0.5 ? 1 : -1 };
  if (r < 0.62) return { ...idle, mode: "sit", left: rand(25, 60) };
  if (r < 0.74 && width >= SCOPE_AT + SCOPE_W + 8) {
    // Stargazing, where the telescope fits on its right.
    return { ...idle, mode: "gaze", dir: 1, x: Math.min(c.x, width - SCOPE_AT - SCOPE_W), left: rand(45, 110) };
  }
  if (r < 0.82) return { ...idle, mode: "groom", left: rand(18, 36) };
  if (r < 0.87) return { ...idle, mode: "stretch", left: rand(8, 14) };
  if (r < 0.92 && width > 100) {
    // A star falls somewhere ahead of it.
    const x = Math.max(0, Math.min(width - 6, c.x + CAT_W / 2 + rand(-40, 40)));
    return { ...idle, mode: "catch", left: 80, star: { x, y: STAR_FROM, drift: (Math.random() - 0.5) * 0.6 } };
  }
  return { ...idle, mode: "sleep", left: rand(80, 220) };
}
