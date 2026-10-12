// Batches: a confirmed Dispatch plan, launched as sessions and follow-ups a
// few at a time. A batch is the plan's tasks, each mapped to the session it
// started (or the chat it followed up in) once it has. The daemon sees
// ordinary worktrees and agents; the grouping is this app's, kept in
// localStorage like fanout.ts's. This module holds the data, the scheduler
// and the launcher with everything app-side passed in, so all of it can be
// tested without the rest of the app; batchRunner.ts wires it to the store.
// Value imports name their .ts files: the tests load this module in Node.
import { useSyncExternalStore } from "react";
import { canSchedule, homeCard, isFolderKey, type Cards } from "./cards.ts";
import { linkItems, setItemsChecked, unlinkBatch, type DispatchItem } from "./dispatch.ts";
import { clearRoutedPlan, type PlanTask, type RoutedPlan } from "./router.ts";
import { freeName, suggestBranch } from "./branches.ts";
import type { Agent, AgentKind, AgentStatus } from "./types";

/** Where a task is in launching:
 *  - pending: waiting for a slot.
 *  - launching: its request is out. Saved before the request goes, so a
 *    second tick, or a restart, doesn't launch it again.
 *  - launched: it has a session (`agentId`).
 *  - listed: a `you` task with nothing to book it; it stays on the list.
 *  - blocked: can't start until something changes (`note` says what).
 *  - failed: the launch was refused or cut short (`note`); not retried. */
export type TaskState = "pending" | "launching" | "launched" | "listed" | "blocked" | "failed";

export interface BatchTask extends Omit<PlanTask, "needsChoice"> {
  /** The source items' detail lines, as they were when dispatched. */
  context: string[];
  state: TaskState;
  /** The group whose own cap it counts against: a Shared project's id, or
   *  HOME_LANE for Home and `you` tasks. None for Isolated projects. */
  lane: string | null;
  /** The session that took the task (new, or the chat it followed up in). */
  agentId?: string;
  /** The worktree made for a `new_worktree` task. */
  createdWorktreeId?: string;
  /** What the session was sent, once it's been worked out. */
  prompt?: string;
  launchingAt?: number;
  launchedAt?: number;
  /** Why it's blocked or failed, or how a follow-up went ("queued"). */
  note?: string;
  /** Blocked on Home: `homeSignature` when it was. A change to Home (another
   *  folder, a project now, a scheduling instruction) lets it try again. */
  blockedOnHome?: string;
  blockedAt?: number;
  /** Its plan was approved on the board: no more stopping for an OK. */
  planApproved?: boolean;
  /** When the board last answered its plan another way (Redirect): the
   *  plan it stops at after that is a new one. */
  planAnsweredAt?: number;
  /** Cancelled at its plan from the board (its session archived). */
  cancelled?: boolean;
  /** Checked off on the board; its source items are checked too. */
  done?: boolean;
}

export interface Batch {
  id: string;
  at: number;
  tasks: BatchTask[];
  /** Taken off the board. Its unchecked items can be routed again. */
  dismissed?: boolean;
  /** The batch's summary banner has fired since it last settled
   *  (board.ts's `decideSummary`), and what it said. */
  notifiedSettle?: boolean;
  lastSummary?: string;
}

export const HOME_LANE = "home";
/** Sessions Dispatch runs at once, across batches, unless set otherwise. */
export const DEFAULT_CAP = 4;
/** Statuses that hold a slot. A slot frees when the session finishes or is
 *  terminated; one waiting on you still holds it, and so does one that's
 *  only disconnected (the link dropped, not the session). */
const WORKING: AgentStatus[] = ["fresh", "running", "needs_feedback", "disconnected"];
/** How long a session just created may be missing from the store (its
 *  entity can land after the Ack) and still hold its slot. */
const ARRIVAL_MS = 30_000;
/** A launch still unconfirmed after this, across a restart, is given up on. */
export const LAUNCH_TIMEOUT_MS = 90_000;

export const PLAN_POSTFIX =
  "Before you change anything: investigate, then reply with a short numbered plan and stop there. Wait for my approval before going further, and don't edit any files yet.";

// ---- the prompt ----

export interface PromptTask {
  text: string;
  target: PlanTask["target"];
  context: string[];
  skill?: string;
  planCheckpoint: boolean;
}

/** What a task's session is sent: the task (through its skill when it has
 *  one), the items' detail lines, Home's scheduling instruction for Home and
 *  `you` tasks, and the plan-and-stop postfix last when the task stops for
 *  approval. Claude runs a skill as `/<skill>`; other harnesses are told it
 *  by name. */
export function buildStartingPrompt(
  task: PromptTask,
  opts: { kind: AgentKind | string; schedulingInstruction?: string },
): string {
  const text = task.text.trim();
  let body =
    task.target === "you"
      ? `This is something I'll do myself. Find a time for it and put it on my schedule: ${text}`
      : text;
  if (task.skill) {
    body = opts.kind === "claude" ? `/${task.skill} ${body}` : `Use the ${task.skill} skill for this.\n\n${body}`;
  }
  const parts = [body];
  const details = task.context.map((c) => c.trim()).filter(Boolean);
  if (details.length) parts.push(["Details:", ...details.map((c) => `- ${c}`)].join("\n"));
  const instruction = opts.schedulingInstruction?.trim();
  if (instruction && task.target !== "project") parts.push(`How I schedule things: ${instruction}`);
  if (task.planCheckpoint) parts.push(PLAN_POSTFIX);
  return parts.join("\n\n");
}

// ---- making a batch ----

/** The confirmed plan as a batch: every task pending, except `you` tasks
 *  with nothing to book them, which stay on the list. */
export function makeBatch(
  routed: RoutedPlan,
  items: { id: string; context: string[] }[],
  cards: Cards,
  id = `b${Date.now().toString(36)}`,
): Batch {
  const home = homeCard(cards);
  const contextOf = new Map(items.map((i) => [i.id, i.context]));
  const tasks = routed.tasks.map(({ needsChoice: _n, ...t }): BatchTask => {
    const lane =
      t.target !== "project"
        ? HOME_LANE
        : t.projectId && cards[t.projectId]?.policy === "shared"
          ? t.projectId
          : null;
    const scheduled = t.target !== "you" || canSchedule(home?.card);
    return {
      ...t,
      // Plan ids are only unique within the plan.
      id: `${id}-${t.id}`,
      context: t.sourceItemIds.flatMap((i) => contextOf.get(i) ?? []),
      state: scheduled ? "pending" : "listed",
      lane,
    };
  });
  return { id, at: routed.at, tasks };
}

// ---- the scheduler ----

/** Whether a task holds a slot: its launch is out, or its session is still
 *  working (or waiting on you). */
export function occupies(t: BatchTask, agents: Record<string, Agent>, now = Date.now()): boolean {
  if (t.state === "launching") return true;
  if (t.state !== "launched" || !t.agentId) return false;
  const a = agents[t.agentId];
  if (!a) return now - (t.launchedAt ?? 0) < ARRIVAL_MS;
  return !a.archived && WORKING.includes(a.status);
}

export interface Limits {
  /** Sessions at once, across every batch. */
  globalCap: number;
  /** A lane's own cap: a Shared project's (or Home's) concurrency. */
  laneCap: (lane: string) => number;
}

/** The pending tasks to launch now, in plan order: as many as the global
 *  cap has room for, skipping any whose lane is full. */
export function nextLaunchable(
  tasks: BatchTask[],
  agents: Record<string, Agent>,
  limits: Limits,
  now = Date.now(),
): BatchTask[] {
  const busy = tasks.filter((t) => occupies(t, agents, now));
  let free = limits.globalCap - busy.length;
  const inLane = new Map<string, number>();
  for (const t of busy) if (t.lane) inLane.set(t.lane, (inLane.get(t.lane) ?? 0) + 1);
  const out: BatchTask[] = [];
  for (const t of tasks) {
    if (free <= 0) break;
    if (t.state !== "pending") continue;
    if (t.lane) {
      const n = inLane.get(t.lane) ?? 0;
      if (n >= Math.max(1, limits.laneCap(t.lane))) continue;
      inLane.set(t.lane, n + 1);
    }
    out.push(t);
    free--;
  }
  return out;
}

/** The global cap from the prefs: a whole number, at least 1. */
export function globalCap(pref: unknown): number {
  return typeof pref === "number" && Number.isFinite(pref) && pref >= 1 ? Math.floor(pref) : DEFAULT_CAP;
}

/** A lane's cap from the cards: the Shared project's concurrency, or Home's. */
export function laneCapper(cards: Cards): (lane: string) => number {
  return (lane) => (lane === HOME_LANE ? homeCard(cards)?.card.concurrency : cards[lane]?.concurrency) ?? 1;
}

/** A task left `launching` by an app that quit mid-request: settled from
 *  what the daemon has. A follow-up counts as sent (sending it twice is
 *  worse than not at all); a new session is found by the prompt it was
 *  started with. One not found in time is given up on, not relaunched,
 *  in case it started after all. Null: nothing to change yet. */
export function reconcile(
  t: BatchTask,
  agents: Record<string, Agent>,
  claimed: Set<string>,
  now = Date.now(),
): Partial<BatchTask> | null {
  if (t.state !== "launching") return null;
  if (t.agentId) return { state: "launched", launchedAt: now };
  const head = t.prompt?.trim().slice(0, 120);
  const found =
    head &&
    Object.values(agents).find(
      (a) =>
        !claimed.has(a.id) &&
        (!t.createdWorktreeId || a.worktree_id === t.createdWorktreeId) &&
        a.recent_prompts.some((p) => p.text.trim().startsWith(head)),
    );
  if (found) return { state: "launched", agentId: found.id, launchedAt: now };
  if (now - (t.launchingAt ?? 0) > LAUNCH_TIMEOUT_MS) {
    return {
      state: "failed",
      note: "Its launch was cut short. Check the project for a new session before dispatching it again.",
    };
  }
  return null;
}

// ---- where a task runs ----

export interface World {
  projects: Record<string, { id: string; repo_path: string }>;
  worktrees: Record<string, { id: string; project_id: string; is_main: boolean }>;
  agents: Record<string, Agent>;
  cards: Cards;
}

export type Where =
  | { how: "follow_up"; agent: Agent }
  | { how: "agent"; worktreeId: string }
  | { how: "new_worktree"; projectId: string }
  /** Home is a plain folder: it has to be a project before it can run anything. */
  | { how: "add_home"; folder: string }
  /** Home's folder has become a project: its card moves to the project's id. */
  | { how: "adopt_home"; projectId: string }
  /** Not yet: e.g. Home's project is known but its main checkout isn't. */
  | { how: "wait" }
  | { how: "blocked"; note: string; onHome?: boolean }
  | { how: "failed"; note: string };

/** What about Home decides whether a task blocked on it can run. */
export function homeSignature(cards: Cards): string {
  const home = homeCard(cards);
  return home ? `${home.key}|${canSchedule(home.card)}` : "";
}

/** How often a task blocked on Home tries again anyway: the folder may
 *  have been made a git repo without Home being picked again. */
export const BLOCKED_RETRY_MS = 5 * 60_000;

/** Whether a blocked task should go back to pending: Home has changed since,
 *  or it's been a while. */
export function shouldRetry(t: BatchTask, sig: string, now = Date.now()): boolean {
  if (t.state !== "blocked") return false;
  return t.blockedOnHome !== sig || now - (t.blockedAt ?? 0) > BLOCKED_RETRY_MS;
}

const mainOf = (w: World, projectId: string) =>
  Object.values(w.worktrees).find((x) => x.project_id === projectId && x.is_main)?.id;
const trimSlash = (p: string) => p.replace(/\/+$/, "");

/** Where a task's session goes. Home and `you` tasks run in Home's main
 *  checkout; a Shared project's run in its main checkout unless the plan
 *  named another worktree; follow-ups go to their chat. */
export function whereTo(t: BatchTask, w: World): Where {
  if (t.target !== "project") {
    const home = homeCard(w.cards);
    if (!home) return { how: "blocked", note: "No Home is set. Pick one from the sidebar.", onHome: true };
    if (t.target === "you" && !canSchedule(home.card)) {
      return { how: "blocked", note: "Home has no scheduling instruction, so this stays on your list.", onHome: true };
    }
    if (isFolderKey(home.key)) {
      const folder = trimSlash(home.card.homeFolder ?? home.key.slice("folder:".length));
      const project = Object.values(w.projects).find((p) => trimSlash(p.repo_path) === folder);
      return project ? { how: "adopt_home", projectId: project.id } : { how: "add_home", folder };
    }
    if (!w.projects[home.key]) return { how: "blocked", note: "Home's project was removed. Pick Home again.", onHome: true };
    const main = mainOf(w, home.key);
    return main ? { how: "agent", worktreeId: main } : { how: "wait" };
  }

  const projectId = t.projectId;
  if (!projectId || !w.projects[projectId]) return { how: "failed", note: "Its project is gone." };
  if (t.mode === "existing_chat") {
    const a = t.sessionId ? w.agents[t.sessionId] : undefined;
    if (!a || a.archived) return { how: "failed", note: "The chat it was to follow up in is gone." };
    return { how: "follow_up", agent: a };
  }
  if (t.mode === "existing_worktree" && t.worktreeId) {
    return w.worktrees[t.worktreeId]
      ? { how: "agent", worktreeId: t.worktreeId }
      : { how: "failed", note: "Its worktree is gone." };
  }
  if (w.cards[projectId]?.policy === "shared") {
    const main = mainOf(w, projectId);
    return main ? { how: "agent", worktreeId: main } : { how: "failed", note: "The project's main checkout isn't there." };
  }
  return { how: "new_worktree", projectId };
}

// ---- launching ----

/** What launching needs from the app, passed in so it can be tested alone. */
export interface LaunchDeps {
  world(): World;
  /** The harness new sessions start with: the user's default. */
  kind: AgentKind;
  /** Done with its turn and not waiting on you (queue.ts's isIdle). */
  isIdle(a: Agent): boolean;
  /** Prompts already queued for an agent. */
  queuedFor(agentId: string): number;
  followUp(a: Agent, text: string): Promise<void>;
  enqueue(a: Agent, text: string): Promise<unknown>;
  /** Start a session without selecting it; resolves with its id. */
  createAgent(worktreeId: string, prompt: string): Promise<string | null>;
  createWorktree(projectId: string, branch: string): Promise<string>;
  takenBranches(projectId: string): Promise<Set<string>>;
  /** Add a folder as a nebula project; resolves with its id. */
  addProject(path: string): Promise<string>;
  /** Move Home's card from its folder key to the project's id. */
  adoptHome(projectId: string): void;
  /** Saves what's known mid-launch (the prompt, a new worktree), so a
   *  restart can find the session. */
  progress(patch: Partial<BatchTask>): void;
}

export type Outcome =
  | { state: "launched"; agentId: string; note?: string }
  | { state: "pending" }
  | { state: "blocked"; note: string; blockedOnHome?: string }
  | { state: "failed"; note: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Launch one task: a new session where it belongs, or a follow-up in its
 *  chat (sent now when the chat is idle, queued when it's busy). */
export async function launchTask(t: BatchTask, deps: LaunchDeps): Promise<Outcome> {
  const w = deps.world();
  const where = whereTo(t, w);
  const instruction = t.target !== "project" ? homeCard(w.cards)?.card.schedulingInstruction : undefined;
  const promptFor = (kind: string) => buildStartingPrompt(t, { kind, schedulingInstruction: instruction });

  switch (where.how) {
    case "wait":
      return { state: "pending" };
    case "blocked":
      return { state: "blocked", note: where.note, ...(where.onHome ? { blockedOnHome: homeSignature(w.cards) } : {}) };
    case "failed":
      return { state: "failed", note: where.note };
    case "adopt_home":
      deps.adoptHome(where.projectId);
      return { state: "pending" };
    case "add_home":
      try {
        deps.adoptHome(await deps.addProject(where.folder));
        // Its main checkout shows up a moment later; a later tick starts it.
        return { state: "pending" };
      } catch (e) {
        const msg = errText(e);
        return {
          state: "blocked",
          note: /not a git repository/i.test(msg)
            ? `Home needs to be a git folder for now, and ${where.folder} isn't one. Pick a git folder as Home, or run \`git init\` in it.`
            : `Couldn't make Home a project: ${msg}`,
          blockedOnHome: homeSignature(w.cards),
        };
      }
    case "follow_up": {
      const a = where.agent;
      const prompt = promptFor(a.custom_harness ?? a.kind);
      deps.progress({ prompt, agentId: a.id });
      if (deps.isIdle(a) && deps.queuedFor(a.id) === 0) {
        await deps.followUp(a, prompt);
        return { state: "launched", agentId: a.id };
      }
      await deps.enqueue(a, prompt);
      return { state: "launched", agentId: a.id, note: "queued" };
    }
    case "agent":
    case "new_worktree": {
      const prompt = promptFor(deps.kind);
      let worktreeId: string;
      if (where.how === "agent") worktreeId = where.worktreeId;
      else {
        const branch = freeName(suggestBranch(t.text) || "task", await deps.takenBranches(where.projectId));
        worktreeId = await deps.createWorktree(where.projectId, branch);
        deps.progress({ createdWorktreeId: worktreeId });
      }
      deps.progress({ prompt });
      const id = await deps.createAgent(worktreeId, prompt);
      if (!id) return { state: "failed", note: "The daemon didn't return the new session." };
      return { state: "launched", agentId: id };
    }
  }
}

/** Counts for a line of status: what's working, waiting, and stuck. */
export function batchCounts(tasks: BatchTask[], agents: Record<string, Agent>, now = Date.now()) {
  const c = { working: 0, waiting: 0, done: 0, listed: 0, blocked: 0, failed: 0 };
  for (const t of tasks) {
    if (t.state === "pending") c.waiting++;
    else if (t.state === "listed") c.listed++;
    else if (t.state === "blocked") c.blocked++;
    else if (t.state === "failed") c.failed++;
    else if (occupies(t, agents, now)) c.working++;
    else c.done++;
  }
  return c;
}

// ---- storage ----

const KEY = "observatory.dispatch.batches";

function isTask(x: unknown): x is BatchTask {
  const t = x as BatchTask;
  return !!t && typeof t.id === "string" && typeof t.text === "string" && typeof t.state === "string";
}

/** The saved batches, as last written; none when there are none or they can't be read. */
export function loadBatches(): Batch[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!Array.isArray(raw?.batches)) return [];
    return raw.batches
      .filter((b: Batch) => b && typeof b.id === "string" && Array.isArray(b.tasks))
      .map((b: Batch) => ({
        ...b,
        tasks: b.tasks.filter(isTask).map((t) => ({ ...t, context: Array.isArray(t.context) ? t.context : [] })),
      }));
  } catch {
    return [];
  }
}

let batches: Batch[] | null = null;
const listeners = new Set<() => void>();

export function allBatches(): Batch[] {
  return (batches ??= loadBatches());
}

/** Drop what's in memory and read the batches from storage again. */
export function reloadBatches() {
  batches = loadBatches();
  listeners.forEach((l) => l());
}

function write(next: Batch[]) {
  batches = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ batches: next }));
  } catch {
    // Without storage the batches last until the app quits.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBatches(): Batch[] {
  return useSyncExternalStore(subscribe, allBatches);
}

export function updateTask(batchId: string, taskId: string, patch: Partial<BatchTask>) {
  write(
    allBatches().map((b) =>
      b.id !== batchId ? b : { ...b, tasks: b.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) },
    ),
  );
}

export function updateBatch(batchId: string, patch: Partial<Batch>) {
  write(allBatches().map((b) => (b.id === batchId ? { ...b, ...patch } : b)));
}

function findTask(batchId: string, taskId: string): BatchTask | undefined {
  return allBatches()
    .find((b) => b.id === batchId)
    ?.tasks.find((t) => t.id === taskId);
}

/** Put a failed task back in line to launch. Only from `failed`: anything
 *  else may have a launch out (or a session), and launching it again could
 *  start it twice. Returns whether it was. */
export function retryTask(batchId: string, taskId: string): boolean {
  if (findTask(batchId, taskId)?.state !== "failed") return false;
  updateTask(batchId, taskId, {
    state: "pending",
    note: undefined,
    agentId: undefined,
    createdWorktreeId: undefined,
    prompt: undefined,
    launchingAt: undefined,
    launchedAt: undefined,
  });
  return true;
}

/** Check a task off (or back on), and its source items in the list with it. */
export function checkOffTask(batchId: string, taskId: string, done: boolean) {
  const t = findTask(batchId, taskId);
  if (!t) return;
  updateTask(batchId, taskId, { done });
  setItemsChecked(t.sourceItemIds, done);
}

/** Take a batch off the board. Its items are no longer dispatched, so
 *  those still unchecked can be routed again. */
export function dismissBatch(batchId: string) {
  updateBatch(batchId, { dismissed: true });
  unlinkBatch(batchId);
}

/** Whether an item is out in a batch still on the board: routing it again
 *  could launch it twice. */
export function isDispatched(item: Pick<DispatchItem, "batchId">, batches: Batch[]): boolean {
  return !!item.batchId && batches.some((b) => b.id === item.batchId && !b.dismissed);
}

/** The items Route offers: unchecked, and not out in a batch. */
export function routableItems<T extends Pick<DispatchItem, "checked" | "batchId">>(items: T[], batches: Batch[]): T[] {
  return items.filter((i) => !i.checked && !isDispatched(i, batches));
}

/** Turn the plan handed off by the review (router.ts's `handOffPlan`) into a
 *  batch, which the runner then launches, and mark its items as dispatched.
 *  The items stay unchecked: they're done when the user says so. */
export function dispatchPlan(routed: RoutedPlan, items: { id: string; context: string[] }[], cards: Cards): Batch {
  const batch = makeBatch(routed, items, cards);
  write([...allBatches(), batch]);
  linkItems([...new Set(batch.tasks.flatMap((t) => t.sourceItemIds))], batch.id);
  clearRoutedPlan();
  return batch;
}
