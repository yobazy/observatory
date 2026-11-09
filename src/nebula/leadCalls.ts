// The app side of S27 (leadChat.ts is the pure side): each running lead's
// latest reply, read from its thread's log when its status moves, so its pet
// can call you; which lead's dialogue is open; and marking a lead seen when
// you open it. The reply comes from the same `thread_transcript` read the
// Read view uses, never a parse of its own.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { allCards, useCards } from "./cards";
import { isPreview, send } from "./client";
import { callState, laterSeen, lastReply, leadsOf, markSeenInChat, seenInChat, shortcutTarget, type Call, type LeadEntry, type LeadReply } from "./leadChat";
import { readTo } from "./readmark";
import { getState, subscribe, useAppState, type State } from "./store";
import type { Transcript } from "./transcript";
import type { Agent } from "./types";

const listeners = new Set<() => void>();
/** Bumped on every change here, for the hooks below. */
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};
const watch = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Each lead's latest reply, by its thread's id. */
let replies: Record<string, LeadReply | null> = {};
/** The lead whose dialogue is open. */
let open: string | null = null;

/** A lead's latest reply as the dialogue just read it. */
export function noteReply(agentId: string, reply: LeadReply | null) {
  const was = replies[agentId];
  if (was === reply || (was && reply && was.n === reply.n && was.text === reply.text)) return;
  replies = { ...replies, [agentId]: reply };
  notify();
}

export function openLeadChat(agentId: string) {
  open = agentId;
  notify();
}

export function closeLeadChat() {
  if (open === null) return;
  open = null;
  notify();
}

export const useOpenLead = () => useSyncExternalStore(watch, () => open);

/** You've seen `agentId`'s reply `n`: its call stops, and nebula hears it's
 *  read, as it does when you look at the thread. */
export function markLeadSeen(agent: Agent, n: number | null) {
  if (n !== null) markSeenInChat(agent.id, n);
  if (agent.unseen) void send("MarkAgentSeen", { id: agent.id }).catch(() => {});
  notify();
}

const readable = (a: Agent | undefined): a is Agent => !!a?.session_id && (a.kind === "claude" || a.kind === "codex");

async function readReply(a: Agent): Promise<LeadReply | null> {
  const t: Transcript | null = isPreview()
    ? (await import("./mock")).mockTranscript(getState(), a.id)
    : await invoke<Transcript | null>("thread_transcript", { session: a.session_id, from: null, kind: a.kind });
  return lastReply(t?.entries);
}

const leadsIn = (s: Pick<State, "agents" | "projects" | "prefs">, cards = allCards()) => leadsOf(cards, s.prefs.topLead, s.agents, s.projects);

function callsFor(leads: LeadEntry[], agents: State["agents"]): Record<string, Call> {
  const out: Record<string, Call> = {};
  for (const l of leads)
    out[l.agentId] = callState({
      reply: replies[l.agentId] ?? null,
      unseen: !!agents[l.agentId]?.unseen,
      seen: laterSeen(seenInChat(l.agentId), readTo(l.agentId)),
    });
  return out;
}

/** The running leads, the top lead first. */
export function useLeads(): LeadEntry[] {
  const cards = useCards();
  const { agents, projects, prefs } = useAppState();
  return useMemo(() => leadsOf(cards, prefs.topLead, agents, projects), [cards, agents, projects, prefs.topLead]);
}

/** Whether each running lead is calling you, by its thread's id. */
export function useLeadCalls(leads: LeadEntry[]): Record<string, Call> {
  const v = useSyncExternalStore(watch, () => version);
  const { agents } = useAppState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => callsFor(leads, agents), [leads, agents, v]);
}

/** The lead ⌘L opens now: one calling you, else the top lead. */
export function shortcutLead(): string | null {
  const s = getState();
  const leads = leadsIn(s);
  return shortcutTarget(leads, callsFor(leads, s.agents));
}

/** Mount once: reads a lead's latest reply when its thread's status moves,
 *  and once more a few seconds on, since a turn's last reply can reach the
 *  log after the thread shows finished. */
export function useLeadCallRunner() {
  useEffect(() => {
    const stamps = new Map<string, string>();
    const timers = new Set<number>();
    const read = (a: Agent) =>
      void readReply(a)
        .then((r) => noteReply(a.id, r))
        .catch(() => {});
    const tick = () => {
      const s = getState();
      if (!s.loaded) return;
      for (const l of leadsIn(s)) {
        const a = s.agents[l.agentId];
        if (!readable(a)) continue;
        const stamp = `${a.status}|${a.status_changed_at}`;
        if (stamps.get(a.id) === stamp) continue;
        stamps.set(a.id, stamp);
        read(a);
        const t = window.setTimeout(() => {
          timers.delete(t);
          const now = getState().agents[a.id];
          if (readable(now)) read(now);
        }, 4000);
        timers.add(t);
      }
    };
    tick();
    const off = subscribe(tick);
    return () => {
      off();
      for (const t of timers) clearTimeout(t);
    };
  }, []);
}
