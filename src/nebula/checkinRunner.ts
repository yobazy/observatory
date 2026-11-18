// Sends the check-ins checkin.ts decides on: a minute's sweep over finished
// threads whose last reply says something is still running, asking each for
// a status card once its half hour is up. What you chose per thread, and
// how many were sent, wait in localStorage across launches.
import { useEffect, useSyncExternalStore } from "react";
import { followUp } from "./actions";
import { allCards } from "./cards";
import { draftFor } from "./drafts";
import { leadIds } from "./lead";
import { isIdle } from "./queue";
import { getState, subscribe } from "./store";
import { logUse } from "./uselog";
import { readingOf, readTurn } from "./verdicts";
import { CHECK_IN_EVERY_MS, CHECK_IN_PROMPT, nextCheckIn, prune, STALE_MS, watching, type CheckIn, type CheckIns } from "./checkin";
import type { Chip } from "./replycard";
import type { Agent } from "./types";

const KEY = "observatory.checkins";
const listeners = new Set<() => void>();
let version = 0;
let all: CheckIns = load();

function load(): CheckIns {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function write(next: CheckIns) {
  all = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Without storage, choices last until the app quits.
  }
  version++;
  listeners.forEach((l) => l());
}

function put(id: string, c: CheckIn | null) {
  const next = { ...all };
  if (c && Object.keys(c).length) next[id] = c;
  else delete next[id];
  write(next);
}

/** A dev build can be told a shorter wait, to try it in the sandbox:
 *  `VITE_CHECK_IN_MS=60000 scripts/sandbox.sh app`. */
function every(): number {
  const ms = import.meta.env.DEV ? Number(import.meta.env.VITE_CHECK_IN_MS) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : CHECK_IN_EVERY_MS;
}

/** Turn a thread's check-ins on or off. On starts the half hour again. */
export function setCheckIn(id: string, on: boolean) {
  put(id, on ? { on: true, sent: Date.now() } : { on: false });
  logUse("checkin.toggle", { on });
}

/** For the Read view: whether the thread is checked in on, and when the
 *  next one goes (null when none will). */
export function useCheckIn(agent: Agent, verdict: Chip | null | undefined, last: number | null | undefined) {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  const c = all[agent.id];
  return { on: watching(verdict, c), next: nextCheckIn(verdict, c, last, Date.now(), every()) };
}

let sweeping = false;

async function sweep() {
  const s = getState();
  if (sweeping || !s.loaded || s.link.state !== "connected") return;
  sweeping = true;
  try {
    const now = Date.now();
    const gap = every();
    const leads = leadIds(allCards(), s.prefs.topLead);
    const tried = Object.values(s.agents).filter(
      (a) =>
        !a.archived &&
        a.status === "finished" &&
        !leads.has(a.id) &&
        (all[a.id]?.on === true || now - a.status_changed_at < STALE_MS + gap),
    );
    for (const a of tried) {
      await readTurn(a);
      const now2 = Date.now();
      const fresh = getState().agents[a.id];
      const r = fresh ? readingOf(fresh) : undefined;
      if (!fresh || !r) continue;
      const c = all[a.id];
      // A reply that stopped saying "running" ends the run of check-ins;
      // the next one that says it starts a fresh count.
      if (!watching(r.verdict, c)) {
        if (c?.count) put(a.id, c.on === undefined ? null : { on: c.on });
        continue;
      }
      const next = nextCheckIn(r.verdict, c, r.last, now2, gap);
      if (next == null || now2 < next) continue;
      // Not over something you're writing or have queued for it.
      if (!isIdle(fresh) || draftFor(a.id) || getState().queue[a.id]?.length) continue;
      put(a.id, { ...c, sent: now2, count: (c?.count ?? 0) + 1 });
      logUse("checkin.sent", { count: (c?.count ?? 0) + 1 });
      try {
        await followUp(fresh, CHECK_IN_PROMPT, { select: false, background: true });
      } catch {
        // Tried again in half an hour.
      }
    }
    const kept = prune(all, (id) => !!getState().agents[id]);
    if (Object.keys(kept).length !== Object.keys(all).length) write(kept);
  } finally {
    sweeping = false;
  }
}

/** Mount once: sweeps each minute once the daemon's connected. */
export function useCheckInRunner() {
  useEffect(() => {
    let started = false;
    const off = subscribe(() => {
      if (getState().loaded && !started) {
        started = true;
        void sweep();
      }
    });
    const tick = setInterval(() => void sweep(), Math.min(60_000, Math.max(5_000, every() / 4)));
    return () => {
      off();
      clearInterval(tick);
    };
  }, []);
}
