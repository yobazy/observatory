// Routing: one headless call to the user's agent CLI turns the to-do list
// into a proposed plan of tasks, which the user edits before anything runs.
// This module builds the prompt, reads the reply into a plan, and checks the
// plan for clashes. It takes plain data (items, cards, open sessions) rather
// than reading store.ts, so all of it can be tested without the app.
import type { ProjectCard, RunPolicy } from "./cards";
import type { IndexEntry } from "./threadIndex";

export type Target = "project" | "home" | "you";
/** How a project task runs: a fresh worktree, a new session in a checkout
 *  that exists (a Shared project's main one), or a follow-up in an open chat. */
export type Mode = "new_worktree" | "existing_worktree" | "existing_chat";

export const TARGETS: Target[] = ["project", "home", "you"];
export const MODES: Mode[] = ["new_worktree", "existing_worktree", "existing_chat"];

/** Below this, the router's project pick is cleared and the user chooses. */
export const CONFIDENCE_THRESHOLD = 0.6;

/** Recent prompts per session the router sees, and how much of each. */
const MAX_PROMPTS = 3;
const MAX_PROMPT_CHARS = 280;

export interface RouterItem {
  id: string;
  text: string;
  context: string[];
}

/** A project's card as the router sees it, with what the card doesn't hold. */
export interface RouterCard {
  projectId: string;
  name: string;
  description: string;
  skills: string[];
  skillNotes: Record<string, string>;
  taskKinds: string[];
  policy: RunPolicy;
  concurrency: number;
  isHome: boolean;
  /** Home has a scheduling instruction, so `you` tasks can be booked. */
  canSchedule: boolean;
  /** The project's main checkout: where a Shared project's tasks run. */
  mainWorktreeId: string | null;
}

export interface RouterWorktree {
  id: string;
  projectId: string;
  branch: string;
  isMain: boolean;
}

/** An agent session that isn't archived, with what it was last asked. */
export interface OpenSession {
  id: string;
  name: string;
  projectId: string;
  worktreeId: string;
  branch: string;
  kind: string;
  status: string;
  recentPrompts: string[];
}

export interface PlanTask {
  /** Local to this plan, for editing; not from the router. */
  id: string;
  sourceItemIds: string[];
  text: string;
  target: Target;
  projectId?: string;
  mode?: Mode;
  worktreeId?: string;
  sessionId?: string;
  /** A skill on the project's card the prompt should invoke. */
  skill?: string;
  /** Set when `sessionId` is a past thread (threadIndex.ts) rather than an
   *  open session: what the review says of it, and what launching needs to
   *  know (unarchive it first; start fresh if it's been deleted). */
  past?: PastRef;
  confidence: number;
  question?: string;
  planCheckpoint: boolean;
  /** The router wasn't sure, or named something that doesn't exist: the
   *  user picks. Cleared once they do. */
  needsChoice: boolean;
  /** Why the router's pick was cleared, when it named something that isn't
   *  there (rather than being unsure). */
  choiceNote?: string;
}

/** A past thread as a task refers to it. */
export interface PastRef {
  title: string;
  archived: boolean;
  archivedAt?: number;
}

export interface Plan {
  tasks: PlanTask[];
}

/** What a plan is checked against. */
export interface RouteContext {
  items: RouterItem[];
  cards: RouterCard[];
  worktrees: RouterWorktree[];
  sessions: OpenSession[];
  /** Every project the daemon has, card or not: a task may go to any of them. */
  projects?: { id: string; name: string }[];
  /** Past threads (threadIndex.ts) sent to the router beside the open
   *  sessions: a follow-up may go to one of these too. */
  pastThreads?: IndexEntry[];
}

export type ParseResult = { ok: true; plan: Plan } | { ok: false; error: string };

// ---- inputs ----

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The cards the router routes against: projects that have one, by project
 *  id, plus a plain folder's Home card, which no project id points at. */
export function routerCards(
  cards: Record<string, ProjectCard>,
  projects: { id: string; name: string }[],
  worktrees: RouterWorktree[],
): RouterCard[] {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const out: RouterCard[] = [];
  for (const [key, c] of Object.entries(cards)) {
    const project = names.has(key);
    // A card for a project since removed is no use, unless it's Home.
    if (!project && !c.isHome) continue;
    out.push({
      projectId: key,
      name: names.get(key) ?? c.homeFolder ?? key,
      description: c.description,
      skills: c.skills,
      skillNotes: c.skillNotes,
      taskKinds: c.taskKinds,
      policy: c.policy,
      concurrency: c.concurrency,
      isHome: c.isHome,
      // As cards.ts's canSchedule.
      canSchedule: c.isHome && c.schedulingInstruction.trim() !== "",
      mainWorktreeId: worktrees.find((w) => w.projectId === key && w.isMain)?.id ?? null,
    });
  }
  return out;
}

/** The prompt for the router: what each target means, the items, the
 *  cards, and the sessions a task could follow up in: the open ones, and
 *  past threads that match the items (threadIndex.ts's `pastThreadsFor`).
 *  JSON out, only. */
export function buildRouterPrompt(
  items: RouterItem[],
  cards: RouterCard[],
  openSessions: OpenSession[],
  pastThreads: IndexEntry[] = [],
): string {
  const home = cards.find((c) => c.isHome);
  const projects = cards.filter((c) => !c.projectId.startsWith("folder:"));
  const L: string[] = [];
  L.push(
    "You route a to-do list to where coding agents will work on it. Reply with JSON only: one object, no prose, no code fence.",
    "",
    "Targets:",
    '- "project": an agent session in one of the projects below. Set projectId and mode:',
    '  - "new_worktree": a fresh branch in its own worktree. The usual mode for an Isolated project.',
    '  - "existing_worktree": a new session in a checkout that exists, given by worktreeId. A Shared project runs every task in its main checkout.',
    '  - "existing_chat": a follow-up in an open session or a past thread, given by sessionId, when that thread already holds the context the task needs. A past thread that is archived is reopened for it.',
    `- "home": errands and scheduling, done by the Home agent${home ? ` (${oneLine(home.name)})` : ""}.`,
    '- "you": things only the user can do. Home books time for them when it can schedule; otherwise they stay on the list.',
    "",
    "Rules:",
    "- Every item goes in at least one task. Merge items that are one piece of work (list each item's id in sourceItemIds). Split an item that spans projects into one task per project.",
    "- text is the agent's prompt: self-contained, with the item's detail lines folded in. Put a skill from the project's card in skill when one fits.",
    `- confidence is 0 to 1; under ${CONFIDENCE_THRESHOLD} the user picks the project. Put a short question for the user in question when something is unclear.`,
    "- Use only the ids listed below.",
    "",
    "Reply shape:",
    '{"tasks":[{"sourceItemIds":["<item id>"],"text":"...","target":"project","projectId":"<project id>","mode":"new_worktree","worktreeId":"<worktree id>","sessionId":"<session id>","skill":"<skill>","confidence":0.9,"question":"..."}]}',
    "Leave out fields that don't apply.",
    "",
    "Items:",
  );
  for (const i of items) {
    L.push(`- [${i.id}] ${oneLine(i.text)}`);
    for (const c of i.context) L.push(`    ${oneLine(c)}`);
  }

  L.push("", "Projects:");
  if (!projects.length) L.push("(none have a card yet)");
  for (const c of projects) {
    const run =
      c.policy === "shared"
        ? `Shared, main checkout ${c.mainWorktreeId ?? "unknown"}, at most ${c.concurrency} at once`
        : "Isolated";
    L.push(`- [${c.projectId}] ${oneLine(c.name)}: ${run}${c.isHome ? ", is Home" : ""}`);
    if (c.description.trim()) L.push(`  description: ${oneLine(c.description)}`);
    if (c.skills.length) {
      const skills = c.skills.map((s) => (c.skillNotes[s] ? `${s} (${oneLine(c.skillNotes[s])})` : s));
      L.push(`  skills: ${skills.join("; ")}`);
    }
    if (c.taskKinds.length) L.push(`  task kinds: ${c.taskKinds.map(oneLine).join(", ")}`);
  }

  L.push("");
  if (!home) L.push('Home: none set. Don\'t use target "home"; "you" tasks stay on the list.');
  else {
    L.push(`Home: ${oneLine(home.name)}. Can schedule: ${home.canSchedule ? "yes" : "no"}.`);
    if (home.projectId.startsWith("folder:") && home.description.trim()) {
      L.push(`  description: ${oneLine(home.description)}`);
    }
  }

  L.push("", "Open sessions:");
  if (!openSessions.length) L.push("(none)");
  for (const s of openSessions) {
    L.push(
      `- [${s.id}] "${oneLine(s.name)}" in project ${s.projectId}, worktree ${s.worktreeId} (branch ${oneLine(s.branch)}), ${s.kind}, ${s.status}`,
    );
    const recent = s.recentPrompts.slice(-MAX_PROMPTS).map((p) => JSON.stringify(clip(oneLine(p), MAX_PROMPT_CHARS)));
    if (recent.length) L.push(`  recent prompts: ${recent.join(" | ")}`);
  }

  L.push("", "Past threads (finished or archived, matching the items):");
  if (!pastThreads.length) L.push("(none)");
  for (const p of pastThreadsSection(pastThreads)) L.push(p);
  return L.join("\n");
}

/** The past threads' lines: each once, with what the index has of it. */
export function pastThreadsSection(pastThreads: IndexEntry[]): string[] {
  const L: string[] = [];
  const seen = new Set<string>();
  for (const p of pastThreads) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const pr = p.pr ? `, PR #${p.pr.number} "${oneLine(p.pr.title)}"` : ", no PR";
    const tags = p.tags.length ? `, tags: ${p.tags.join(", ")}` : "";
    L.push(
      `- [${p.id}] "${oneLine(p.title)}" in project ${p.projectId} (branch ${oneLine(p.branch) || "unknown"}${pr}${tags}), ${p.archived ? "archived" : "finished"}`,
    );
    if (p.summary) L.push(`  summary: ${oneLine(p.summary)}`);
  }
  return L;
}

// ---- the reply ----

/** The one JSON value in a reply: a fenced block, or the outermost braces
 *  with any prose around them. The tagging prompt's reply too (tagging.ts). */
export function extractJson(text: string): string | null {
  const fences = [...text.matchAll(/```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/g)];
  if (fences.length === 1) return fences[0][1].trim();
  if (fences.length > 1) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

function confidenceOf(x: unknown): number {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  // Some models answer in percent.
  return n > 1 ? Math.min(n / 100, 1) : n;
}

/** Clear the router's project pick for the user to make, saying why when
 *  it named something that isn't there. */
function flagged(t: PlanTask, note?: string | null): PlanTask {
  const { projectId: _p, worktreeId: _w, sessionId: _s, mode: _m, skill: _k, past: _x, choiceNote: _n, ...rest } = t;
  return { ...rest, needsChoice: true, ...(note ? { choiceNote: note } : {}) };
}

/** A project the daemon has, or one with a card. A project needs no card
 *  to take tasks: a fresh setup has none. */
function knownProject(id: string, ctx: RouteContext): boolean {
  return (ctx.projects ?? []).some((p) => p.id === id) || ctx.cards.some((c) => c.projectId === id);
}

/** Whether a chat id is one the router was given in that project: an open
 *  session, or a past thread. */
function knownChat(id: string, projectId: string | undefined, ctx: RouteContext): boolean {
  return (
    ctx.sessions.some((s) => s.id === id && s.projectId === projectId) ||
    (ctx.pastThreads ?? []).some((p) => p.id === id && p.projectId === projectId)
  );
}

/** The past thread a chat id names, when it isn't an open session. */
export function pastRef(id: string | undefined, ctx: RouteContext): PastRef | undefined {
  if (!id || ctx.sessions.some((s) => s.id === id)) return undefined;
  const p = (ctx.pastThreads ?? []).find((x) => x.id === id);
  if (!p) return undefined;
  return { title: p.title, archived: p.archived, ...(p.archived && p.archivedAt ? { archivedAt: p.archivedAt } : {}) };
}

/** What's wrong with a task's references, checked against what exists: a
 *  project the daemon knows (with a card or not), a worktree and a session in
 *  that project. Null when they hold; "" when something is missing rather
 *  than wrong. */
function refsProblem(t: PlanTask, ctx: RouteContext): string | null {
  if (t.target !== "project") return null;
  if (!t.projectId) return "";
  if (!knownProject(t.projectId, ctx)) return "The router picked a project Observatory doesn't know.";
  if (t.worktreeId && !ctx.worktrees.some((w) => w.id === t.worktreeId && w.projectId === t.projectId)) {
    return "The router picked a worktree that isn't in that project.";
  }
  if (t.sessionId && !knownChat(t.sessionId, t.projectId, ctx)) {
    return "The router picked a chat that isn't open or a past thread in that project.";
  }
  if (t.mode === "existing_worktree" && !t.worktreeId) return "";
  if (t.mode === "existing_chat" && !t.sessionId) return "";
  return null;
}

/** The router's reply as a plan. Tolerates a fenced block or prose around
 *  one JSON object; anything else is an error. A task the router wasn't
 *  sure of, or that names a project, worktree or chat that isn't there (with
 *  `ctx`), loses its project pick and is flagged for the user. */
export function parsePlan(text: string, ctx?: RouteContext): ParseResult {
  const json = extractJson(text ?? "");
  if (json === null) return { ok: false, error: "The router's reply had no JSON plan in it." };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `The router's reply wasn't valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const list = Array.isArray(raw) ? raw : (raw as { tasks?: unknown })?.tasks;
  if (!Array.isArray(list)) return { ok: false, error: 'The router\'s reply had no "tasks" list.' };
  if (!list.length) return { ok: false, error: "The router returned no tasks." };

  const known = ctx && new Set(ctx.items.map((i) => i.id));
  const tasks: PlanTask[] = [];
  for (const [n, x] of list.entries()) {
    if (!x || typeof x !== "object") return { ok: false, error: `Task ${n + 1} in the router's reply isn't an object.` };
    const r = x as Record<string, unknown>;
    let sourceItemIds = Array.isArray(r.sourceItemIds)
      ? [...new Set(r.sourceItemIds.filter((s): s is string => typeof s === "string"))]
      : [];
    if (known) sourceItemIds = sourceItemIds.filter((s) => known.has(s));
    const fallback = ctx?.items.filter((i) => sourceItemIds.includes(i.id)).map((i) => i.text).join("; ");
    const body = str(r.text) ?? (fallback || undefined);
    if (!body) return { ok: false, error: `Task ${n + 1} in the router's reply has no text.` };
    const target = TARGETS.includes(r.target as Target) ? (r.target as Target) : undefined;
    let task: PlanTask = {
      id: `t${n + 1}`,
      sourceItemIds,
      text: body,
      target: target ?? "project",
      confidence: confidenceOf(r.confidence),
      question: str(r.question),
      planCheckpoint: true,
      needsChoice: false,
    };
    if (task.target === "project") {
      task.projectId = str(r.projectId);
      task.mode = MODES.includes(r.mode as Mode) ? (r.mode as Mode) : undefined;
      if (task.mode === "existing_worktree") task.worktreeId = str(r.worktreeId);
      if (task.mode === "existing_chat") task.sessionId = str(r.sessionId);
      const past = ctx && pastRef(task.sessionId, ctx);
      if (past) task.past = past;
      task.skill = str(r.skill);
    }
    if (!task.question) delete task.question;
    for (const k of ["projectId", "mode", "worktreeId", "sessionId", "skill", "past"] as const) {
      if (task[k] === undefined) delete task[k];
    }
    const problem = ctx ? refsProblem(task, ctx) : null;
    if (problem !== null) task = flagged(task, problem);
    else if (!target || task.confidence < CONFIDENCE_THRESHOLD) task = flagged(task);
    tasks.push(task);
  }
  return { ok: true, plan: { tasks } };
}

// ---- checks ----

export interface Issue {
  kind: "conflict" | "unassigned";
  taskIds: string[];
  message: string;
}

export interface Validation {
  issues: Issue[];
  /** Items no task comes from: worth a look, but not a blocker. */
  unrouted: string[];
  /** No conflicts and every task has somewhere to go. */
  canDispatch: boolean;
}

const label = (t: PlanTask) => `“${clip(oneLine(t.text), 48)}”`;

/** What stops a plan from being dispatched: project tasks with nowhere to
 *  go, and tasks that would share a worktree or a chat. Several tasks in a
 *  Shared project's main checkout are fine: the project's cap paces them. */
export function validatePlan(plan: Plan, ctx: RouteContext): Validation {
  const issues: Issue[] = [];
  for (const t of plan.tasks) {
    const missing = !t.text.trim()
      ? "needs a prompt"
      : t.target !== "project"
        ? null
        : !t.projectId
          ? "needs a project"
          : !t.mode
            ? "needs a way to run"
            : t.mode === "existing_worktree" && !t.worktreeId
              ? "needs a worktree"
              : t.mode === "existing_chat" && !t.sessionId
                ? "needs a chat"
                : t.mode === "existing_chat" && t.sessionId && !knownChat(t.sessionId, t.projectId, ctx)
                  ? "follows up in a chat that isn't an open session or a past thread here"
                  : null;
    if (missing) issues.push({ kind: "unassigned", taskIds: [t.id], message: `${label(t)} ${missing}.` });
  }

  const group = (key: (t: PlanTask) => string | undefined) => {
    const by = new Map<string, PlanTask[]>();
    for (const t of plan.tasks) {
      const k = t.target === "project" ? key(t) : undefined;
      if (k) by.set(k, [...(by.get(k) ?? []), t]);
    }
    return [...by].filter(([, ts]) => ts.length > 1);
  };
  const policyOf = (projectId: string) => ctx.cards.find((c) => c.projectId === projectId)?.policy ?? "isolated";

  for (const [id, ts] of group((t) => (t.mode === "existing_worktree" ? t.worktreeId : undefined))) {
    const wt = ctx.worktrees.find((w) => w.id === id);
    if (wt?.isMain && policyOf(wt.projectId) === "shared") continue;
    issues.push({
      kind: "conflict",
      taskIds: ts.map((t) => t.id),
      message: `${ts.length} tasks would share the worktree ${wt ? wt.branch : id}. Give all but one a new worktree.`,
    });
  }
  for (const [id, ts] of group((t) => (t.mode === "existing_chat" ? t.sessionId : undefined))) {
    const s = ctx.sessions.find((x) => x.id === id) ?? ctx.pastThreads?.find((x) => x.id === id);
    const name = s && ("name" in s ? s.name : s.title);
    issues.push({
      kind: "conflict",
      taskIds: ts.map((t) => t.id),
      message: `${ts.length} tasks would follow up in the same chat${name ? `, ${name}` : ""}. Merge them or move one.`,
    });
  }

  const routed = new Set(plan.tasks.flatMap((t) => t.sourceItemIds));
  return {
    issues,
    unrouted: ctx.items.filter((i) => !routed.has(i.id)).map((i) => i.id),
    canDispatch: plan.tasks.length > 0 && issues.length === 0,
  };
}

// ---- editing ----

/** The usual way to run in a project: its main checkout when Shared,
 *  else a worktree of its own. */
export function defaultMode(projectId: string, ctx: RouteContext): Pick<PlanTask, "mode" | "worktreeId"> {
  const card = ctx.cards.find((c) => c.projectId === projectId);
  const main = ctx.worktrees.find((w) => w.projectId === projectId && w.isMain);
  if (card?.policy === "shared" && main) return { mode: "existing_worktree", worktreeId: main.id };
  return { mode: "new_worktree" };
}

/** A task moved to another target or project by the user. */
export function retarget(task: PlanTask, target: Target, projectId: string | undefined, ctx: RouteContext): PlanTask {
  const { projectId: _p, mode: _m, worktreeId: _w, sessionId: _s, past: _x, choiceNote: _n, skill, ...rest } = task;
  const next: PlanTask = { ...rest, target, needsChoice: false };
  if (target !== "project" || !projectId) return next;
  const keepSkill = skill && ctx.cards.find((c) => c.projectId === projectId)?.skills.includes(skill);
  return { ...next, projectId, ...defaultMode(projectId, ctx), ...(keepSkill ? { skill } : {}) };
}

/** A task's mode changed: the worktree or chat it named goes with the old mode. */
export function withMode(task: PlanTask, mode: Mode, ctx: RouteContext): PlanTask {
  const { worktreeId: _w, sessionId: _s, past: _x, ...rest } = task;
  const next: PlanTask = { ...rest, mode };
  if (mode === "existing_worktree" && task.projectId) {
    const d = defaultMode(task.projectId, ctx);
    if (d.worktreeId) next.worktreeId = d.worktreeId;
  }
  return next;
}

/** A task's chat picked by the user: an open session, or a past thread. */
export function withChat(task: PlanTask, sessionId: string | undefined, ctx: RouteContext): PlanTask {
  const { sessionId: _s, past: _x, ...rest } = task;
  const past = pastRef(sessionId, ctx);
  return { ...rest, ...(sessionId ? { sessionId } : {}), ...(past ? { past } : {}) };
}

// ---- handing off ----

const ROUTED_KEY = "observatory.dispatch.routed";

export interface RoutedPlan {
  tasks: PlanTask[];
  /** When the user confirmed it. */
  at: number;
}

/** The plan the user confirmed, kept until batch.ts turns it into a batch
 *  (`dispatchPlan`) and clears it. Nothing is launched here. */
export function handOffPlan(plan: Plan): RoutedPlan {
  const routed = { tasks: plan.tasks.map(({ needsChoice: _n, choiceNote: _c, ...t }) => ({ ...t, needsChoice: false })), at: Date.now() };
  try {
    localStorage.setItem(ROUTED_KEY, JSON.stringify(routed));
  } catch {
    // Without storage the plan is lost on quit; the list itself is kept.
  }
  return routed;
}

export function loadRoutedPlan(): RoutedPlan | null {
  try {
    const raw = JSON.parse(localStorage.getItem(ROUTED_KEY) ?? "null");
    return raw && Array.isArray(raw.tasks) ? raw : null;
  } catch {
    return null;
  }
}

export function clearRoutedPlan() {
  try {
    localStorage.removeItem(ROUTED_KEY);
  } catch {
    // Nothing to clear without storage.
  }
}

// ---- the preview ----

/** A made-up reply for the preview (`npm run dev`), which has no CLI to
 *  run: the items spread over targets, the first two merged, one left
 *  unsure, wrapped in prose and a fence the way models often answer. An item
 *  saying "router error" makes the reply unreadable, to try Retry with. */
export function previewReply(items: RouterItem[], cards: RouterCard[], sessions: OpenSession[], past: IndexEntry[] = []): string {
  if (items.some((i) => /router error/i.test(i.text))) return "Sorry, I can't help with that.";
  const projects = cards.filter((c) => !c.projectId.startsWith("folder:"));
  const tasks = [];
  let rest = items;
  if (items.length >= 2 && projects[0]) {
    const p = projects[0];
    tasks.push({
      sourceItemIds: [items[0].id, items[1].id],
      text: `${items[0].text}, then ${items[1].text}`,
      target: "project",
      projectId: p.projectId,
      mode: p.policy === "shared" ? "existing_worktree" : "new_worktree",
      ...(p.policy === "shared" && p.mainWorktreeId ? { worktreeId: p.mainWorktreeId } : {}),
      ...(p.skills[0] ? { skill: p.skills[0] } : {}),
      confidence: 0.85,
    });
    rest = items.slice(2);
  }
  rest.forEach((i, n) => {
    const s = sessions[n % Math.max(sessions.length, 1)];
    const pick = n % 4;
    const p = past[n];
    if (pick === 0 && p) {
      tasks.push({ sourceItemIds: [i.id], text: i.text, target: "project", projectId: p.projectId, mode: "existing_chat", sessionId: p.id, confidence: 0.8 });
    } else if (pick === 0 && s) {
      tasks.push({ sourceItemIds: [i.id], text: i.text, target: "project", projectId: s.projectId, mode: "existing_chat", sessionId: s.id, confidence: 0.7, question: `Follow up in “${s.name}”, or start fresh?` });
    } else if (pick === 1) {
      tasks.push({ sourceItemIds: [i.id], text: i.text, target: "project", projectId: projects[1]?.projectId, mode: "new_worktree", confidence: 0.3 });
    } else if (pick === 2) {
      tasks.push({ sourceItemIds: [i.id], text: i.text, target: "home", confidence: 0.9 });
    } else {
      tasks.push({ sourceItemIds: [i.id], text: i.text, target: "you", confidence: 0.8 });
    }
  });
  return `Here's the plan:\n\n\`\`\`json\n${JSON.stringify({ tasks }, null, 2)}\n\`\`\`\n`;
}
