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
