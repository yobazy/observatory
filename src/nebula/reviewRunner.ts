// Runs the check before "done" (review.ts) when a thread's turn ends while
// the app is watching: the thread was seen running, and now isn't. Threads
// already finished when the app started, or opened to read, are never
// reviewed. Off unless `reviewOn`. Each review runs its card's checks in
// the checkout and makes one reviewer call; one review at a time.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview, readCardSources, reviewState, runChecks, runReviewer } from "./client";
import { allBatches } from "./batch";
import { allCards, cardFor, draftChecks } from "./cards";
import { leadIds } from "./lead";
import { baseBranch, loadDiff } from "./diff";
import { refreshGit } from "./git";
import { enqueue } from "./queue";
import {
  criteriaFor,
  failsSoFar,
  freshRound,
  hasChanges,
  loadReviews,
  needsReview,
  previewReviewReply,
  promptedTurn,
  pruneReviews,
  reviewKey,
  reviewPass,
  saveReview,
  setChecking,
} from "./review";
import { getState, projectOfWorktree, subscribe } from "./store";
import type { Transcript } from "./transcript";
import { loadTriage } from "./triage";
import { triageNow } from "./triageRunner";
import type { Agent } from "./types";

/** After a turn ends, wait for the burst of status changes and the git
 *  poll before looking. */
const SETTLE = 10_000;

/** HEAD when each watched thread's turn started, so new commits count as
 *  changes, and when it started. Lost on quit. */
const starts = new Map<string, { head: string | null; at: number }>();
const waiting = new Map<string, ReturnType<typeof setTimeout>>();
let chain: Promise<unknown> = Promise.resolve();

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The thread's first prompt: from its log when it can be read, else the
 *  oldest prompt nebula still lists. */
async function firstPrompt(a: Agent): Promise<string> {
  const oldest = [...a.recent_prompts].sort((x, y) => x.submitted_at - y.submitted_at)[0];
  const fallback = oldest?.text ?? "";
  if (!a.session_id || (a.kind !== "claude" && a.kind !== "codex")) return fallback;
  try {
    const t = isPreview()
      ? (await import("./mock")).mockTranscript(getState(), a.id)
      : await invoke<Transcript | null>("thread_transcript", { session: a.session_id, from: 0, kind: a.kind });
    return t?.entries.find((e) => e.kind === "you")?.text ?? fallback;
  } catch {
    return fallback;
  }
}

/** The card's checks, drafted from the checkout's files when the card has
 *  none saved yet (or there's no card). */
async function checksFor(projectId: string, path: string): Promise<{ checks: string[]; off: boolean }> {
  const card = cardFor(projectId);
  if (card?.checks) return { checks: card.checks, off: card.reviewOff === true };
  const sources = await readCardSources(path).catch(() => null);
  return { checks: sources ? draftChecks(sources.files) : [], off: card?.reviewOff === true };
}

/** The Dispatch task this thread took, if it took one. */
function taskText(agentId: string): string | null {
  for (const b of allBatches()) for (const t of b.tasks) if (t.agentId === agentId) return t.text;
  return null;
}

async function review(agentId: string) {
  let s = getState();
  const a0 = s.agents[agentId];
  // A project's lead, or the top lead, isn't reviewed: nothing is triaged or checked for it.
  if (!a0 || s.prefs.reviewOn !== true || leadIds(allCards(), getState().prefs.topLead).has(agentId)) return;
  const wt = s.worktrees[a0.worktree_id];
  const project = projectOfWorktree(s, a0.worktree_id);
  if (!wt || !project) return;
  // Triage first, so a turn that ended on a question isn't reviewed.
  if (s.prefs.triageOn === true) await triageNow().catch(() => null);
  await refreshGit([wt.id]);
  s = getState();
  const a = s.agents[agentId];
  const g = s.git[wt.id];
  if (!a || a.archived || a.status === "running" || !g || "error" in g) return;
  // The content, not just the counts: a fix on the same line as the break
  // changes no count, and must still get its second review.
  const content = await reviewState(wt.path).catch(() => null);
  if (content === null) return;
  const key = reviewKey(g, content);
  const rec = loadReviews()[a.id];
  const fresh = freshRound(rec, a.recent_prompts);
  const { checks, off } = await checksFor(project.id, wt.path);
  const label = a.status === "needs_feedback" || s.limits[a.id] ? "decision" : loadTriage()[a.id]?.label;
  const start = starts.get(a.id);
  if (!promptedTurn(a.recent_prompts, start?.at)) return;
  const changed = hasChanges(g, start?.head);
  const lead = leadIds(allCards(), getState().prefs.topLead).has(a.id);
  if (!needsReview({ changed, label, checks, off, key, rec, fresh, lead })) return;
  setChecking(a.id, true);
  try {
    await reviewPass({
      on: true,
      prev: rec,
      fails: failsSoFar(rec, fresh),
      key,
      checks,
      context: async () => {
        const diff = await loadDiff(wt, baseBranch(wt) ? "branch" : "uncommitted").catch(() => null);
        return {
          project: project.name,
          branch: wt.branch,
          criteria: criteriaFor(taskText(a.id), await firstPrompt(a)),
          files: diff?.files ?? [],
          truncated: diff?.truncated,
        };
      },
      snapshot: () => reviewState(wt.path),
      runChecks: (c) => runChecks(wt.path, c),
      runReviewer: (prompt) => runReviewer(wt.path, prompt, () => previewReviewReply(prompt)),
      busy: () => getState().agents[a.id]?.status === "running",
      send: (text) => enqueue(getState().agents[a.id] ?? a, text, { stay: true }),
      save: (r) => saveReview(a.id, r),
    });
  } catch (e) {
    saveReview(a.id, { state: "error", key, failures: [], error: errText(e), fails: failsSoFar(rec, fresh), at: Date.now() });
  } finally {
    setChecking(a.id, false);
    const agents = getState().agents;
    if (getState().loaded) pruneReviews((id) => !!agents[id]);
  }
}

/** Queue a review for after the settle, one at a time. */
function schedule(agentId: string) {
  const prev = waiting.get(agentId);
  if (prev) clearTimeout(prev);
  waiting.set(
    agentId,
    setTimeout(() => {
      waiting.delete(agentId);
      chain = chain.then(() => review(agentId)).catch(() => null);
    }, SETTLE),
  );
}

/** A status change seen: a turn starting is noted, one ending is queued
 *  for review. */
function changed(agent: Agent, from: Agent["status"]) {
  if (agent.status === "running") {
    const g = getState().git[agent.worktree_id];
    starts.set(agent.id, { head: g && !("error" in g) ? g.head : null, at: Date.now() });
    const t = waiting.get(agent.id);
    if (t) clearTimeout(t);
    waiting.delete(agent.id);
  } else if (from === "running" && getState().prefs.reviewOn === true) schedule(agent.id);
}

/** Mount once. Watches the store's statuses rather than the daemon's
 *  events, so the browser preview's turns count too. Statuses first seen
 *  (on load, or a new thread) are only noted: only a turn this app saw
 *  running is reviewed, never an old thread opened to read. */
export function useReviewRunner() {
  useEffect(() => {
    const seen = new Map<string, Agent["status"]>();
    let agents: Record<string, Agent> | null = null;
    const check = () => {
      const s = getState();
      if (s.agents === agents) return;
      agents = s.agents;
      for (const a of Object.values(s.agents)) {
        const was = seen.get(a.id);
        seen.set(a.id, a.status);
        // First seen: noted only. One already running counts once it ends,
        // with its start unknown.
        if (was !== undefined && was !== a.status) changed(a, was);
      }
      for (const id of seen.keys()) if (!s.agents[id]) seen.delete(id);
    };
    const off = subscribe(check);
    check();
    return () => {
      off();
      waiting.forEach((t) => clearTimeout(t));
      waiting.clear();
    };
  }, []);
}
