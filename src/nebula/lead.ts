// A project's lead: one long-lived thread per project, off unless started
// from the project's card, that hears about each of the project's tasks as
// they finish, fail, need you or open a PR, and keeps the project's notes.
// This file is the pure part: which changes are events, the line each makes,
// how lines pile up for a busy lead, the starting prompt, and the link it
// follows up with. leadRunner.ts wires it to the store. Kept free of the app
// so its tests run under plain Node.
import type { CardLead, Cards } from "./cards";
import type { AgentStatus } from "./types";

export type LeadEventKind = "finished" | "failed" | "needs you" | "PR opened";

/** A thread as the lead watches it, polled from the store. `failed` is the
 *  mark of what flagged it: an S9 stuck flag, or a failed review. `pr` is
 *  the number of the open (or draft) PR on its branch. */
export interface ThreadState {
  id: string;
  projectId: string | null;
  status: AgentStatus;
  archived: boolean;
  failed: string | null;
  pr: number | null;
}
export type Snapshot = Record<string, ThreadState>;

/** Each project with a running lead, by project id: the lead's agent id. */
export type Leads = Record<string, string>;

export interface LeadEvent {
  kind: LeadEventKind;
  threadId: string;
  projectId: string;
  leadId: string;
}

/** What changed between two polls, as events for the leads that hear of
 *  them. A thread seen for the first time makes none (it's the baseline),
 *  nor does a lead's own thread, an archived one, or one in a project
 *  without a running lead. The same state seen twice makes nothing new. */
export function leadEvents(before: Snapshot, after: Snapshot, leads: Leads): LeadEvent[] {
  const leadIds = new Set(Object.values(leads));
  const out: LeadEvent[] = [];
  for (const t of Object.values(after)) {
    const was = before[t.id];
    const leadId = t.projectId ? leads[t.projectId] : undefined;
    if (!was || !leadId || !t.projectId || leadIds.has(t.id) || t.archived) continue;
    const add = (kind: LeadEventKind) => out.push({ kind, threadId: t.id, projectId: t.projectId!, leadId });
    if (was.status === "running" && t.status === "finished") add("finished");
    if (was.status !== "needs_feedback" && t.status === "needs_feedback") add("needs you");
    if (t.failed && t.failed !== was.failed) add("failed");
    if (t.pr !== null && t.pr !== was.pr) add("PR opened");
  }
  return out;
}

// ---- the line ----

export const LINE_PREFIX = "[observatory] ";
export const MAX_LINE = 300;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** One event as the lead reads it:
 *  `[observatory] finished: Fix login on fix-login (agent a1): Needs review of the redirect`,
 *  at most MAX_LINE characters. */
export function eventLine(e: { kind: LeadEventKind; title: string; branch: string; agentId: string; need: string }): string {
  const need = oneLine(e.need);
  const line = `${LINE_PREFIX}${e.kind}: ${oneLine(e.title)} on ${oneLine(e.branch)} (agent ${e.agentId})${need ? `: ${need}` : ""}`;
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
}

/** What the line says the thread needs: S7's need line when it was read in
 *  the thread's current state, else for a failure what flagged it, else
 *  its latest turn summary. */
export function eventNeed(
  kind: LeadEventKind,
  thread: { status: AgentStatus; status_changed_at: number },
  record: { need: string; key: string } | undefined,
  failed: string | null,
  summary: string,
): string {
  if (record?.need && record.key.startsWith(`${thread.status}|${thread.status_changed_at}|`)) return record.need;
  if (kind === "failed" && failed) return failed;
  return summary;
}

// ---- sending ----

/** The lead's side of queue.ts: its last queued prompt, enqueue() and
 *  editQueued(), given so the batching can be tested without the app. */
export interface LeadQueue {
  last: () => { id: string; text: string } | null;
  enqueue: (text: string) => Promise<"sent" | "queued">;
  edit: (id: string, text: string) => boolean;
}

/** Send event lines to a lead. While it's busy they wait in its queue as one
 *  message: a line that comes while event lines are already queued joins
 *  them, so the lead gets them all at once when its turn ends. */
export async function deliver(lines: string[], q: LeadQueue): Promise<"sent" | "queued" | "added" | null> {
  if (!lines.length) return null;
  const last = q.last();
  if (last?.text.startsWith(LINE_PREFIX) && q.edit(last.id, `${last.text}\n${lines.join("\n")}`)) return "added";
  return q.enqueue(lines.join("\n"));
}

// ---- the lead itself ----

export const DEFAULT_LEAD_MODEL = "haiku";
/** Where leads keep their notes: outside every repo. */
export const LEADS_DIR = "~/.config/observatory/leads";

/** A project name as a file name. */
const fileName = (name: string) => oneLine(name).replace(/[/\\:]+/g, "-") || "project";

export function defaultNotes(project: string): string {
  return `${LEADS_DIR}/${fileName(project)}.md`;
}

/** The name a lead's thread goes by (S26 renames it to this so threads can
 *  `nebula ask` it). */
export const leadName = (project: string) => `Lead ${oneLine(project)}`;

export const modelCommand = (model: string) => `/model ${oneLine(model)}`;

export type LeadState = "none" | "running" | "stopped";

/** Whether a card's lead is there to hear events: stopped once its thread
 *  is archived or gone. */
export function leadState(lead: CardLead | undefined, agents: Record<string, { archived: boolean }>): LeadState {
  if (!lead) return "none";
  const a = agents[lead.agentId];
  return a && !a.archived ? "running" : "stopped";
}

/** The projects with a running lead. Only project cards: a plain folder's
 *  Home card has no threads of its own. */
export function runningLeads(cards: Cards, agents: Record<string, { archived: boolean }>, projects: Record<string, unknown>): Leads {
  const out: Leads = {};
  for (const [key, card] of Object.entries(cards))
    if (card.lead && projects[key] && leadState(card.lead, agents) === "running") out[key] = card.lead.agentId;
  return out;
}

/** Every lead's thread, running or stopped, and the top lead's (S26,
 *  leadAsk.ts) when there is one: left out of triage, stuck checks, parking
 *  and review. */
export function leadIds(cards: Cards, top?: { agentId: string } | null): Set<string> {
  const ids = new Set(Object.values(cards).flatMap((c) => (c.lead ? [c.lead.agentId] : [])));
  if (top?.agentId) ids.add(top.agentId);
  return ids;
}

export interface LeadPromptInput {
  project: string;
  /** The project's main checkout, where the lead runs. */
  path: string;
  notes: string;
}

/** The lead's starting prompt: what it is, where its notes live, what event
 *  lines look like, and how it acts. `extra` adds sections after these (S26:
 *  how it answers other threads' questions). */
export function leadPrompt(p: LeadPromptInput, extra: string[] = []): string {
  const sections = [
    `You are the lead for the project ${p.project} (${p.path}). You hold the thread of this project across its tasks, so I don't have to. You don't do the tasks yourself: other threads do, and Observatory tells you about them.`,
    `Your notes live in ${p.notes}, outside the repo. Create the file (and its folder) if it isn't there, and read it now. Keep it current: what each task is for, what finished, what failed and why, open PRs, decisions I made, and what should happen next. Keep it short enough to reread.`,
    `Observatory sends you one line per event, several at once when they piled up while you were busy:
[observatory] <event>: <thread title> on <branch> (agent <id>): <what it needs, or its turn summary>
The events are: finished (its turn ended), failed (it's stuck on the same error, near its budget, or failed review), needs you (it's waiting on me), and PR opened. For each line, update your notes. Reply in a sentence or two; don't wait for me.`,
    `You can suggest work. Nothing you open starts or sends on its own: I see it prefilled and decide. URL-encode the text.
- To start a new task in a project: open "observatory://new-task?project=<project name or path>&prompt=<brief>&from=$NEBULA_AGENT_ID"
- To follow up on one of this project's threads: open "observatory://follow-up?agent=<its agent id>&prompt=<text>&from=$NEBULA_AGENT_ID"
Do this when a task clearly needs a next step, not after every line. Don't edit the project's files, commit, push or merge.`,
    ...extra,
  ];
  return sections.map((s) => s.trim()).filter(Boolean).join("\n\n");
}

export interface StartDeps {
  /** Start a thread in the project's main worktree with `prompt`; its id. */
  create: (prompt: string, model: string) => Promise<string | null>;
  /** Type `text` into the thread (queued while it's mid-turn). */
  send: (agentId: string, text: string) => Promise<unknown>;
  save: (lead: CardLead) => void;
}

/** Start a lead: the thread with its prompt, the card told its id (before
 *  anything else, so it's left out of triage from the start), then
 *  `/model <model>` as its first input. Also how Restart starts afresh. */
export async function startLead(p: LeadPromptInput & { model: string }, deps: StartDeps, extra: string[] = []): Promise<CardLead> {
  return startLeadThread(leadPrompt(p, extra), { model: p.model, notes: p.notes }, deps);
}

/** startLead with the prompt given: also how the top lead (leadAsk.ts),
 *  whose prompt isn't a project's, starts. */
export async function startLeadThread(
  prompt: string,
  p: { model: string; notes: string },
  deps: StartDeps,
  fallbackModel = DEFAULT_LEAD_MODEL,
): Promise<CardLead> {
  const model = oneLine(p.model) || fallbackModel;
  const agentId = await deps.create(prompt, model);
  if (!agentId) throw new Error("nebula didn't start the lead's thread");
  const lead: CardLead = { agentId, model, notes: p.notes };
  deps.save(lead);
  await deps.send(agentId, modelCommand(model));
  return lead;
}

/** A new model on the card: saved, and sent as `/model <name>` when the lead
 *  is running. The same model again does nothing. */
export async function changeLeadModel(
  lead: CardLead,
  model: string,
  running: boolean,
  deps: Pick<StartDeps, "send" | "save">,
): Promise<CardLead> {
  const next = oneLine(model);
  if (!next || next === lead.model) return lead;
  const changed = { ...lead, model: next };
  deps.save(changed);
  if (running) await deps.send(lead.agentId, modelCommand(next));
  return changed;
}

// ---- follow-up links ----

/** Whether an `observatory://follow-up` link may open: the thread it names
 *  is in the project of the lead that sent it, and isn't the lead itself.
 *  The thread's id, or why not. */
export function checkFollowUp(
  link: { agent: string; from: string | null },
  agents: Record<string, { name: string; worktree_id: string }>,
  projectOf: (agentId: string) => string | null,
  leads: Leads,
): { agentId: string } | { error: string } {
  const thread = agents[link.agent];
  if (!thread) return { error: "The follow-up link names a thread Observatory doesn't know." };
  const projectId = projectOf(link.agent);
  const leadId = projectId ? leads[projectId] : undefined;
  if (!leadId) return { error: `${thread.name} is in a project without a running lead, so the follow-up was refused.` };
  if (link.agent === leadId) return { error: "A lead can't follow up on its own thread." };
  if (link.from !== leadId) return { error: `Only its project's lead can follow up on ${thread.name}; the link came from elsewhere.` };
  return { agentId: link.agent };
}
