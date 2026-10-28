// The order of a task's shelf (shelf.ts): pinned files first, then the rest.
// Pure, so its tests run under Node.

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
 *  its place, and the shelf is the same array when nothing is new. */
export function shelve(items: ShelfItem[], paths: string[], now: number, keep = KEEP): ShelfItem[] {
  const fresh = [...new Set(paths)].filter((p) => !items.some((i) => i.path === p));
  if (!fresh.length) return items;
  const pinned = items.filter((i) => i.pinned);
  const rest = [...fresh.map((path) => ({ path, at: now })), ...items.filter((i) => !i.pinned)];
  return [...pinned, ...rest.slice(0, keep)];
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
