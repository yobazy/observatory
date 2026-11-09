// Wires the project leads (lead.ts) to the app: watches the store for each
// thread's status, its stuck flag and the PR on its branch, and sends the
// events to its project's lead through enqueue() (queue.ts), so a busy lead
// gets them, batched, when its turn ends. Nothing is watched for a project
// without a running lead, and nothing is sent while a lead is stopped.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createAgent, defaultKind } from "./actions";
import { allCards, saveLead, type CardLead, type ProjectCard } from "./cards";
import { isPreview, readSettings } from "./client";
import {
  changeLeadModel,
  deliver,
  eventLine,
  eventNeed,
  leadEvents,
  reviewMark,
  leadState,
  runningLeads,
  startLead,
  type LeadEvent,
  type Snapshot,
} from "./lead";
import { editQueued, enqueue } from "./queue";
import { flash, getState, subscribe, type State } from "./store";
import { loadStuck, type StuckEntries } from "./stuck";
import { loadTriage } from "./triage";
import { failedCount, loadReviews, type ReviewRecords } from "./review";
import { summarize, type Turn } from "./turnsummary";
import type { Agent } from "./types";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Each thread as the leads watch it. */
export function snapshot(s: Pick<State, "agents" | "worktrees" | "prs">, stuck: StuckEntries, reviews: ReviewRecords = {}): Snapshot {
  const out: Snapshot = {};
  for (const a of Object.values(s.agents)) {
    const pr = s.prs[a.worktree_id];
    const raised = stuck[a.id]?.raised;
    out[a.id] = {
      id: a.id,
      projectId: s.worktrees[a.worktree_id]?.project_id ?? null,
      status: a.status,
      archived: a.archived,
      failed: raised ? `${raised.kind}:${raised.mark}` : null,
      review: reviewMark(reviews[a.id]),
      pr: pr?.kind === "found" && (pr.pr.state === "open" || pr.pr.state === "draft") ? pr.pr.number : null,
    };
  }
  return out;
}

async function turnSummary(a: Agent): Promise<string> {
  if (!a.session_id || (a.kind !== "claude" && a.kind !== "codex")) return "";
  const st = getState();
  const turn = isPreview()
    ? (await import("./mock")).mockTurn(st, a.id)
    : await invoke<Turn | null>("thread_turn", { session: a.session_id, kind: a.kind }).catch(() => null);
  if (!turn) return "";
  return summarize(turn, st.worktrees[a.worktree_id]?.path ?? "", a.status === "needs_feedback")
    .headline.map((p) => p.text)
    .join(" · ");
}

async function lineFor(e: LeadEvent): Promise<string | null> {
  const s = getState();
  const a = s.agents[e.threadId];
  if (!a) return null;
  const raised = loadStuck()[a.id]?.raised;
  const record = loadTriage()[a.id];
  const fresh = record?.key.startsWith(`${a.status}|${a.status_changed_at}|`);
  const rev = loadReviews()[a.id];
  const failed =
    raised?.reason ??
    (rev?.state === "failed" ? [failedCount(rev.failures.length), rev.failures[0]].filter(Boolean).join(": ") : null);
  const summary = fresh || (e.kind === "failed" && failed) ? "" : await turnSummary(a).catch(() => "");
  return eventLine({
    kind: e.kind,
    title: a.name,
    branch: s.worktrees[a.worktree_id]?.branch ?? "?",
    agentId: a.id,
    need: eventNeed(e.kind, a, record, failed, summary),
  });
}

/** Wait for a thread nebula just made to show up in the store. */
async function arrived(agentId: string, ms = 15_000): Promise<Agent> {
  const deadline = Date.now() + ms;
  for (;;) {
    const a = getState().agents[agentId];
    if (a) return a;
    if (Date.now() > deadline) throw new Error("the lead's thread didn't show up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Type `text` into a lead, queued behind its turn, without leaving the view. */
async function sendToLead(agentId: string, text: string) {
  return enqueue(await arrived(agentId), text, { stay: true });
}

/** One send at a time per lead, so a line can't race the one before it. */
const chains = new Map<string, Promise<unknown>>();
function inTurn(leadId: string, job: () => Promise<unknown>) {
  const next = (chains.get(leadId) ?? Promise.resolve()).then(job).catch((e) => flash(`Couldn't tell the lead: ${errText(e)}`));
  chains.set(leadId, next);
  return next;
}

async function send(leadId: string, events: LeadEvent[]) {
  const lines = (await Promise.all(events.map((e) => lineFor(e).catch(() => null)))).filter((l): l is string => !!l);
  const lead = getState().agents[leadId];
  // Stopped meanwhile: nothing goes.
  if (!lead || lead.archived) return;
  await deliver(lines, {
    last: () => {
      const q = getState().queue[leadId] ?? [];
      return q[q.length - 1] ?? null;
    },
    enqueue: (text) => enqueue(getState().agents[leadId] ?? lead, text, { stay: true }),
    edit: (id, text) => editQueued(leadId, id, text),
  });
}

/** "Start a lead" (and Restart) on a project's card. `base` is the card as
 *  the dialog has it, for a project with no card saved yet. */
export async function startProjectLead(projectId: string, opts: { model: string; notes: string; base?: ProjectCard }): Promise<CardLead> {
  const s = getState();
  const project = s.projects[projectId];
  const main = Object.values(s.worktrees).find((w) => w.project_id === projectId && w.is_main);
  if (!project || !main) throw new Error("the project has no main checkout to run its lead in");
  const settings = await readSettings();
  const kind = defaultKind(settings);
  return startLead(
    { project: project.name, path: main.path, notes: opts.notes, model: opts.model },
    {
      create: (prompt, model) =>
        createAgent({ worktree: main.id, kind, settings, prompt, preset: { name: "Lead", kind, model }, select: false }),
      send: sendToLead,
      save: (lead) => saveLead(projectId, lead, opts.base),
    },
  );
}

/** The model field on a card with a lead: saved, and sent when it runs. */
export function setLeadModel(projectId: string, lead: CardLead, model: string) {
  const running = leadState(lead, getState().agents) === "running";
  return changeLeadModel(lead, model, running, {
    send: sendToLead,
    save: (next) => saveLead(projectId, next),
  });
}

/** Mount once. */
export function useLeadRunner() {
  useEffect(() => {
    let before: Snapshot | null = null;
    let seen: { agents: State["agents"]; prs: State["prs"]; stuck: StuckEntries; reviews: ReviewRecords } | null = null;
    const tick = () => {
      const s = getState();
      if (!s.loaded || s.link.state !== "connected") return;
      const stuck = loadStuck();
      const reviews = loadReviews();
      if (seen && seen.agents === s.agents && seen.prs === s.prs && seen.stuck === stuck && seen.reviews === reviews) return;
      seen = { agents: s.agents, prs: s.prs, stuck, reviews };
      const after = snapshot(s, stuck, reviews);
      const events = before ? leadEvents(before, after, runningLeads(allCards(), s.agents, s.projects)) : [];
      before = after;
      const byLead = new Map<string, LeadEvent[]>();
      for (const e of events) byLead.set(e.leadId, [...(byLead.get(e.leadId) ?? []), e]);
      for (const [leadId, list] of byLead) void inTurn(leadId, () => send(leadId, list));
    };
    const off = subscribe(tick);
    // Stuck flags and reviews are kept outside the store: look now and then.
    const timer = setInterval(tick, 5_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
}
