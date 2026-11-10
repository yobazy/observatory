// Keeps the thread index (threadIndex.ts) current: an entry for each thread
// S7 has triaged and each archived thread, updated when triage writes its
// records or a thread is archived, retagged or gets a PR, and dropped once
// nebula deletes the thread. A thread with no need line from triage gets its
// latest turn summary instead, read from its log once (no model call).
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { getState, subscribe, type State } from "./store";
import { threadTagsOf } from "./threadtags";
import { loadTriage, type TriageRecords } from "./triage";
import { summarize, type Turn } from "./turnsummary";
import { loadIndex, refreshIndex, saveIndex, type IndexSource } from "./threadIndex";
import type { Agent } from "./types";

/** After a change, wait for the rest of a burst. */
const SETTLE = 3_000;
/** Triage writes its records outside the store: looked at this often too. */
const EVERY = 60_000;
/** Turn summaries read per refresh, so a first run over many archived
 *  threads doesn't read every log at once. */
const SUMMARIES_PER_PASS = 5;

/** Turn summaries read this run, by agent id; and those tried, so a thread
 *  with no log isn't asked again. */
const summaries = new Map<string, string>();
const tried = new Set<string>();

const readable = (a: Agent) => !!a.session_id && (a.kind === "claude" || a.kind === "codex");

async function turnSummary(a: Agent): Promise<string> {
  const st = getState();
  const turn = isPreview()
    ? (await import("./mock")).mockTurn(st, a.id)
    : await invoke<Turn | null>("thread_turn", { session: a.session_id, kind: a.kind }).catch(() => null);
  if (!turn) return "";
  return summarize(turn, st.worktrees[a.worktree_id]?.path ?? "", a.status === "needs_feedback")
    .headline.map((p) => p.text)
    .join(" · ");
}

/** The threads the index covers, as it sees them now. */
export function indexSources(s: State, records: TriageRecords, known = loadIndex()): IndexSource[] {
  const out: IndexSource[] = [];
  for (const a of Object.values(s.agents)) {
    const rec = records[a.id];
    if (!rec && !a.archived) continue;
    const wt = s.worktrees[a.worktree_id];
    const projectId = wt?.project_id ?? known[a.id]?.projectId;
    if (!projectId) continue;
    const pr = s.prs[a.worktree_id];
    out.push({
      id: a.id,
      projectId,
      title: a.name,
      branch: wt?.branch ?? null,
      pr: pr?.kind === "found" ? { number: pr.pr.number, title: pr.pr.title } : undefined,
      tags: threadTagsOf(s.prefs, a.id),
      need: rec?.need ?? null,
      turnSummary: summaries.get(a.id) ?? null,
      archived: a.archived,
      ...(a.archived && a.archived_at ? { archivedAt: a.archived_at } : {}),
      at: a.status_changed_at,
    });
  }
  return out;
}

let busy = false;

async function refresh() {
  const s = getState();
  if (!s.loaded || s.link.state !== "connected" || busy) return;
  busy = true;
  try {
    const index = loadIndex();
    // Summaries for indexed threads triage has no line for, a few at a time.
    const records = loadTriage();
    let read = 0;
    for (const a of Object.values(s.agents)) {
      if (read >= SUMMARIES_PER_PASS) break;
      if (records[a.id]?.need || index[a.id]?.summary || tried.has(a.id)) continue;
      if (!records[a.id] && !a.archived) continue;
      tried.add(a.id);
      if (!readable(a)) continue;
      read++;
      const text = await turnSummary(a).catch(() => "");
      if (text) summaries.set(a.id, text);
    }
    const now = getState();
    const next = refreshIndex(loadIndex(), indexSources(now, loadTriage()), (id) => !!now.agents[id]);
    if (next !== loadIndex()) saveIndex(next);
    for (const id of summaries.keys()) if (!now.agents[id]) summaries.delete(id);
  } finally {
    busy = false;
  }
}

/** What the index is made from, by identity: a change to any schedules a refresh. */
const inputs = (s: State) => [s.agents, s.worktrees, s.prs, s.prefs.threadTags, loadTriage()];

/** Mount once. */
export function useThreadIndexRunner() {
  useEffect(() => {
    let last: unknown[] = [];
    let settle: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const s = getState();
      if (!s.loaded) return;
      const now = inputs(s);
      if (now.every((x, i) => x === last[i])) return;
      last = now;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => void refresh(), SETTLE);
    };
    const off = subscribe(check);
    const timer = setInterval(check, EVERY);
    check();
    return () => {
      off();
      clearInterval(timer);
      if (settle) clearTimeout(settle);
    };
  }, []);
}
