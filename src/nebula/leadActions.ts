// A lead starts tasks and looks after them (S28): a project's lead writes
// action lines in its reply (START, NUDGE, ASK merge, ASK archive) and the
// app carries them out, so the caps, budget holds and the off switch all
// live here, not in the lead's prompt. The lead never spawns threads or
// sends to them itself. This file is the pure part: reading the lines out of
// a reply, deciding each one, the [observatory] line that reports it back,
// which lead turn to act on, and what's kept of it all. leadRunner.ts wires
// it to the app. Kept free of the app so its tests run under plain Node.
// Value imports name their .ts files: the tests load this module in Node.
import { useSyncExternalStore } from "react";
import { LINE_PREFIX, MAX_LINE } from "./lead.ts";
import type { AgentStatus } from "./types";

export type LeadAction =
  | { kind: "start"; branch: string; brief: string }
  | { kind: "nudge"; agentId: string; message: string }
  | { kind: "ask"; what: "merge"; pr: number; why: string }
  | { kind: "ask"; what: "archive"; agentId: string; why: string }
  /** The top lead's one action: work for a project's lead. */
  | { kind: "pass"; project: string; brief: string };

export type AskAction = Extract<LeadAction, { kind: "ask" }>;

/** A lead may start this many of its tasks at once, unless its card says. */
export const DEFAULT_MAX_TASKS = 2;
/** Nudges to one thread within NUDGE_WINDOW_MS. */
export const MAX_NUDGES = 3;
export const NUDGE_WINDOW_MS = 60 * 60_000;

// ---- reading the lines ----

const FENCE = /^\s*(```|~~~)/;
// A line may sit in a list ("- START …"); the keywords are case-sensitive.
const LEAD_IN = /^\s*(?:[-*•]\s+)?/;
const START = /^START (\S+): (\S.*)$/;
const NUDGE = /^NUDGE ([\w-]+): (\S.*)$/;
const ASK_MERGE = /^ASK merge #(\d+): (\S.*)$/;
const ASK_ARCHIVE = /^ASK archive ([\w-]+): (\S.*)$/;
const PASS = /^PASS ([^:]*\S): (\S.*)$/;

/** A branch name git takes, more or less: no spaces, no `..`, not starting
 *  with `-` or `/`, not ending with `/`, `.` or `.lock`. */
export function validBranch(b: string): boolean {
  return (
    /^[\w./-]+$/.test(b) && !b.startsWith("-") && !b.startsWith("/") && !b.includes("..") && !/(\/|\.|\.lock)$/.test(b) && !b.includes("//")
  );
}

/** Every action line in a reply, in order: anywhere in it, outside code
 *  fences. A line missing its branch, id or number, or with a bad one, is
 *  dropped. */
export function parseActions(text: string): LeadAction[] {
  const out: LeadAction[] = [];
  let fenced = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const line = raw.replace(LEAD_IN, "").trimEnd();
    let m: RegExpMatchArray | null;
    if ((m = line.match(START))) {
      if (validBranch(m[1])) out.push({ kind: "start", branch: m[1], brief: m[2].trim() });
    } else if ((m = line.match(NUDGE))) out.push({ kind: "nudge", agentId: m[1], message: m[2].trim() });
    else if ((m = line.match(ASK_MERGE))) {
      const pr = Number(m[1]);
      if (pr > 0) out.push({ kind: "ask", what: "merge", pr, why: m[2].trim() });
    } else if ((m = line.match(ASK_ARCHIVE))) out.push({ kind: "ask", what: "archive", agentId: m[1], why: m[2].trim() });
    else if ((m = line.match(PASS))) out.push({ kind: "pass", project: m[1].trim(), brief: m[2].trim() });
  }
  return out;
}

/** Whether a line (outside a code fence) is an action line parseActions()
 *  would read, well-formed or not: the chat (S29) leaves them out of the
 *  lead's words. */
const ACTION_LINE = /^(?:START \S+|NUDGE \S+|ASK (?:merge|archive) \S+|PASS [^:]+):/;

/** A reply without its action lines, for the chat's bubble: the lines a
 *  code fence holds stay, as parseActions() leaves them too. */
export function withoutActions(text: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(raw)) fenced = !fenced;
    else if (!fenced && ACTION_LINE.test(raw.replace(LEAD_IN, ""))) continue;
    out.push(raw);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** How many of a reply's lines ask you something (for the pet's call). */
export const askLines = (text: string) => parseActions(text).filter((a) => a.kind === "ask").length;

// ---- deciding ----

export interface DecideContext {
  /** The card's "Let the lead start and nudge threads". */
  acts: boolean;
  /** The top lead: it acts only through project leads. */
  top: boolean;
  leadId: string;
  projectId: string;
  /** The lead's started tasks still queued or running. */
  running: number;
  maxTasks: number;
  /** Why launches are held now (a budget), or null. */
  hold: string | null;
  /** Branches already a worktree in the project, or a START still waiting. */
  branches: ReadonlySet<string>;
  /** Every thread Observatory knows, with its project. */
  threads: Record<string, { projectId: string | null; archived?: boolean }>;
  /** Nudges sent to a thread within the last hour. */
  nudges: (agentId: string) => number;
  /** The open PRs in the project, by number. */
  prs: ReadonlySet<number>;
}

export type Decision = { ok: true } | { ok: false; reason: string };

const no = (reason: string): Decision => ({ ok: false, reason });

/** Whether the app carries out an action line, or why not. */
export function decide(a: LeadAction, c: DecideContext): Decision {
  if (c.top) return no("the top lead acts only through project leads");
  if (a.kind === "pass") return no("only the top lead passes work on");
  if (!c.acts) return no("actions are off");
  if (a.kind === "start") {
    if (c.hold) return no(c.hold);
    if (c.running >= c.maxTasks) return no(`${c.running} of your tasks are running, at most ${c.maxTasks}`);
    if (c.branches.has(a.branch)) return no(`${a.branch} is already a worktree in this project`);
    return { ok: true };
  }
  const id = a.kind === "nudge" || a.what === "archive" ? (a as { agentId: string }).agentId : null;
  if (id !== null) {
    const t = c.threads[id];
    if (id === c.leadId) return no("that's your own thread");
    if (!t) return no("no thread has that id");
    if (t.projectId !== c.projectId) return no("that thread is in another project");
    if (t.archived) return no("that thread is archived");
    if (a.kind === "nudge" && c.nudges(id) >= MAX_NUDGES) return no(`it was nudged ${MAX_NUDGES} times in the last hour`);
    return { ok: true };
  }
  const pr = (a as { pr: number }).pr;
  return c.prs.has(pr) ? { ok: true } : no(`no open PR #${pr} in this project`);
}

/** Nudges to `agentId` in the window before `now`. */
export function nudgesWithin(log: readonly Nudge[], agentId: string, now = Date.now(), windowMs = NUDGE_WINDOW_MS): number {
  return log.filter((n) => n.agentId === agentId && now - n.at < windowMs).length;
}

// ---- reporting back ----

export type Report =
  | { kind: "started"; branch: string; agentId: string }
  | { kind: "queued"; branch: string; running: number }
  | { kind: "refused"; action: LeadAction; reason: string }
  | { kind: "nudged"; agentId: string }
  | { kind: "passed"; project: string }
  | { kind: "answered"; ask: AskAction; yes: boolean; error?: string }
  | { kind: "off" };

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** An action as its line names it: `START fix-clipping`, `NUDGE a1`, `ASK merge #12`. */
export function actionName(a: LeadAction): string {
  if (a.kind === "start") return `START ${a.branch}`;
  if (a.kind === "nudge") return `NUDGE ${a.agentId}`;
  if (a.kind === "pass") return `PASS ${a.project}`;
  return a.what === "merge" ? `ASK merge #${a.pr}` : `ASK archive ${a.agentId}`;
}

/** The [observatory] line a decision goes back to the lead as. */
export function reportLine(r: Report): string {
  const body = (() => {
    switch (r.kind) {
      case "started":
        return `started ${r.branch} (agent ${r.agentId})`;
      case "queued":
        return `queued ${r.branch}: ${r.running} running, waiting for a slot`;
      case "refused":
        return `refused ${actionName(r.action)}: ${oneLine(r.reason)}`;
      case "nudged":
        return `nudged ${r.agentId}`;
      case "passed":
        return `passed to Lead ${r.project}`;
      case "off":
        return "actions are off";
      case "answered": {
        const a = r.ask;
        const what = a.what === "merge" ? `#${a.pr}` : a.agentId;
        if (r.error) return `couldn't ${a.what === "merge" ? "merge" : "archive"} ${what}: ${oneLine(r.error)}`;
        // "The user", not "you": the lead reads "you" as itself.
        if (a.what === "merge") return r.yes ? `the user merged ${what} (your ASK)` : `the user said no to merging ${what}`;
        return r.yes ? `the user archived ${what} (your ASK)` : `the user said no to archiving ${what}`;
      }
    }
  })();
  const line = `${LINE_PREFIX}${body}`;
  return line.length <= MAX_LINE ? line : `${line.slice(0, MAX_LINE - 1)}…`;
}

// ---- which turn to act on ----

/** The reply to act on: a lead's turn that's ended (its thread at rest),
 *  whose last reply comes after the one acted on last. Null when there's
 *  nothing new, so the same turn seen on two polls acts once. */
export function replyToAct(
  lead: { status: AgentStatus; archived: boolean } | undefined,
  reply: { n: number; text: string } | null | undefined,
  acted: number | undefined,
): { n: number; text: string } | null {
  if (!lead || lead.archived || !reply) return null;
  if (lead.status === "running" || lead.status === "fresh") return null;
  return acted === undefined || reply.n > acted ? reply : null;
}

// ---- carrying them out ----

/** What carrying out a reply's actions needs from the app. */
export interface RunDeps {
  /** The context to decide the next action in, looked at afresh for each
   *  (an earlier START in the same reply counts against the cap). */
  context: () => DecideContext;
  /** Queue a new task (queueNewTask()) and record it as the lead's; how
   *  many are running when every Dispatch slot is taken, else null. */
  start: (branch: string, brief: string) => { full: number | null };
  /** Send a follow-up through enqueue() (queue.ts) and count it. */
  nudge: (agentId: string, message: string) => Promise<unknown>;
  /** A thread's title, for the dialogue's line. */
  name: (agentId: string) => string;
}

export interface RunResult {
  reports: Report[];
  /** The dialogue's lines under the reply: "Started fix-clipping". */
  lines: string[];
  /** The asks to show with Yes and No. */
  asks: AskAction[];
}

/** Decide each action in order and carry out the ones that may run. */
export async function runActions(actions: LeadAction[], deps: RunDeps): Promise<RunResult> {
  const out: RunResult = { reports: [], lines: [], asks: [] };
  for (const a of actions) {
    const d = decide(a, deps.context());
    if (!d.ok) {
      out.reports.push({ kind: "refused", action: a, reason: d.reason });
      continue;
    }
    if (a.kind === "start") {
      const { full } = deps.start(a.branch, a.brief);
      if (full !== null) {
        out.reports.push({ kind: "queued", branch: a.branch, running: full });
        out.lines.push(`Queued ${a.branch}`);
      } else out.lines.push(`Started ${a.branch}`);
    } else if (a.kind === "nudge") {
      try {
        await deps.nudge(a.agentId, a.message);
        out.reports.push({ kind: "nudged", agentId: a.agentId });
        out.lines.push(`Nudged ${deps.name(a.agentId)}`);
      } catch (e) {
        out.reports.push({ kind: "refused", action: a, reason: e instanceof Error ? e.message : String(e) });
      }
    } else if (a.kind === "ask") out.asks.push(a);
  }
  return out;
}

// ---- the top lead passing work on ----

/** A project lead the top lead may pass work to. */
export interface PassTarget {
  /** The project's name, as the top lead's roster names it. */
  project: string;
  agentId: string;
  /** Running, not archived or gone. */
  running: boolean;
  acts: boolean;
}

/** What a project's lead is sent for a PASS. */
export const passLine = (brief: string) => `${LINE_PREFIX}from the top lead: ${oneLine(brief)}`;

/** Whether a PASS may go, and to whom: a project with a running lead whose
 *  actions are on. Projects are matched by name, ignoring case. */
export function decidePass(a: Extract<LeadAction, { kind: "pass" }>, targets: readonly PassTarget[]): { ok: true; target: PassTarget } | { ok: false; reason: string } {
  const want = a.project.trim().toLowerCase();
  const t = targets.find((x) => x.project.trim().toLowerCase() === want);
  if (!t || !t.running) return { ok: false, reason: `${a.project} has no running lead` };
  if (!t.acts) return { ok: false, reason: `Lead ${t.project} has its actions off` };
  return { ok: true, target: t };
}

/** The top lead's reply: its PASS lines forwarded through `forward`
 *  (enqueue(), batched with the project lead's other lines); its START,
 *  NUDGE and ASK lines ignored. The reports go back to the top lead. */
export async function runPasses(
  actions: LeadAction[],
  targets: readonly PassTarget[],
  forward: (agentId: string, line: string) => Promise<unknown>,
): Promise<Report[]> {
  const out: Report[] = [];
  for (const a of actions) {
    if (a.kind !== "pass") continue;
    const d = decidePass(a, targets);
    if (!d.ok) {
      out.push({ kind: "refused", action: a, reason: d.reason });
      continue;
    }
    try {
      await forward(d.target.agentId, passLine(a.brief));
      out.push({ kind: "passed", project: d.target.project });
    } catch (e) {
      out.push({ kind: "refused", action: a, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// ---- answering an ASK ----

/** What Yes and No on an ASK row need. */
export interface AnswerDeps {
  merge: (pr: number) => Promise<unknown>;
  archive: (agentId: string) => Promise<unknown> | void;
  /** The line goes to the lead (deliver(), batched with its other lines). */
  tell: (line: string) => Promise<unknown> | void;
}

/** Yes or No on an ASK row: Yes merges or archives, No does nothing, and
 *  the lead hears which. Each ask is answered once (by `key`); a second
 *  press does nothing and resolves null. */
export async function answerAsk(key: string, ask: AskAction, yes: boolean, deps: AnswerDeps): Promise<string | null> {
  if (isAnswered(key)) return null;
  markAnswered(key);
  let error: string | undefined;
  if (yes) {
    try {
      if (ask.what === "merge") await deps.merge(ask.pr);
      else await deps.archive(ask.agentId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const line = reportLine({ kind: "answered", ask, yes, ...(error ? { error } : {}) });
  await deps.tell(line);
  if (error) throw new Error(error);
  return line;
}

/** An ask's key: the lead, the reply and the line, so a later reply asking
 *  the same thing is a new ask. The reply is its entry and its time (`at`,
 *  S29): a restarted session numbers its entries from 0 again, so an entry
 *  alone could name an old reply. Keys from before S29 have no time. */
export const askKey = (leadId: string, n: number, a: AskAction, at?: number) =>
  `${leadId}|${at === undefined ? n : `${n}@${at}`}|${actionName(a)}`;

// ---- lead-started tasks ----

/** A task a lead started, kept so its cap and the card can count it. */
export interface LeadTask {
  leadId: string;
  projectId: string;
  batchId: string;
  taskId: string;
  branch: string;
  at: number;
  /** The lead's reply whose START it was (S29: the chat shows its card
   *  under that reply). Missing on tasks started before S29. */
  n?: number;
  /** That reply's time (Unix seconds): with `n`, it names the reply even
   *  after a restart numbers entries from 0 again. */
  replyAt?: number;
  agentId?: string;
  /** Its START has been reported back (started, or refused once its
   *  launch failed). */
  told?: boolean;
}

export type StartedState = "queued" | "running" | "finished" | `PR #${number}` | "merged" | "closed" | "failed";

/** How long a just-launched thread may be missing from the store (its
 *  entity can land after the launch) and still count as running. */
export const ARRIVAL_MS = 30_000;

/** Where a lead-started task is now, for the card, and whether it holds
 *  one of the lead's slots (queued, or its thread working). A thread gone
 *  from a loaded store, past its arrival window, is closed: it never holds
 *  a slot. */
export function startedState(
  task: { state: string; agentId?: string; launchedAt?: number } | undefined,
  agent: { status: AgentStatus; archived: boolean } | undefined,
  pr: { number: number; state: string } | null | undefined,
  o: { loaded?: boolean; now?: number } = {},
): { label: StartedState; busy: boolean } {
  if (!task || task.state === "failed") return { label: "failed", busy: false };
  if (task.state !== "launched") return { label: "queued", busy: true };
  const working = !!agent && !agent.archived && ["fresh", "running", "needs_feedback", "disconnected"].includes(agent.status);
  if (pr?.state === "merged") return { label: "merged", busy: false };
  if (pr && (pr.state === "open" || pr.state === "draft")) return { label: `PR #${pr.number}`, busy: working };
  if (agent?.archived) return { label: "closed", busy: false };
  if (!agent) {
    const arriving = o.loaded === false || (o.now ?? Date.now()) - (task.launchedAt ?? 0) < ARRIVAL_MS;
    return arriving ? { label: "running", busy: true } : { label: "closed", busy: false };
  }
  return { label: working ? "running" : "finished", busy: working };
}

// ---- what's kept ----

export interface Nudge {
  leadId: string;
  agentId: string;
  at: number;
}

/** What a reply made happen, shown under it in the dialogue: lines like
 *  "Started fix-clipping", and the asks still to answer. */
export interface Outcome {
  n: number;
  /** The reply's time (Unix seconds), so a restarted session's reply with
   *  the same entry number isn't taken for it. Missing before S29. */
  at?: number;
  lines: string[];
  asks: AskAction[];
}

export interface LeadActs {
  /** The last reply acted on, by lead. */
  acted: Record<string, number>;
  nudges: Nudge[];
  /** Asks answered, by askKey(). */
  answered: string[];
  outcomes: Record<string, Outcome>;
  /** Every reply's outcome, oldest first (S29: the chat shows each under
   *  its reply, not only the latest). */
  history: (Outcome & { leadId: string })[];
  /** Leads told their actions are off, since they were last turned on. */
  toldOff: string[];
  tasks: LeadTask[];
}

const KEY = "observatory.leadActions";
const EMPTY: LeadActs = { acted: {}, nudges: [], answered: [], outcomes: {}, history: [], toldOff: [], tasks: [] };
/** Asks and nudges kept: enough for the hour and for the dialogue. */
const KEEP = 200;

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

function load(): LeadActs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return { ...EMPTY };
    return {
      acted: raw.acted && typeof raw.acted === "object" ? raw.acted : {},
      nudges: arr<Nudge>(raw.nudges).filter((n) => n && typeof n.agentId === "string" && typeof n.at === "number"),
      answered: arr<string>(raw.answered).filter((s) => typeof s === "string"),
      outcomes: raw.outcomes && typeof raw.outcomes === "object" ? raw.outcomes : {},
      history: arr<Outcome & { leadId: string }>(raw.history).filter((o) => o && typeof o.leadId === "string" && typeof o.n === "number"),
      toldOff: arr<string>(raw.toldOff).filter((s) => typeof s === "string"),
      tasks: arr<LeadTask>(raw.tasks).filter((t) => t && typeof t.taskId === "string" && typeof t.leadId === "string"),
    };
  } catch {
    return { ...EMPTY };
  }
}

let state: LeadActs | null = null;
const listeners = new Set<() => void>();

export function leadActs(): LeadActs {
  return (state ??= load());
}

/** Drop what's in memory and read it from storage again (tests). */
export function reloadLeadActs() {
  state = load();
  listeners.forEach((l) => l());
}

export function updateLeadActs(f: (s: LeadActs) => Partial<LeadActs>) {
  const now = leadActs();
  const next = { ...now, ...f(now) };
  next.nudges = next.nudges.slice(-KEEP);
  next.answered = next.answered.slice(-KEEP);
  next.tasks = next.tasks.slice(-KEEP);
  next.history = next.history.slice(-KEEP);
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Without storage it lasts until the app quits.
  }
  listeners.forEach((l) => l());
}

export function useLeadActs(): LeadActs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    leadActs,
  );
}

export const isAnswered = (key: string) => leadActs().answered.includes(key);
const markAnswered = (key: string) => updateLeadActs((s) => ({ answered: [...s.answered, key] }));

/** A reply acted on: nothing in it runs again. */
export const markActed = (leadId: string, n: number) => updateLeadActs((s) => ({ acted: { ...s.acted, [leadId]: n } }));

/** What each of a lead's replies made happen, in the order they came: the
 *  history, and its latest outcome (kept before S29 without a history). */
export function outcomesOf(leadId: string, s: LeadActs = leadActs()): Outcome[] {
  const out: Outcome[] = s.history.filter((o) => o.leadId === leadId).map(({ leadId: _l, ...o }) => o);
  const last = s.outcomes[leadId];
  if (last && !out.some((o) => o.n === last.n && o.at === last.at)) out.push(last);
  return out;
}

/** The lead's tasks, newest first. Counted by project, so a restarted lead
 *  keeps its cap and its list. */
export function tasksOf(projectId: string, s: LeadActs = leadActs()): LeadTask[] {
  return s.tasks.filter((t) => t.projectId === projectId).sort((a, b) => b.at - a.at);
}
