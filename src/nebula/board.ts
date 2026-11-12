// The Dispatch board's logic: where each dispatched task stands, the order
// the board lists them in, the words a plan checkpoint is answered with, and
// when a batch has settled enough for its one summary banner. Pure, with the
// app's state passed in, so it can be tested in Node; DispatchBoard.tsx
// renders it and batchRunner.ts fires the summary.
// Value imports name their .ts files: the tests load this module in Node.
import { urgency } from "./store.ts";
import { occupies, type Batch, type BatchTask } from "./batch.ts";
import type { Agent } from "./types";

/** Where a task stands, from the board's side:
 *  - pending / launching / blocked / failed / listed: batch.ts's states,
 *    before (or instead of) a session.
 *  - plan: its session stopped at its plan and wants an OK.
 *  - waiting: its session is waiting on you (needs_feedback).
 *  - working: its session is on it (or starting, or its prompt is queued).
 *  - finished / stopped: its session finished its turn / stopped with an error.
 *  - archived / gone: its session was archived / is no longer there.
 *  - cancelled: cancelled at its plan from the board.
 *  - done: checked off. */
export type Phase =
  | "pending"
  | "launching"
  | "blocked"
  | "failed"
  | "listed"
  | "plan"
  | "waiting"
  | "working"
  | "finished"
  | "stopped"
  | "archived"
  | "gone"
  | "cancelled"
  | "done";

/** Prompts queued for an agent (queue.ts), by id. */
export type QueuedFor = (agentId: string) => number;

/** Whether a task's session has stopped at its plan for an OK: the task
 *  asked for a checkpoint that hasn't been given, and its session finished a
 *  turn since the task's prompt went out (or since it was last redirected),
 *  with nothing more queued for it. A session waiting on you instead (a
 *  permission prompt) is answered with QuickAnswer, not Approve: typing
 *  "go ahead" into a picker would pick whatever row is current. */
export function awaitingPlan(t: BatchTask, agent: Agent | undefined, queued = 0): boolean {
  if (!t.planCheckpoint || t.planApproved || t.cancelled || t.state !== "launched") return false;
  if (!agent || agent.archived || agent.status !== "finished" || queued > 0) return false;
  // launchingAt, not launchedAt: it's stamped before the prompt goes, so a
  // chat's earlier finished turn never counts and a quick plan turn always does.
  const since = Math.max(t.launchingAt ?? t.launchedAt ?? 0, t.planAnsweredAt ?? 0);
  return agent.status_changed_at > since;
}

export function phaseOf(
  t: BatchTask,
  agents: Record<string, Agent>,
  queued: QueuedFor = () => 0,
  now = Date.now(),
): Phase {
  if (t.done) return "done";
  if (t.cancelled) return "cancelled";
  if (t.state !== "launched") return t.state;
  const a = t.agentId ? agents[t.agentId] : undefined;
  if (!a) return occupies(t, agents, now) ? "working" : "gone";
  if (a.archived) return "archived";
  const q = queued(a.id);
  if (awaitingPlan(t, a, q)) return "plan";
  if (q > 0) return "working";
  if (a.status === "needs_feedback") return "waiting";
  if (a.status === "finished") return "finished";
  if (a.status === "terminated") return "stopped";
  return "working";
}

/** Phases that won't move without you (or ever): a batch is settled when
 *  every task is in one. */
const SETTLED = new Set<Phase>([
  "blocked",
  "failed",
  "listed",
  "plan",
  "waiting",
  "finished",
  "stopped",
  "archived",
  "gone",
  "cancelled",
  "done",
]);

export function isSettled(p: Phase): boolean {
  return SETTLED.has(p);
}

/** How soon a row wants you: lower sorts first. Rows with a session rank as
 *  `urgency()` ranks the session (waiting on you first, then working, then
 *  finished and unseen); a plan stop ranks with waiting on you, and the
 *  states without a session fit in between. */
export function rowRank(p: Phase, agent: Agent | undefined): number {
  switch (p) {
    case "plan":
      return 0;
    case "waiting":
    case "working":
    case "finished":
      return agent ? urgency(agent) : 1;
    case "failed":
    case "blocked":
    case "stopped":
      return 0.5;
    case "launching":
      return 1;
    case "pending":
      return 1.5;
    case "listed":
      return 2.5;
    default:
      return 4;
  }
}

export interface Row {
  batchId: string;
  task: BatchTask;
  agent?: Agent;
  phase: Phase;
}

/** The board's rows, across batches: needs-you first, then by plan order. */
export function sortRows(rows: Row[]): Row[] {
  return rows
    .map((r, i) => ({ r, i, k: rowRank(r.phase, r.agent) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.r);
}

export function boardRows(
  batches: Batch[],
  agents: Record<string, Agent>,
  queued: QueuedFor = () => 0,
  now = Date.now(),
): Row[] {
  const rows: Row[] = [];
  for (const b of batches) {
    if (b.dismissed) continue;
    for (const t of b.tasks) {
      rows.push({
        batchId: b.id,
        task: t,
        agent: t.agentId ? agents[t.agentId] : undefined,
        phase: phaseOf(t, agents, queued, now),
      });
    }
  }
  return sortRows(rows);
}

// ---- the board's sections ----

/** The board's sections, in the order it lists them:
 *  - needs: won't move until you act (a plan, a question, a failure, a
 *    block, a session that stopped, a task a budget holds).
 *  - review: its session finished its turn, and nobody has checked it off.
 *  - running: a session is on it, or its launch is out.
 *  - next: waiting for a slot, or on your own list.
 *  - done: checked off, archived, gone or cancelled. */
export type Group = "needs" | "review" | "running" | "next" | "done";

export const GROUP_LABEL: Record<Group, string> = {
  needs: "Needs you",
  review: "To review",
  running: "Running",
  next: "Up next",
  done: "Done",
};

const GROUP_ORDER: Group[] = ["needs", "review", "running", "next", "done"];

/** Which section a row is listed in. `held`: a budget holds the task, so
 *  it waits on you rather than on a slot. */
export function groupOf(p: Phase, held = false): Group {
  switch (p) {
    case "plan":
    case "waiting":
    case "failed":
    case "blocked":
    case "stopped":
      return "needs";
    case "finished":
      return "review";
    case "working":
    case "launching":
      return "running";
    case "pending":
      return held ? "needs" : "next";
    case "listed":
      return "next";
    default:
      return "done";
  }
}

export interface RowGroup {
  key: Group;
  label: string;
  rows: Row[];
}

/** The rows in their sections, keeping their order within each; empty
 *  sections are left out. `urgent`: rows triage says need you (a decision,
 *  or stuck), which go under Needs you whatever their phase. */
export function groupRows(
  rows: Row[],
  held: (r: Row) => boolean = () => false,
  urgent: (r: Row) => boolean = () => false,
): RowGroup[] {
  const by = new Map<Group, Row[]>(GROUP_ORDER.map((g) => [g, []]));
  for (const r of rows) by.get(urgent(r) ? "needs" : groupOf(r.phase, held(r)))!.push(r);
  return GROUP_ORDER.filter((g) => by.get(g)!.length).map((g) => ({ key: g, label: GROUP_LABEL[g], rows: by.get(g)! }));
}

/** Batches whose every task is done (checked off, archived, gone or
 *  cancelled), which Clear done takes off the board. A batch with anything
 *  left (a failure, a finished turn nobody looked at, a task on your list)
 *  stays: it dismisses as a whole, and that would hide what's left. */
export function clearableBatches(rows: Row[], urgent: (r: Row) => boolean = () => false): string[] {
  const left = new Set<string>();
  const seen: string[] = [];
  for (const r of rows) {
    if (!seen.includes(r.batchId)) seen.push(r.batchId);
    if (urgent(r) || groupOf(r.phase) !== "done") left.add(r.batchId);
  }
  return seen.filter((id) => !left.has(id));
}

/** What dismissing a batch would hide besides its done tasks:
 *  "1 failed, 1 blocked", or "" when nothing is. */
export function hiddenByDismiss(rows: Row[], batchId: string, urgent: (r: Row) => boolean = () => false): string {
  const n = new Map<string, number>();
  for (const r of rows) {
    if (r.batchId !== batchId || (groupOf(r.phase) === "done" && !urgent(r))) continue;
    const what = urgent(r) && groupOf(r.phase) !== "needs" ? "needing you" : r.phase === "finished" ? "to review" : r.phase === "listed" ? "on your list" : r.phase === "plan" || r.phase === "waiting" ? "waiting on you" : r.phase;
    n.set(what, (n.get(what) ?? 0) + 1);
  }
  return [...n].map(([what, k]) => `${k} ${what}`).join(", ");
}

/** What goes under a row's title: the task's whole text when the title is
 *  its session's name, else what's left after the title (from "…" when the
 *  title was clipped); null when that's nothing. */
export function taskBody(text: string, title: string): string | null {
  const t = text.trim();
  if (title.endsWith("…")) {
    // Clipped: the body carries on where the title stopped.
    const head = title.slice(0, -1);
    if (t.startsWith(head)) return `…${t.slice(head.length).trimStart()}`;
  }
  if (!t.startsWith(title)) return t || null;
  return t.slice(title.length).trim() || null;
}

/** A row's title: its session's name when it has one, else the task's
 *  first line, cut at its first sentence when that line runs long, and
 *  clipped to `max` characters. */
export function taskTitle(text: string, sessionName?: string, max = 90): string {
  const name = sessionName?.trim();
  if (name) return name;
  let line = text.trim().split("\n")[0].trim();
  if (line.length > max) {
    const end = line.search(/[.!?](\s|$)/);
    if (end > 0 && end < max) line = line.slice(0, end + 1);
  }
  if (line.length <= max) return line;
  // Clipped at a word when there's one late enough, else mid-word.
  const cut = line.lastIndexOf(" ", max - 1);
  return `${line.slice(0, cut > max * 0.6 ? cut : max - 1).trimEnd()}…`;
}

// ---- answering a plan ----

/** What Approve sends the session. */
export const PLAN_APPROVED = "Plan approved — go ahead.";

/** What Redirect sends: the text as typed, or nothing when it's blank. */
export function redirectPrompt(text: string): string | null {
  const t = text.trim();
  return t || null;
}

// ---- the batch's summary ----

export interface Summary {
  settled: boolean;
  /** Sessions on it, or starting. */
  working: number;
  /** Waiting for a slot. */
  pending: number;
  done: number;
  needsYou: number;
  failed: number;
  blocked: number;
  listed: number;
  cancelled: number;
  /** "4 done, 1 needs you" */
  text: string;
}

export function batchSummary(
  tasks: BatchTask[],
  agents: Record<string, Agent>,
  queued: QueuedFor = () => 0,
  now = Date.now(),
): Summary {
  const s = {
    settled: true,
    working: 0,
    pending: 0,
    done: 0,
    needsYou: 0,
    failed: 0,
    blocked: 0,
    listed: 0,
    cancelled: 0,
  };
  for (const t of tasks) {
    const p = phaseOf(t, agents, queued, now);
    if (!isSettled(p)) s.settled = false;
    if (p === "working" || p === "launching") s.working++;
    else if (p === "pending") s.pending++;
    else if (p === "finished" || p === "archived" || p === "gone" || p === "done") s.done++;
    else if (p === "waiting" || p === "plan") s.needsYou++;
    else if (p === "failed" || p === "stopped") s.failed++;
    else if (p === "blocked") s.blocked++;
    else if (p === "listed") s.listed++;
    else if (p === "cancelled") s.cancelled++;
  }
  const text = [
    s.done && `${s.done} done`,
    s.needsYou && `${s.needsYou} ${s.needsYou === 1 ? "needs" : "need"} you`,
    s.failed && `${s.failed} failed`,
    s.blocked && `${s.blocked} blocked`,
    s.listed && `${s.listed} on your list`,
    s.cancelled && `${s.cancelled} cancelled`,
  ]
    .filter(Boolean)
    .join(", ");
  return { ...s, text };
}

/** The Dispatch dialog's line, from the same counts as the board:
 *  "2 working · 1 waiting for a slot · 1 done · 1 needs you". */
export function dispatchedLine(s: Summary): string {
  return [
    s.working && `${s.working} working`,
    s.pending && `${s.pending} waiting for a slot`,
    s.done && `${s.done} done`,
    s.needsYou && `${s.needsYou} ${s.needsYou === 1 ? "needs" : "need"} you`,
    s.failed && `${s.failed} failed`,
    s.blocked && `${s.blocked} blocked`,
    s.listed && `${s.listed} on your list`,
    s.cancelled && `${s.cancelled} cancelled`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Whether a batch's summary banner fires now, and what to save so it
 *  fires once: once each time the batch settles, and not again for the
 *  same words (a session that only blinked out and back). */
export function decideSummary(
  b: Batch,
  agents: Record<string, Agent>,
  queued: QueuedFor = () => 0,
  now = Date.now(),
): { fire?: string; patch?: Partial<Batch> } {
  if (b.dismissed) return {};
  const s = batchSummary(b.tasks, agents, queued, now);
  if (!s.settled) return b.notifiedSettle ? { patch: { notifiedSettle: false } } : {};
  if (b.notifiedSettle) return {};
  // Nothing went to an agent: there's nothing to report back.
  if (b.tasks.every((t) => t.state === "listed") || s.text === b.lastSummary) return { patch: { notifiedSettle: true } };
  return { fire: s.text, patch: { notifiedSettle: true, lastSummary: s.text } };
}

// ---- per-task banners ----

/** Whether notify.ts holds back a session's own banner: it's a task in a
 *  batch still on the board, which reports once as a whole. Waiting on you
 *  still gets its banner — that's the one that needs you now. */
export function suppressTaskNotification(agentId: string, status: Agent["status"], batches: Batch[]): boolean {
  if (status === "needs_feedback") return false;
  return batches.some((b) => !b.dismissed && b.tasks.some((t) => t.agentId === agentId));
}

// ---- what a running session is doing ----

/** Message marks (a reply, a tool call) and spinner marks, as Claude Code,
 *  Codex and friends start lines with. */
const SAYS = /^[⏺●•]\s*(?=\S)/;
const SPINS = /^[✻✶✳✢✽∗*·]\s*(?=\S)/;
/** The input box, its borders and hints: what every screen ends with. */
const CHROME = /^[─━═╭╮╰╯\s]*$|^[>›❯](\s|$)|for shortcuts|^\? /;

/** One line of what a running session is doing, from its screen (read by
 *  screen.ts): its latest message or tool call, else its spinner, else the
 *  last line that isn't the input box. */
export function activityLine(lines: string[]): string | null {
  const rows = lines
    .map((l) => l.replace(/^[\s│┃|]+|[\s│┃|]+$/g, ""))
    .filter(Boolean)
    .slice(-30);
  for (const re of [SAYS, SPINS]) {
    for (let i = rows.length - 1; i >= 0; i--) if (re.test(rows[i])) return rows[i].replace(re, "");
  }
  for (let i = rows.length - 1; i >= 0; i--) if (!CHROME.test(rows[i])) return rows[i];
  return null;
}
