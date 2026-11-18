// Which threads wait on you to decide something, kept up to date as their
// turns end, for Decisions (Inbox.tsx) and the count on its sidebar entry.
// Each thread's transcript is read again only when its status changes.

import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { stoodIn } from "./pane";
import { getState, subscribe, threadAgents } from "./store";
import { asksYou, pendingCard, promptContext, type Card, type Pending } from "./replycard";
import type { Transcript } from "./transcript";
import type { Agent } from "./types";

/** A thread waiting on you: its latest reply's decisions, or a choice its
 *  terminal is showing (`prompt`), which can come up before any card. */
export interface Waiting extends Omit<Pending, "card"> {
  agent: Agent;
  /** Its latest reply's card: always there unless it's a `prompt`. */
  card: Card | null;
  /** It stopped on a prompt in its terminal: a permission, a question. */
  prompt: boolean;
  /** What it said this turn before the prompt came up. */
  said: string;
}

/** Earlier replies whose open decisions you put away, as "agent:entry", so
 *  they stay away the next time. */
const PUT_AWAY = "observatory.decisions.putAway";
export function putAway(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PUT_AWAY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function keepPutAway(agentId: string, entry: number) {
  const keys = putAway();
  keys.add(`${agentId}:${entry}`);
  try {
    // The newest few hundred: enough for any thread still around.
    localStorage.setItem(PUT_AWAY, JSON.stringify([...keys].slice(-300)));
  } catch {
    // Private mode or full: put away for this visit only.
  }
  // Applied as the list is built, so a read under way can't bring it back.
  schedule();
}

async function waitingOn(agent: Agent): Promise<Waiting | null> {
  // A replayed moment's thread (`scripts/drive replay`) reads as it did then.
  const t: Transcript | null =
    stoodIn(agent.id) ??
    (isPreview()
      ? (await import("./mock")).mockTranscript(getState(), agent.id)
      : await invoke<Transcript | null>("thread_transcript", { session: agent.session_id, from: null, kind: agent.kind }).catch(() => null));
  const entries = t?.entries ?? [];
  const prompt = agent.status === "needs_feedback";
  const got = pendingCard(entries);
  if (prompt) {
    // Its terminal waits whatever the transcript says; the card, if any,
    // is only context.
    const { asked, said } = promptContext(entries);
    return { agent, prompt, said, n: got?.n ?? -1, card: got?.card ?? null, asked, earlier: [] };
  }
  return got && { ...got, agent, prompt, said: "" };
}

/** Without the earlier replies you put away; null when that was all. */
function withoutPutAway(w: Waiting, away: Set<string>): Waiting | null {
  if (w.prompt) return w;
  const earlier = w.earlier.filter((d) => !away.has(`${w.agent.id}:${d.entry}`));
  if (!earlier.length && !(w.card && asksYou(w.card))) return null;
  return { ...w, earlier };
}

/** Finished threads quiet this long aren't read: what they asked is stale. */
const STALE_MS = 14 * 24 * 3600_000;

/** Threads that can take an answer now: a turn ended, or a prompt up. One
 *  working, stopped or cut off can't; a finished one with an answer queued
 *  already has it. Waiting on a prompt first, since it holds up a turn under way. */
function idle(): Agent[] {
  const s = getState();
  const { queue } = s;
  const now = Date.now();
  // A lead is its project's chat (S29), not a thread to answer here.
  return threadAgents(s)
    .filter((a) => !a.archived && a.session_id)
    // A prompt still needs answering even with a reply queued behind it.
    .filter((a) => a.status === "needs_feedback" || (a.status === "finished" && !queue[a.id]?.length && now - a.status_changed_at < STALE_MS))
    .sort((a, b) => Number(b.status === "needs_feedback") - Number(a.status === "needs_feedback") || b.status_changed_at - a.status_changed_at);
}

const found = new Map<string, { at: number; status: Agent["status"]; got: Waiting | null }>();
let list: Waiting[] | null = null;
/** Threads to read again though their status hasn't moved: a reply can land
 *  without one (a "! cmd" turn, a quick turn the daemon missed), and a card
 *  read before it would stay up as if you'd sent nothing. */
const reread = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;
let again = false;

async function scan() {
  if (scanning) {
    again = true;
    return;
  }
  scanning = true;
  try {
    const now = idle();
    const stale = now.filter((a) => {
      const f = found.get(a.id);
      return !f || f.at !== a.status_changed_at || f.status !== a.status || reread.has(a.id);
    });
    reread.clear();
    // A few at a time, the list shown after each: at launch every recent
    // finished thread is read once.
    publish(now, stale.length > 0);
    for (let i = 0; i < stale.length; i += 4) {
      const batch = stale.slice(i, i + 4);
      const got = await Promise.all(batch.map((a) => waitingOn(a).catch(() => null)));
      batch.forEach((a, j) => found.set(a.id, { at: a.status_changed_at, status: a.status, got: got[j] }));
      publish(now, i + 4 < stale.length);
    }
    // Kept for a thread that's only cut off for now, so it isn't read again
    // when it comes back; dropped once the thread is gone.
    const agents = getState().agents;
    for (const id of found.keys()) if (!agents[id]) found.delete(id);
  } finally {
    scanning = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}

/** The list as far as it's read, each with its agent as it is now. Stays
 *  null (a dash on the sidebar) until the first read has something. */
function publish(now: Agent[], partial: boolean) {
  const agents = getState().agents;
  const away = putAway();
  const fresh = (a: Agent) => {
    const f = found.get(a.id);
    return f && f.at === a.status_changed_at && f.status === a.status ? f.got : null;
  };
  const next = now.flatMap((a) => {
    const w = fresh(a);
    const shown = w && withoutPutAway({ ...w, agent: agents[a.id] ?? w.agent }, away);
    return shown ? [shown] : [];
  });
  if (partial && list === null && !next.length) return;
  list = next;
  listeners.forEach((l) => l());
}

/** How far back recheck() looks: threads that moved this recently. */
const RECHECK_MS = 6 * 3600_000;

/** Read again the threads waiting on you, the ones that moved lately and
 *  any named, so Decisions shows their latest reply. For when it opens, and
 *  now and then while it's open. */
export function recheck(ids: string[] = []) {
  const since = Date.now() - RECHECK_MS;
  const waiting = new Set([...(list ?? []).map((w) => w.agent.id), ...ids]);
  for (const a of idle()) if (waiting.has(a.id) || a.status_changed_at > since) reread.add(a.id);
  if (reread.size) schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void scan();
  }, 300);
}

let lastAgents: unknown = null;
let lastQueue: unknown = null;
let started = false;
function start() {
  if (started) return;
  started = true;
  const changed = () => {
    const { agents, queue, loaded } = getState();
    // Before the daemon's first list there's nothing to count.
    if (!loaded || (agents === lastAgents && queue === lastQueue)) return;
    lastAgents = agents;
    lastQueue = queue;
    schedule();
  };
  subscribe(changed);
  changed();
}

function listen(l: () => void) {
  start();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Every thread waiting on you, newest first; null until the first read. */
export function useWaiting(): Waiting[] | null {
  return useSyncExternalStore(listen, () => list);
}
