// Routing: one headless call to the user's agent CLI turns the to-do list
// into a proposed plan of tasks, which the user edits before anything runs.
// This module builds the prompt, reads the reply into a plan, and checks the
// plan for clashes. It takes plain data (items, cards, open sessions) rather
// than reading store.ts, so all of it can be tested without the app.
import type { ProjectCard, RunPolicy } from "./cards";

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
  confidence: number;
  question?: string;
  planCheckpoint: boolean;
  /** The router wasn't sure, or named something that doesn't exist: the
   *  user picks. Cleared once they do. */
  needsChoice: boolean;
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
 *  cards, and the sessions a task could follow up in. JSON out, only. */
export function buildRouterPrompt(items: RouterItem[], cards: RouterCard[], openSessions: OpenSession[]): string {
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
    '  - "existing_chat": a follow-up in an open session, given by sessionId, when that session already holds the context the task needs.',
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
  return L.join("\n");
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

/** Clear the router's project pick for the user to make. */
function flagged(t: PlanTask): PlanTask {
  const { projectId: _p, worktreeId: _w, sessionId: _s, mode: _m, skill: _k, ...rest } = t;
  return { ...rest, needsChoice: true };
}

/** A task's references checked against what exists: a project with a card,
 *  a worktree and a session in that project. */
function refsOk(t: PlanTask, ctx: RouteContext): boolean {
  if (t.target !== "project") return true;
  if (!t.projectId || !ctx.cards.some((c) => c.projectId === t.projectId)) return false;
  if (t.worktreeId && !ctx.worktrees.some((w) => w.id === t.worktreeId && w.projectId === t.projectId)) return false;
  if (t.sessionId && !ctx.sessions.some((s) => s.id === t.sessionId && s.projectId === t.projectId)) return false;
  if (t.mode === "existing_worktree" && !t.worktreeId) return false;
  if (t.mode === "existing_chat" && !t.sessionId) return false;
  return true;
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
      task.skill = str(r.skill);
    }
    if (!task.question) delete task.question;
    for (const k of ["projectId", "mode", "worktreeId", "sessionId", "skill"] as const) {
      if (task[k] === undefined) delete task[k];
    }
    if (!target || task.confidence < CONFIDENCE_THRESHOLD || (ctx && !refsOk(task, ctx))) task = flagged(task);
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
    const s = ctx.sessions.find((x) => x.id === id);
    issues.push({
      kind: "conflict",
      taskIds: ts.map((t) => t.id),
      message: `${ts.length} tasks would follow up in the same chat${s ? `, ${s.name}` : ""}. Merge them or move one.`,
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
  const { projectId: _p, mode: _m, worktreeId: _w, sessionId: _s, skill, ...rest } = task;
  const next: PlanTask = { ...rest, target, needsChoice: false };
  if (target !== "project" || !projectId) return next;
  const keepSkill = skill && ctx.cards.find((c) => c.projectId === projectId)?.skills.includes(skill);
  return { ...next, projectId, ...defaultMode(projectId, ctx), ...(keepSkill ? { skill } : {}) };
}

/** A task's mode changed: the worktree or chat it named goes with the old mode. */
export function withMode(task: PlanTask, mode: Mode, ctx: RouteContext): PlanTask {
  const { worktreeId: _w, sessionId: _s, ...rest } = task;
  const next: PlanTask = { ...rest, mode };
  if (mode === "existing_worktree" && task.projectId) {
    const d = defaultMode(task.projectId, ctx);
    if (d.worktreeId) next.worktreeId = d.worktreeId;
  }
  return next;
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
  const routed = { tasks: plan.tasks.map(({ needsChoice: _n, ...t }) => ({ ...t, needsChoice: false })), at: Date.now() };
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
export function previewReply(items: RouterItem[], cards: RouterCard[], sessions: OpenSession[]): string {
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
    if (pick === 0 && s) {
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
