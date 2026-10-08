// The shelf: the files each task has shown, so a mockup is one click away
// after it scrolls out of the terminal. Files land on it when an agent runs
// `nebula open`, and when a previewable path (a page, a doc, an image, a
// PDF) that exists on disk turns up in the task's terminal. Kept per agent
// in localStorage across launches, newest first, twenty at most.
import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";
import { getState, setState, subscribe } from "./store";
import { findPaths, logicalLine, WORTH, type Row } from "./pathtext";
import { resolve } from "./termpaths";

export interface ShelfItem {
  path: string;
  /** When it was last shown, ms. */
  at: number;
}

const KEY = "observatory.shelf";
const KEEP = 20;

function loadShelf(): Record<string, ShelfItem[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
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

/** Put `paths` on `agentId`'s shelf, at the front. */
export function addToShelf(agentId: string, paths: string[]) {
  if (!paths.length) return;
  const now = Date.now();
  const had = getState().shelf[agentId] ?? [];
  const fresh = paths.filter((p) => !had.some((i) => i.path === p));
  // Already there and nothing new: leave the order alone, so a scan that
  // keeps finding the same paths doesn't keep reshuffling the strip.
  if (!fresh.length) return;
  const items = [...fresh.map((path) => ({ path, at: now })), ...had].slice(0, KEEP);
  write(agentId, items);
}

export function removeFromShelf(agentId: string, path: string) {
  write(
    agentId,
    (getState().shelf[agentId] ?? []).filter((i) => i.path !== path),
  );
}

/** Mount once: loads the shelves, and drops those of agents the daemon no
 *  longer has. */
export function useShelf() {
  useEffect(() => {
    setState({ shelf: loadShelf() });
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
      for (const f of findPaths(logicalLine((i) => textRow(t, i), y, t.cols).text)) {
        if (WORTH.test(f.text)) seen.add(f.text);
      }
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
