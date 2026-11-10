// The app side of S27 and S29 (leadChat.ts and projectChat.ts are the pure
// side): each running lead's latest reply, read from its thread's log when
// its status moves, so its pet can call you and its chat row has a line;
// which lead's chat is open; and marking a lead seen when you open it. The
// reply comes from the same `thread_transcript` read the Read view uses,
// never a parse of its own.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { allCards, useCards } from "./cards";
import { isPreview, send } from "./client";
import { callState, lastReply, leadsOf, markSeenInChat, seenInChat, type Call, type LeadEntry, type LeadReply } from "./leadChat";
import { askKey, isAnswered, leadActs, useLeadActs } from "./leadActions";
import { getState, setState, subscribe, useAppState, type State } from "./store";
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
/** The lead whose raw terminal you asked for ("Open terminal" in its
 *  chat), in place of its chat, until its chat is opened again. */
let terminal: string | null = null;

/** A lead's latest reply as last read (the chat, or a status change). */
export function noteReply(agentId: string, reply: LeadReply | null) {
  const was = replies[agentId];
  if (was === reply || (was && reply && was.n === reply.n && was.text === reply.text)) return;
  replies = { ...replies, [agentId]: reply };
  notify();
}

/** A lead's latest reply as last read, or undefined before it's read
 *  (S28: the runner acts on it once its turn has ended). */
export const latestReply = (agentId: string): LeadReply | null | undefined => replies[agentId];

/** A lead's latest reply as last read, kept current, for its chat row. */
export function useLeadReply(agentId: string): LeadReply | null {
  return useSyncExternalStore(watch, () => replies[agentId] ?? null);
}

/** Called on every change here: a reply read, a chat or terminal opened. */
export const watchLeadCalls = watch;

/** Open a lead's chat (S29): its thread selected, shown as the chat. A
 *  project's lead brings its project up; the top lead leaves the project
 *  list where it is. */
export function openLeadChat(agentId: string) {
  terminal = null;
  notify();
  const s = getState();
  const projectId = s.worktrees[s.agents[agentId]?.worktree_id ?? ""]?.project_id;
  const top = s.prefs.topLead?.agentId === agentId;
  setState({ view: "sessions", selectedSession: { Agent: agentId }, ...(!top && projectId ? { selectedProject: projectId } : {}) });
}

/** "Open terminal" in a lead's chat: its raw session, until the chat is
 *  opened again. */
export function openLeadTerminal(agentId: string) {
  terminal = agentId;
  notify();
}

/** The lead whose chat is open: the selected thread when it's a running
 *  lead and its terminal wasn't asked for. */
export function useChatLead(): LeadEntry | null {
  const leads = useLeads();
  const sel = useAppState().selectedSession;
  const raw = useSyncExternalStore(watch, () => terminal);
  const id = sel && "Agent" in sel ? sel.Agent : null;
  if (!id || id === raw) return null;
  return leads.find((l) => l.agentId === id) ?? null;
}

/** Whether `agentId` is a running lead, so its terminal offers its chat. */
export function useIsLead(agentId: string | undefined): boolean {
  return useLeads().some((l) => l.agentId === agentId);
}

/** You've seen `agentId`'s reply: its call stops, and nebula hears it's
 *  read, as it does when you look at the thread. */
export function markLeadSeen(agent: Agent, reply: LeadReply | null) {
  if (reply) markSeenInChat(agent.id, reply.n, reply.at);
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
  const acts = leadActs();
  for (const l of leads) {
    const reply = replies[l.agentId] ?? null;
    // The reply's ASK lines the app took and you haven't answered: one it
    // refused (no such PR, another project's thread) doesn't call you.
    const outcome = acts.outcomes[l.agentId];
    const mine = !!reply && outcome?.n === reply.n && (outcome.at === undefined || outcome.at === reply.at);
    const asks = l.acts && reply && mine ? outcome!.asks.filter((a) => !isAnswered(askKey(l.agentId, reply.n, a, outcome!.at))).length : undefined;
    // Seen in its chat only: a lead's Read view mark counts entries, which a
    // restarted session numbers from 0 again.
    out[l.agentId] = callState({ reply, unseen: !!agents[l.agentId]?.unseen, seen: seenInChat(l.agentId), actions: l.acts, asks });
  }
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
  // An ask answered stops counting.
  const acts = useLeadActs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => callsFor(leads, agents), [leads, agents, v, acts]);
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
