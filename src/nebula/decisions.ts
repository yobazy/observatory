// Which threads wait on you to decide something, kept up to date as their
// turns end, for Decisions (Inbox.tsx) and the count on its sidebar entry.
// Each thread's transcript is read again only when its status changes.

import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { getState, subscribe } from "./store";
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
  forget(agentId);
}

async function waitingOn(agent: Agent): Promise<Waiting | null> {
  const t: Transcript | null = isPreview()
    ? (await import("./mock")).mockTranscript(getState(), agent.id)
    : await invoke<Transcript | null>("thread_transcript", { session: agent.session_id, from: null, kind: agent.kind }).catch(() => null);
  const entries = t?.entries ?? [];
  const prompt = agent.status === "needs_feedback";
  const got = pendingCard(entries);
  if (prompt) {
    // Its terminal waits whatever the transcript says; the card, if any,
    // is only context.
    const { asked, said } = promptContext(entries);
    return { agent, prompt, said, n: got?.n ?? -1, card: got?.card ?? null, asked, earlier: [] };
  }
  if (!got) return null;
  const away = putAway();
  const earlier = got.earlier.filter((d) => !away.has(`${agent.id}:${d.entry}`));
  if (!earlier.length && !asksYou(got.card)) return null;
  return { ...got, agent, prompt, said: "", earlier };
}

/** Threads that have ended a turn; one still working can't be answered yet. */
function idle(): Agent[] {
  return Object.values(getState().agents)
    .filter((a) => !a.archived && a.session_id && a.status !== "running")
    .sort((a, b) => b.status_changed_at - a.status_changed_at);
}

const found = new Map<string, { at: number; status: Agent["status"]; got: Waiting | null }>();
let list: Waiting[] | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;
let again = false;

/** Read a thread again on the next scan, as when you put something away. */
function forget(agentId: string) {
  found.delete(agentId);
  schedule();
}

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
      return !f || f.at !== a.status_changed_at || f.status !== a.status;
    });
    // A few at a time: at launch every finished thread is read once.
    for (let i = 0; i < stale.length; i += 4) {
      const batch = stale.slice(i, i + 4);
      const got = await Promise.all(batch.map((a) => waitingOn(a).catch(() => null)));
      batch.forEach((a, j) => found.set(a.id, { at: a.status_changed_at, status: a.status, got: got[j] }));
    }
    const ids = new Set(now.map((a) => a.id));
    for (const id of found.keys()) if (!ids.has(id)) found.delete(id);
    // Each with its agent as it is now, for names and ages.
    const agents = getState().agents;
    list = now.flatMap((a) => {
      const w = found.get(a.id)?.got;
      return w ? [{ ...w, agent: agents[a.id] ?? w.agent }] : [];
    });
    listeners.forEach((l) => l());
  } finally {
    scanning = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void scan();
  }, 300);
}

let lastAgents: unknown = null;
let started = false;
function start() {
  if (started) return;
  started = true;
  subscribe(() => {
    const agents = getState().agents;
    if (agents === lastAgents) return;
    lastAgents = agents;
    schedule();
  });
  lastAgents = getState().agents;
  schedule();
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
