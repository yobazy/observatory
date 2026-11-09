// Runs the triage pass (triage.ts) over every open session: once when the
// app connects, a few seconds after a session's status changes, every 5
// minutes for anything else, and on "Triage now". Off unless `triageOn`, so
// no model is called until you turn it on, and even then only threads that
// changed since their last read are sent. One pass at a time.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview, runTriage } from "./client";
import { getState, projectOfWorktree, subscribe, type State } from "./store";
import { stepsLine, type Transcript } from "./transcript";
import { summarize, type Turn } from "./turnsummary";
import { loadReviews, withReviews } from "./review";
import {
  ackState,
  keepStuck,
  loadAcks,
  loadTriage,
  previewTriageReply,
  pruneTriage,
  queueRows,
  saveTriage,
  staleMs,
  tailText,
  triagePass,
  type QueueRow,
  type TriageRecords,
  type TriageResult,
  type TriageSource,
} from "./triage";
import { loadStuck, stuckNeed, type StuckEntries } from "./stuck";
import { runStuckCheck } from "./stuckRunner";
import type { Agent } from "./types";

const EVERY = 5 * 60_000;
/** After a status change, wait for the rest of a burst before reading. */
const SETTLE = 8_000;
/** Entries before the end the tail is read from: plenty for 3,000 characters. */
const TAIL_ENTRIES = 12;
/** The store's prefs before desktop.json has been read. */
const unloaded = getState().prefs;

/** Each session's transcript length as last read, so a check asks only for
 *  what's new. Lost on quit; the first pass after a launch reads in full. */
const lengths = new Map<string, number>();

export interface TriageStatus {
  running: boolean;
  /** When the last pass finished (ms), and what came of it. */
  at: number | null;
  result: TriageResult | null;
}
let status: TriageStatus = { running: false, at: null, result: null };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<TriageStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}
export function useTriageStatus(): TriageStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

const readable = (a: Agent | undefined): a is Agent => !!a && !!a.session_id && (a.kind === "claude" || a.kind === "codex");

async function transcript(a: Agent, from: number | null): Promise<Transcript | null> {
  if (isPreview()) {
    const t = (await import("./mock")).mockTranscript(getState(), a.id);
    return t && { ...t, entries: t.entries.filter((e) => e.n >= (from ?? 0)) };
  }
  return invoke<Transcript | null>("thread_transcript", { session: a.session_id, from, kind: a.kind });
}

async function length(s: TriageSource): Promise<number | null> {
  const a = getState().agents[s.id];
  if (!readable(a)) return null;
  const known = lengths.get(a.id);
  const t = await transcript(a, known ? known - 1 : null);
  if (!t) return null;
  const last = t.entries[t.entries.length - 1];
  const n = last ? last.n + 1 : known ?? 0;
  lengths.set(a.id, n);
  return n;
}

async function context(s: TriageSource): Promise<{ tail: string; summary: string }> {
  const st = getState();
  const a = st.agents[s.id];
  if (!readable(a)) return { tail: "", summary: "" };
  const t = await transcript(a, Math.max(0, (s.length ?? 0) - TAIL_ENTRIES)).catch(() => null);
  const turn = isPreview()
    ? (await import("./mock")).mockTurn(st, a.id)
    : await invoke<Turn | null>("thread_turn", { session: a.session_id, kind: a.kind }).catch(() => null);
  const summary = turn
    ? summarize(turn, st.worktrees[a.worktree_id]?.path ?? "", a.status === "needs_feedback").headline.map((p) => p.text).join(" · ")
    : "";
  return { tail: t ? tailText(t.entries, stepsLine) : "", summary };
}

/** Every session as the pass reads it. */
function sources(s: State): TriageSource[] {
  return Object.values(s.agents).map((a) => ({
    id: a.id,
    status: a.status,
    status_changed_at: a.status_changed_at,
    archived: a.archived,
    name: a.name,
    project: projectOfWorktree(s, a.worktree_id)?.name ?? "",
    lastPrompt: a.recent_prompts[a.recent_prompts.length - 1]?.text ?? "",
    held: !!s.limits[a.id],
  }));
}

let running: Promise<TriageResult> | null = null;

function pass(): Promise<TriageResult> {
  if (running) return running;
  const s = getState();
  const list = sources(s);
  const byId = new Map(list.map((x) => [x.id, x]));
  setStatus({ running: true });
  running = triagePass({
    on: s.prefs.triageOn === true,
    sessions: list,
    records: loadTriage,
    save: (next: TriageRecords) => saveTriage(next),
    length,
    context,
    run: (prompt, parts) => runTriage(prompt, () => previewTriageReply(parts)),
    stuck: (stale) =>
      runStuckCheck((a) => {
        const x = byId.get(a.id);
        return !!x && stale(x);
      }),
    staleMs: staleMs(s.prefs.triageStaleDays),
  })
    .then((result) => {
      // Records for sessions nebula has deleted go; archived ones keep theirs.
      const agents = getState().agents;
      if (getState().loaded) pruneTriage((id) => !!agents[id]);
      for (const id of lengths.keys()) if (!agents[id]) lengths.delete(id);
      setStatus({ running: false, at: Date.now(), result });
      return result;
    })
    .catch((e) => {
      const result = { calls: 0, sent: 0, stale: 0, errors: [e instanceof Error ? e.message : String(e)] };
      setStatus({ running: false, at: Date.now(), result });
      return result;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** "Triage now": a pass, whatever the timer says. */
export function triageNow(): Promise<TriageResult> {
  return pass();
}

/** The queue as it stands: every open session with a label, ranked. The
 *  check before "done" (review.ts) has the last word on `checked`; a stuck
 *  flag (stuck.ts) has it over both the model and the review. */
export function queueOf(
  s: Pick<State, "agents" | "limits" | "git">,
  records = loadTriage(),
  acks = loadAcks(),
  reviews = loadReviews(),
  stuck: StuckEntries = loadStuck(),
): { rows: QueueRow[]; stale: QueueRow[] } {
  const why = (id: string) => stuckNeed(stuck, id);
  const queue = queueRows(Object.values(s.agents), records, acks, (id) => !!s.limits[id], why);
  const reviewed = withReviews(queue, s, reviews, (a) => acks[a.id] === ackState(a));
  return keepStuck(reviewed, why);
}

const ready = (s: State) => s.loaded && s.link.state === "connected" && s.prefs !== unloaded && s.prefs.triageOn === true;

/** The statuses a pass reads, as one string: a change to any schedules one. */
const statusKey = (s: State) =>
  Object.values(s.agents)
    .map((a) => `${a.id}:${a.status}:${a.status_changed_at}:${a.archived}`)
    .sort()
    .join(",");

/** Mount once. */
export function useTriageRunner() {
  useEffect(() => {
    let was = false;
    let lastKey = "";
    let lastAgents: State["agents"] | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const quiet = () => {
      if (ready(getState())) void pass();
    };
    const off = subscribe(() => {
      const s = getState();
      const now = ready(s);
      if (now && !was) {
        lastAgents = s.agents;
        lastKey = statusKey(s);
        quiet();
      } else if (now && s.agents !== lastAgents) {
        lastAgents = s.agents;
        const key = statusKey(s);
        if (key !== lastKey) {
          lastKey = key;
          if (settle) clearTimeout(settle);
          settle = setTimeout(quiet, SETTLE);
        }
      }
      was = now;
    });
    const timer = setInterval(quiet, EVERY);
    return () => {
      off();
      clearInterval(timer);
      if (settle) clearTimeout(settle);
    };
  }, []);
}
