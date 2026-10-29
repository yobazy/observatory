// The shelf: the files each task has shown, so a mockup is one click away
// after it scrolls out of the terminal. Files land on it when an agent runs
// `nebula open`, and when a previewable path (a page, a doc, an image, a
// PDF) that exists on disk turns up in the task's terminal. Kept per agent
// in localStorage across launches: pinned files first, then the rest by when
// each was last shown or opened, twenty at most (shelfList.ts).
import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";
import { getState, setState, subscribe } from "./store";
import { findPaths, logicalLine, WORTH, type Row } from "./pathtext";
import { resolve } from "./termpaths";
import { cleared, noteOpen, pin, pinnedFirst, shelve, type ShelfItem } from "./shelfList";

export type { ShelfItem };

const KEY = "observatory.shelf";
const OPENED_KEY = "observatory.fileOpened";

function loadOpened(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(OPENED_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Files opened in the preview just now: they move up their lists. */
export function noteOpened(paths: string[]) {
  if (!paths.length) return;
  const fileOpened = noteOpen(getState().fileOpened, paths, Date.now());
  setState({ fileOpened });
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify(fileOpened));
  } catch {
    // The order falls back to when each was shown.
  }
}

function loadShelf(): Record<string, ShelfItem[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    // A hand-edited file may have a pin out of place.
    return Object.fromEntries(Object.entries(raw as Record<string, ShelfItem[]>).map(([id, items]) => [id, pinnedFirst(items)]));
  } catch {
    return {};
  }
}

function save(shelf: Record<string, ShelfItem[]>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(shelf));
  } catch {
    // A convenience: the shelf starts empty next launch.
  }
}

function write(agentId: string, items: ShelfItem[]) {
  const shelf = { ...getState().shelf };
  if (items.length) shelf[agentId] = items;
  else delete shelf[agentId];
  setState({ shelf });
  save(shelf);
}

/** Put `paths` on `agentId`'s shelf, at the front after the pinned ones.
 *  `again`: the agent showed them on purpose (`nebula open`), so ones
 *  already there count as shown now too. */
export function addToShelf(agentId: string, paths: string[], again = false) {
  if (!paths.length) return;
  const had = getState().shelf[agentId] ?? [];
  // Already there and nothing new: leave the order alone, so a scan that
  // keeps finding the same paths doesn't keep reshuffling the strip.
  const items = shelve(had, paths, Date.now(), { again, opened: getState().fileOpened });
  if (items !== had) write(agentId, items);
}

/** Pin `path` on `agentId`'s shelf, so it stays at the front; or unpin it. */
export function pinOnShelf(agentId: string, path: string, on: boolean) {
  const had = getState().shelf[agentId] ?? [];
  const items = pin(had, path, on);
  if (items !== had) write(agentId, items);
}

export function removeFromShelf(agentId: string, path: string) {
  write(
    agentId,
    (getState().shelf[agentId] ?? []).filter((i) => i.path !== path),
  );
}

/** Take everything off `agentId`'s shelf but the pinned files. */
export function clearShelf(agentId: string) {
  write(agentId, cleared(getState().shelf[agentId] ?? []));
}

/** Mount once: loads the shelves, and drops those of agents the daemon no
 *  longer has. */
export function useShelf() {
  useEffect(() => {
    setState({ shelf: loadShelf(), fileOpened: loadOpened() });
    let snapshots = getState().snapshots;
    return subscribe(() => {
      const s = getState();
      if (s.snapshots === snapshots || !s.loaded) return;
      snapshots = s.snapshots;
      const kept = Object.fromEntries(Object.entries(s.shelf).filter(([id]) => id in s.agents));
      if (Object.keys(kept).length !== Object.keys(s.shelf).length) {
        setState({ shelf: kept });
        save(kept);
      }
    });
  }, []);
}

// ---- finding files in a terminal ----

/** Row `i` as text, for scanning: positions don't matter here, only words. */
function textRow(t: Terminal, i: number): Row | undefined {
  const line = t.buffer.active.getLine(i);
  return line ? { cells: [...line.translateToString(false)], wrapped: line.isWrapped } : undefined;
}

/** How far back from the bottom a scan reaches once the first one is done:
 *  output lands at the bottom, and an app redraws its last screenful. */
const RECENT_ROWS = 300;

export interface FileWatch {
  /** A different session is in the terminal now: scan all of it next. */
  rescan: () => void;
  dispose: () => void;
}

/** Watch `t` for previewable files and shelve them for the agent `owner()`
 *  names. Scans the whole buffer first, then the recent rows after each
 *  burst of output. */
export function watchForFiles(t: Terminal, owner: () => string | null, cwd: () => string | null): FileWatch {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let whole = true;
  const scan = async () => {
    timer = null;
    const agent = owner();
    if (!agent) return;
    const buf = t.buffer.active;
    const from = whole ? 0 : Math.max(0, buf.length - RECENT_ROWS);
    whole = false;
    const seen = new Set<string>();
    for (let y = from; y < buf.length; y++) {
      // Rows joined into one line are read once, from its first row.
      if (y > from && buf.getLine(y)?.isWrapped) continue;
      const line = logicalLine((i) => textRow(t, i), y, t.cols);
      for (const f of findPaths(line.text)) {
        if (WORTH.test(f.text)) seen.add(f.text);
      }
      // So are rows an app wrapped, which the line above already took in.
      y = Math.max(y, line.last);
    }
    if (!seen.size) return;
    const candidates = [...seen];
    const abs = await resolve(candidates, cwd());
    // Oldest first, so the newest ends up at the front of the shelf.
    if (owner() === agent) addToShelf(agent, abs.filter((p): p is string => !!p).reverse());
  };
  const later = () => {
    if (!timer) timer = setTimeout(() => void scan(), 800);
  };
  const off = t.onWriteParsed(later);
  return {
    rescan: () => {
      whole = true;
      later();
    },
    dispose: () => {
      off.dispose();
      if (timer) clearTimeout(timer);
    },
  };
}
