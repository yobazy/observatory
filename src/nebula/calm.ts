// Keeping a list that's read every few seconds calm: numbers smoothed so
// they don't flicker, and an order that only changes when it means
// something. The Activity view uses it for projects and their processes.
// Pure, so its tests run under Node.

/** How far a smoothed value moves toward each new sample. */
const ALPHA = 0.4;

/** Each key's value, smoothed over the samples so far (an exponential
 *  moving average). Keys not in the latest sample are dropped. */
export function smooth(prev: Map<string, number>, sample: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of sample) {
    const was = prev.get(k);
    out.set(k, was === undefined ? v : was + ALPHA * (v - was));
  }
  return out;
}

export interface Margin {
  /** Ahead by this fraction of the other's value… */
  rel: number;
  /** …and by at least this much, in the value's own units. */
  abs: number;
}

/** How many reads in a row a row must be ahead, by any amount, to move up
 *  without the margin. */
export const PATIENCE = 3;

export interface Ordering {
  order: string[];
  /** "a>b": reads in a row that `a` has been ahead of `b` just below it. */
  ahead: Map<string, number>;
}

/** The order after a new read: the last one kept, keys gone dropped, new
 *  ones placed by value, and a row moved above the one before it only when
 *  it's clearly ahead (by `margin`) or has been ahead for PATIENCE reads.
 *  Small wobbles leave the list alone. */
export function settle(prev: Ordering, values: Map<string, number>, margin: Margin): Ordering {
  const v = (k: string) => values.get(k) ?? 0;
  const order = prev.order.filter((k) => values.has(k));
  for (const k of [...values.keys()].filter((k) => !order.includes(k)).sort((a, b) => v(b) - v(a))) {
    const at = order.findIndex((o) => v(o) < v(k));
    order.splice(at < 0 ? order.length : at, 0, k);
  }
  const ahead = new Map<string, number>();
  // Count, for each pair as it stood, how long the lower one has been ahead.
  for (let i = 0; i + 1 < order.length; i++) {
    const [up, down] = [order[i], order[i + 1]];
    if (v(down) > v(up)) ahead.set(`${down}>${up}`, (prev.ahead.get(`${down}>${up}`) ?? 0) + 1);
  }
  const beats = (down: string, up: string) =>
    v(down) > v(up) &&
    ((v(down) - v(up) >= margin.abs && v(down) > v(up) * (1 + margin.rel)) || (ahead.get(`${down}>${up}`) ?? 0) >= PATIENCE);
  // Insertion sort with the rule above: a row climbs while it beats the
  // one before it.
  for (let i = 1; i < order.length; i++) {
    let j = i;
    while (j > 0 && beats(order[j], order[j - 1])) {
      [order[j - 1], order[j]] = [order[j], order[j - 1]];
      j--;
    }
  }
  // A pair that swapped starts counting again.
  for (const key of [...ahead.keys()]) {
    const [down, up] = key.split(">");
    if (order.indexOf(down) < order.indexOf(up)) ahead.delete(key);
  }
  return { order, ahead };
}

/** The last `n` samples of each key, oldest first, for a sparkline. */
export function remember(prev: Map<string, number[]>, sample: Map<string, number>, n = 20): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [k, v] of sample) out.set(k, [...(prev.get(k) ?? []), v].slice(-n));
  return out;
}
