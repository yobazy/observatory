// How a thread shows (its terminal, or read as a conversation), and threads
// whose conversation is stood in for: `scripts/drive replay` puts a marked
// moment's thread on a sandbox thread, so the reader shows what you saw.
import { useSyncExternalStore } from "react";
import type { Transcript } from "./transcript.ts";

export type PaneMode = "terminal" | "read";

const MODE_KEY = "observatory.paneMode";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const watch = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Terminal or reader, remembered on this Mac. */
export function paneMode(): PaneMode {
  try {
    return localStorage.getItem(MODE_KEY) === "read" ? "read" : "terminal";
  } catch {
    return "terminal";
  }
}

let mode: PaneMode | null = null;

export function setPaneMode(m: PaneMode) {
  mode = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // Remembering it is a nicety.
  }
  notify();
}

export function usePaneMode(): [PaneMode, (m: PaneMode) => void] {
  const m = useSyncExternalStore(watch, () => (mode ??= paneMode()));
  return [m, setPaneMode];
}

const standIns = new Map<string, Transcript>();

/** Show `thread` as agent `id`'s conversation, until the app reloads. */
export function standIn(id: string, thread: Transcript) {
  standIns.set(id, thread);
  notify();
}

export function useStandIn(id: string | undefined): Transcript | null {
  return useSyncExternalStore(watch, () => (id ? (standIns.get(id) ?? null) : null));
}
