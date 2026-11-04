// The night blue follows the clock: a touch lighter in the afternoon,
// violet at dusk, deepest before dawn. Slow and slight, so it's felt more
// than seen. Only the default dark mode moves; black and light stay put.

/** Minutes after midnight, and the sky's color then. */
const SKY: [minute: number, rgb: [number, number, number]][] = [
  [0, [15, 19, 32]],
  [240, [11, 14, 25]],
  [360, [18, 22, 37]],
  [600, [19, 25, 41]],
  [960, [21, 28, 45]],
  [1140, [27, 22, 42]],
  [1260, [18, 20, 35]],
  [1440, [15, 19, 32]],
];

/** The sky at `minute` (0 to 1440), blended between the stops. */
export function skyAt(minute: number): [number, number, number] {
  const m = ((minute % 1440) + 1440) % 1440;
  for (let i = 1; i < SKY.length; i++) {
    const [b, cb] = SKY[i];
    if (m > b) continue;
    const [a, ca] = SKY[i - 1];
    const k = (m - a) / (b - a);
    return ca.map((v, j) => Math.round(v + (cb[j] - v) * k)) as [number, number, number];
  }
  return SKY[0][1];
}

const hex = (c: [number, number, number], d = 0) =>
  "#" + c.map((v) => Math.max(0, Math.min(255, v + d)).toString(16).padStart(2, "0")).join("");

/** The surfaces the sky colors: the window (night), panels a step up, and
 *  the terminal a step down, as the fixed palette has them. */
export function skyTokens(minute: number): Record<string, string> {
  const c = skyAt(minute);
  return { "--night": hex(c), "--panel": hex(c, 3), "--term": hex(c, -2) };
}

/** Paints the sky now and every few minutes after, until the returned
 *  stop, which puts the fixed palette back. For the default dark mode only. */
export function followClock(): () => void {
  const root = document.documentElement;
  const paint = () => {
    const d = new Date();
    for (const [k, v] of Object.entries(skyTokens(d.getHours() * 60 + d.getMinutes()))) root.style.setProperty(k, v);
  };
  paint();
  const t = setInterval(paint, 5 * 60_000);
  return () => {
    clearInterval(t);
    for (const k of Object.keys(skyTokens(0))) root.style.removeProperty(k);
  };
}
