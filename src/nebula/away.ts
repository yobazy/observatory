// When you came back: the window lost focus for a while (or the app just
// started), and the sidebar can say what finished in the meantime. Only the
// moment matters, so it's kept here rather than in the app's state.
import { useSyncExternalStore } from "react";

/** Gone this long counts as away; a glance at another app doesn't. */
const AWAY_MS = 10 * 60_000;

/** On launch, how far back a finished turn is still news. */
const LAUNCH_LOOKBACK_MS = 12 * 60 * 60_000;

/** Turns that ended after this (ms) are news; null when there's none to give. */
let since: number | null = Date.now() - LAUNCH_LOOKBACK_MS;
let leftAt: number | null = null;
let watching = false;
const listeners = new Set<() => void>();

function set(next: number | null) {
  since = next;
  listeners.forEach((l) => l());
}

/** Start watching focus. On launch, the last half day you haven't seen is news. */
export function watchAway() {
  if (watching) return;
  watching = true;
  window.addEventListener("blur", () => {
    leftAt = Date.now();
  });
  window.addEventListener("focus", () => {
    if (leftAt !== null && Date.now() - leftAt >= AWAY_MS) set(leftAt);
    leftAt = null;
  });
}

export function useAwaySince(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => since,
  );
}

export function dismissAway() {
  set(null);
}
