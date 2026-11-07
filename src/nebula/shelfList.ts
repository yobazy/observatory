// The order of a task's shelf (shelf.ts): pinned files first, then the rest,
// each most recent first by when it was last shown or opened. A terminal
// scan that finds a file already there doesn't count as showing it again:
// the scan reads the same old output over and over, and the row would never
// sit still. Pure, so its tests run under Node.

export interface ShelfItem {
  path: string;
  /** When it was last shown, ms. */
  at: number;
  /** Pinned: stays at the front, and isn't dropped to make room. */
  pinned?: boolean;
}

/** How many unpinned files a shelf keeps. */
export const KEEP = 20;

/** `items` with the pinned ones first, each group in the order it had. */
export function pinnedFirst(items: ShelfItem[]): ShelfItem[] {
  return [...items.filter((i) => i.pinned), ...items.filter((i) => !i.pinned)];
}

/** `items` with `paths` put on at the front of the unpinned ones, shown at
 *  `now`; the oldest unpinned past `keep` go. A path already there keeps
 *  its place and time, unless `again` (an agent showed it on purpose, with
 *  `nebula open`): then it's shown at `now` too. Room is made by when each
 *  was last shown or `opened`, the order the row shows them in. The shelf
 *  is the same array when nothing changed. */
export function shelve(items: ShelfItem[], paths: string[], now: number, { again = false, keep = KEEP, opened = {} as Record<string, number> } = {}): ShelfItem[] {
  const wanted = new Set(paths);
  const fresh = [...wanted].filter((p) => !items.some((i) => i.path === p));
  const bumped = again && items.some((i) => wanted.has(i.path));
  if (!fresh.length && !bumped) return items;
  const touched = items.map((i) => (again && wanted.has(i.path) ? { ...i, at: now } : i));
  // Newest first; a tie keeps its order (the paths as given, then the shelf).
  const rest = [...fresh.map((path) => ({ path, at: now })), ...touched.filter((i) => !i.pinned)].sort((a, b) => lastTouched(b, opened) - lastTouched(a, opened));
  return [...touched.filter((i) => i.pinned), ...rest.slice(0, keep)];
}

/** When a file was last shown (`at`) or opened, whichever is later. */
export function lastTouched(item: { path: string; at?: number }, opened: Record<string, number>): number {
  return Math.max(item.at ?? 0, opened[item.path] ?? 0);
}

/** `items` most recent first, pinned ones ahead of the rest. Files never
 *  shown or opened keep the order they came in, after the others. */
export function byRecent<T extends { path: string; at?: number; pinned?: boolean }>(items: T[], opened: Record<string, number>): T[] {
  const sorted = [...items].sort((a, b) => lastTouched(b, opened) - lastTouched(a, opened));
  return [...sorted.filter((i) => i.pinned), ...sorted.filter((i) => !i.pinned)];
}

/** How many files' open times are kept. */
const OPENED_KEEP = 200;

/** `opened` with `paths` opened at `now`, the oldest past the limit gone. */
export function noteOpen(opened: Record<string, number>, paths: string[], now: number, keep = OPENED_KEEP): Record<string, number> {
  const next = { ...opened };
  for (const p of paths) next[p] = now;
  const entries = Object.entries(next);
  if (entries.length <= keep) return next;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, keep));
}

/** `items` with `path` pinned (to the end of the pinned ones) or unpinned
 *  (to the front of the rest). */
export function pin(items: ShelfItem[], path: string, on: boolean): ShelfItem[] {
  const item = items.find((i) => i.path === path);
  if (!item || !!item.pinned === on) return items;
  const others = items.filter((i) => i !== item);
  const changed: ShelfItem = on ? { ...item, pinned: true } : { path: item.path, at: item.at };
  // Either way it lands between the two groups.
  return [...others.filter((i) => i.pinned), changed, ...others.filter((i) => !i.pinned)];
}

/** What "Clear the shelf" leaves: the pinned files. */
export function cleared(items: ShelfItem[]): ShelfItem[] {
  return items.filter((i) => i.pinned);
}

// ---- picking several, to open them as tabs ----

/** `picked` with `path` in it, or out of it if it was. */
export function togglePick(picked: string[], path: string): string[] {
  return picked.includes(path) ? picked.filter((p) => p !== path) : [...picked, path];
}

/** `picked` with every path from `anchor` to `path` in `order` added, the
 *  way Shift-click picks a run of rows. No anchor (or one no longer in the
 *  list) picks `path` alone. */
export function pickRange(order: string[], picked: string[], anchor: string | null, path: string): string[] {
  const a = anchor ? order.indexOf(anchor) : -1;
  const b = order.indexOf(path);
  if (b < 0) return picked;
  if (a < 0) return togglePick(picked, path);
  const run = order.slice(Math.min(a, b), Math.max(a, b) + 1);
  return [...picked, ...run.filter((p) => !picked.includes(p))];
}

/** The picked files in the order they're listed, gathered by the session
 *  each came from (comments on a file go back to it), the groups in the
 *  order of their first file. */
export function bySource<R extends { path: string; from: string }>(order: R[], picked: string[]): { from: string; paths: string[] }[] {
  const groups: { from: string; paths: string[] }[] = [];
  for (const r of order) {
    if (!picked.includes(r.path)) continue;
    const g = groups.find((x) => x.from === r.from);
    if (g) g.paths.push(r.path);
    else groups.push({ from: r.from, paths: [r.path] });
  }
  return groups;
}
