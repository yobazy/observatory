// Closes finished threads that said they were safe to close a day ago
// (autoclose.ts), the way the Close button does: archived, with Undo. Swept
// a little after the app starts and then hourly; each thread's log is read
// once per status change (verdicts.ts), so later sweeps read almost nothing.
import { useEffect } from "react";
import { request } from "./client";
import { draftFor } from "./drafts";
import { flash, getState, subscribe } from "./store";
import { loadPrefs } from "./theme";
import { logUse } from "./uselog";
import { readingOf, readTurn } from "./verdicts";
import { candidates, closable, CLOSE_AFTER_MS, type Reading } from "./autoclose";
import type { Agent } from "./types";

const HOUR = 60 * 60 * 1000;
/** Long enough after launch for the open thread to be back on screen. */
const FIRST_SWEEP_MS = 30_000;

/** A dev build can be told a shorter wait, to try it in the sandbox:
 *  `VITE_AUTO_CLOSE_AFTER_MS=60000 scripts/sandbox.sh app`. */
function closeAfter(): number {
  const ms = import.meta.env.DEV ? Number(import.meta.env.VITE_AUTO_CLOSE_AFTER_MS) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : CLOSE_AFTER_MS;
}

const hasDraft = (id: string) => draftFor(id) !== "";

/** Each thread closed here, by id, with the status_changed_at it had then
 *  (autoclose.ts's `closedAt`), kept across launches. */
const KEY = "observatory.autoclosed";

function loadClosed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Note `ids` as closed now, forgetting threads the daemon no longer has. */
function noteClosed(ids: string[]) {
  const { agents } = getState();
  const kept = Object.fromEntries(Object.entries(loadClosed()).filter(([id]) => agents[id]));
  for (const id of ids) if (agents[id]) kept[id] = agents[id].status_changed_at;
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Without storage, one brought back may be closed again next sweep.
  }
}

function reading(a: Agent): Reading | null {
  const r = readingOf(a);
  return r && r.last != null ? { tone: r.verdict?.tone ?? null, last: r.last } : null;
}

let sweeping = false;

/** One sweep; false when it couldn't look yet (not connected, or one
 *  already going). */
async function sweep(after: number): Promise<boolean> {
  const s = getState();
  if (sweeping || !s.loaded || s.link.state !== "connected") return false;
  if (s.prefs.autoCloseSafe === false) return true;
  sweeping = true;
  try {
    const now = Date.now();
    const o = { after, hasDraft, closedAt: loadClosed() };
    for (const a of candidates(s, now, o)) await readTurn(a);
    // The prefs file as well as what's in memory: a pin either one has, or
    // the switch turned off in either, keeps the thread.
    const saved = await loadPrefs();
    const fresh = getState();
    const kept = new Set(closable({ ...fresh, prefs: saved }, now, reading, o));
    const ids = closable(fresh, now, reading, o).filter((id) => kept.has(id));
    if (!ids.length) return true;
    const results = await Promise.allSettled(ids.map((id) => request("ArchiveAgent", { id })));
    const closed = ids.filter((_, i) => results[i].status === "fulfilled");
    const failed = ids.length - closed.length;
    noteClosed(closed);
    logUse("threads.autoclose", { count: closed.length, failed: failed || undefined });
    if (!closed.length) return true;
    const n = closed.length;
    flash(`Closed ${n} ${n === 1 ? "thread" : "threads"} that said ✅ Safe to close and sat finished a day`, 8000, {
      label: "Undo",
      run: () => void Promise.allSettled(closed.map((id) => request("UnarchiveAgent", { id }))),
    });
  } catch {
    // Tried again next sweep.
  } finally {
    sweeping = false;
  }
  return true;
}

/** Mount once: sweeps a little after the app has connected, then hourly. */
export function useAutoClose() {
  useEffect(() => {
    const after = closeAfter();
    const every = Math.min(HOUR, Math.max(5_000, after / 4));
    let first: ReturnType<typeof setTimeout> | null = null;
    let started = false;
    // The first sweep waits for the daemon, and tries again until it gets one.
    const startWhenLoaded = () => {
      if (started || first || !getState().loaded) return;
      first = setTimeout(async () => {
        started = await sweep(after);
        first = null;
        if (!started)
          first = setTimeout(() => {
            first = null;
            startWhenLoaded();
          }, 10_000);
      }, after < CLOSE_AFTER_MS ? 2_000 : FIRST_SWEEP_MS);
    };
    const off = subscribe(startWhenLoaded);
    startWhenLoaded();
    const tick = setInterval(() => void sweep(after), every);
    return () => {
      off();
      if (first) clearTimeout(first);
      clearInterval(tick);
    };
  }, []);
}
