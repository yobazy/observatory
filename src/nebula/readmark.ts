// How far you've read each thread in the Read view, remembered across
// launches, so coming back to it says where the new part starts and folds
// away the turns you've already been through. The storage is a convenience;
// the plan for what to show is kept free of the app so its tests run under
// plain Node.

const KEY = "observatory.readTo";

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** The last entry you saw in `agentId`'s thread, or null if never opened. */
export function readTo(agentId: string): number | null {
  const n = load()[agentId];
  return typeof n === "number" ? n : null;
}

export function markRead(agentId: string, n: number) {
  try {
    const all = load();
    if (all[agentId] === n) return;
    all[agentId] = n;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Without storage every thread opens as if read.
  }
}

interface Seen {
  n: number;
  kind: string;
}

/** Where the Read view's "since you left" line goes and what folds above
 *  it. `unread` is the first entry after `seen` (null when nothing is new,
 *  or the thread was never opened); `foldTo` is the first entry still shown,
 *  so the turns before it read as "N earlier turns". A turn starts at one of
 *  your messages. The last `keep` turns stay open, and so does the turn the
 *  unread part starts in. */
export function readPlan(entries: Seen[], seen: number | null, keep = 2): { unread: number | null; foldTo: number | null; turns: number } {
  const unreadAt = seen === null ? -1 : entries.findIndex((e) => e.n > seen);
  const unread = unreadAt > 0 ? entries[unreadAt].n : null;
  const starts = entries.flatMap((e, i) => (e.kind === "you" ? [i] : []));
  // The turn the unread part begins in starts at the message before it.
  const unreadTurn = unreadAt > 0 ? starts.filter((i) => i <= unreadAt).pop() ?? 0 : entries.length;
  const lastKept = starts.length > keep ? starts[starts.length - keep] : 0;
  const from = Math.min(unreadTurn, lastKept);
  const turns = starts.filter((i) => i < from).length + (starts[0] > 0 && from > 0 ? 1 : 0);
  return { unread, foldTo: from > 0 && turns > 0 ? entries[from].n : null, turns };
}
