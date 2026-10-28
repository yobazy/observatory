// Chladni plates: sand on a vibrating plate settles along the lines that
// stay still, the nodal lines of `field` below. Each thread's figure is
// picked by what it has done so far, so the picture is made by the work
// (Plate.tsx draws it).

/** A vibration mode of a square plate: its two wave numbers. */
export type Mode = readonly [number, number];

/** Modes that give clear figures at every size we draw. */
export const MODES: readonly Mode[] = [
  [1, 3],
  [2, 3],
  [1, 4],
  [2, 5],
  [3, 4],
  [3, 5],
  [1, 5],
  [2, 7],
  [4, 5],
  [3, 7],
  [5, 6],
  [4, 7],
  [1, 6],
  [3, 8],
];

/** FNV-1a: the same string always picks the same figure. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The figure for something that has done `work` units of it: each unit
 *  (a prompt, a tool call) moves it to the next figure in its own order. 5
 *  shares no factor with the 14 modes, so it visits every one before
 *  repeating. */
export function workMode(seed: string, work: number): Mode {
  return MODES[(hash(seed) + Math.max(0, Math.floor(work)) * 5) % MODES.length];
}

/** The plate's displacement at (x, y) in [0, 1]², and its gradient, blended
 *  `k` of the way from mode `a` to mode `b`. Sand collects where it is 0. */
export function field(a: Mode, b: Mode, k: number, x: number, y: number): [number, number, number] {
  const X = Math.PI * x;
  const Y = Math.PI * y;
  const one = ([n, m]: Mode): [number, number, number] => {
    const cnx = Math.cos(n * X), cmy = Math.cos(m * Y), cmx = Math.cos(m * X), cny = Math.cos(n * Y);
    const snx = Math.sin(n * X), smy = Math.sin(m * Y), smx = Math.sin(m * X), sny = Math.sin(n * Y);
    return [
      cnx * cmy - cmx * cny,
      Math.PI * (-n * snx * cmy + m * smx * cny),
      Math.PI * (-m * cnx * smy + n * cmx * sny),
    ];
  };
  if (k >= 1 || (a[0] === b[0] && a[1] === b[1])) return one(b);
  const p = one(a);
  const q = one(b);
  return [(1 - k) * p[0] + k * q[0], (1 - k) * p[1] + k * q[1], (1 - k) * p[2] + k * q[2]];
}

/** `count` grains scattered evenly, the same way every time for a seed. */
export function scatter(count: number, seed: string): Float32Array {
  let s = hash(seed) || 1;
  const grains = new Float32Array(count * 2);
  for (let i = 0; i < grains.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    grains[i] = (s >>> 0) / 4294967296;
  }
  return grains;
}

/** One step of settling: every grain moves toward the nearest still line
 *  (a Newton step on the field), plus a shake. `rate` near 0.35 snaps grains
 *  onto thin lines; lower rates and more shake leave the wider, grainy bands
 *  a big plate looks best with. */
export function settle(
  grains: Float32Array,
  a: Mode,
  b: Mode,
  k: number,
  rate: number,
  shake: number,
  random: () => number = Math.random,
) {
  for (let i = 0; i < grains.length; i += 2) {
    let x = grains[i];
    let y = grains[i + 1];
    const [v, gx, gy] = field(a, b, k, x, y);
    const g2 = gx * gx + gy * gy + 1e-3;
    const r = Math.min(1, Math.abs(v) * 2) * 0.012 + shake;
    x -= (rate * v * gx) / g2 + (random() - 0.5) * r;
    y -= (rate * v * gy) / g2 + (random() - 0.5) * r;
    // Grains that would fall off an edge bounce back onto the plate.
    grains[i] = x < 0 ? -x : x > 1 ? 2 - x : x;
    grains[i + 1] = y < 0 ? -y : y > 1 ? 2 - y : y;
  }
}
