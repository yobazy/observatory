// Wires the project leads (lead.ts) to the app: watches the store for each
// thread's status, its stuck flag and the PR on its branch, and sends the
// events to its project's lead through enqueue() (queue.ts), so a busy lead
// gets them, batched, when its turn ends. Nothing is watched for a project
// without a running lead, and nothing is sent while a lead is stopped. It
// also carries out the action lines in each finished lead turn (S28,
// leadActions.ts): starting tasks through Dispatch's queue, nudging threads,
// and keeping the asks for the dialogue's Yes and No.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createAgent, defaultKind } from "./actions";
import { allCards, homeCard, isFolderKey, saveLead, type CardLead, type ProjectCard } from "./cards";
import { allBatches, globalCap, queueNewTask, workingNow } from "./batch";
import { holdOn, holds, holdText } from "./budgetHold";
import { isPreview, readSettings, request } from "./client";
import {
  actionRules,
  ciOf,
  changeLeadModel,
  deliver,
  LINE_PREFIX,
  eventLine,
  eventNeed,
  carryUnknown,
  leadEvents,
  prOf,
  leadName,
  reviewMark,
  leadState,
  runningLeads,
  startLead,
  startLeadThread,
  type LeadEvent,
  type LeadQueue,
  type Snapshot,
} from "./lead";
import {
  ANSWERS_LOG,
  answerRules,
  askLineFor,
  DEFAULT_TOP_MODEL,
  logCounts,
  removeTopLeadWith,
  roster,
  rosterLine,
  tellRoster,
  topLeadPrompt,
  type LogCounts,
  type RosterEntry,
} from "./leadAsk";
import {
  answerAsk,
  askKey,
  DEFAULT_MAX_TASKS,
  leadActs,
  markActed,
  nudgesWithin,
  parseActions,
  replyToAct,
  reportLine,
  runActions,
  runPasses,
  startedState,
  tasksOf,
  updateLeadActs,
  type AskAction,
  type DecideContext,
  type PassTarget,
  type LeadTask,
} from "./leadActions";
import { latestReply, watchLeadCalls } from "./leadCalls";
import { mergePr } from "./prs";
import { checkVerdict, closeThread, onVerdicts, verdictKnown } from "./verdicts";
import { openPreview } from "./preview";
import { editQueued, enqueue } from "./queue";
import { savePrefs, type TopLead } from "./theme";
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
      pr: prOf(pr),
      ...ciOf(pr),
      safe: safeMark(a),
    };
  }
  return out;
}

/** The turn a thread said ✅ Safe to close in, as a mark; null when it's
 *  not at rest saying so, undefined while its reply is unread. */
function safeMark(a: Agent): string | null | undefined {
  const v = verdictKnown(a);
  if (v === undefined) return undefined;
  return v?.tone === "done" ? `${a.status_changed_at}` : null;
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
  const summary = fresh || (e.kind === "failed" && failed) || e.kind === "CI failed" || e.kind === "CI passed" ? "" : await turnSummary(a).catch(() => "");
  const found = s.prs[a.worktree_id];
  const url = found?.kind === "found" && found.pr.number === e.pr ? found.pr.url : undefined;
  return eventLine({
    kind: e.kind,
    title: a.name,
    branch: s.worktrees[a.worktree_id]?.branch ?? "?",
    agentId: a.id,
    // A CI failure is about its checks, by name.
    need:
      e.kind === "CI failed"
        ? (e.failing ?? []).join(", ") || "a check"
        : e.kind === "CI passed"
          ? "every check passed"
          : eventNeed(e.kind, a, record, failed, summary),
    pr: e.kind === "PR opened" ? openPr(found) : e.pr !== undefined ? { number: e.pr, url } : null,
  });
}

/** The PR a worktree's lookup found, for its `PR opened` line. */
function openPr(p: State["prs"][string] | undefined): { number: number; url: string } | null {
  return p?.kind === "found" ? { number: p.pr.number, url: p.pr.url } : null;
}

/** One send at a time per lead, so a line can't race the one before it. */
const chains = new Map<string, Promise<unknown>>();
function inTurn(leadId: string, job: () => Promise<unknown>) {
  const next = (chains.get(leadId) ?? Promise.resolve()).then(job).catch((e) => flash(`Couldn't tell the lead: ${errText(e)}`));
  chains.set(leadId, next);
  return next;
}

/** A lead's side of queue.ts, for deliver(). */
function leadQueue(leadId: string, lead: Agent): LeadQueue {
  return {
    last: () => {
      const q = getState().queue[leadId] ?? [];
      return q[q.length - 1] ?? null;
    },
    enqueue: (text) => enqueue(getState().agents[leadId] ?? lead, text, { stay: true }),
    edit: (id, text) => editQueued(leadId, id, text),
  };
}

async function send(leadId: string, events: LeadEvent[]) {
  const lines = (await Promise.all(events.map((e) => lineFor(e).catch(() => null)))).filter((l): l is string => !!l);
  const lead = getState().agents[leadId];
  // Stopped meanwhile: nothing goes.
  if (!lead || lead.archived) return;
  await deliver(lines, leadQueue(leadId, lead));
}

/** A running lead's old thread, archived before Restart starts a new one,
 *  so two threads never answer to the same name. */
async function retire(lead: CardLead | undefined) {
  const a = lead ? getState().agents[lead.agentId] : undefined;
  if (a && !a.archived) await request("ArchiveAgent", { id: a.id });
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
  const before = allCards()[projectId]?.lead;
  await retire(before);
  // A restarted lead stays the same animal, and keeps its actions switch:
  // on for a new lead, off for one saved before S28 until it's turned on.
  const keep = {
    ...(before?.pet ? { pet: before.pet } : {}),
    ...((before ? before.acts === true : true) ? { acts: true } : {}),
    ...(before?.maxTasks ? { maxTasks: before.maxTasks } : {}),
  };
  return startLead(
    { project: project.name, path: main.path, notes: opts.notes, model: opts.model, acts: !!keep.acts, maxTasks: keep.maxTasks ?? DEFAULT_MAX_TASKS },
    {
      create: (prompt, model) =>
        createAgent({ worktree: main.id, kind, settings, prompt, preset: { name: "Lead", kind, model }, select: false }),
      save: (lead) => saveLead(projectId, { ...lead, ...keep }, opts.base),
    },
    answerRules({ name: leadName(project.name), notes: opts.notes }),
  );
}

// ---- the top lead (S26) ----

/** Every running project lead, by its name and main checkout. */
function currentRoster(s: Pick<State, "agents" | "projects" | "worktrees">): RosterEntry[] {
  const leads = runningLeads(allCards(), s.agents, s.projects);
  const where: Record<string, { name: string; path: string }> = {};
  for (const id of Object.keys(leads)) {
    const main = Object.values(s.worktrees).find((w) => w.project_id === id && w.is_main);
    if (main && s.projects[id]) where[id] = { name: s.projects[id].name, path: main.path };
  }
  return roster(leads, where);
}

/** Where the top lead runs when no folder was picked: Home's folder, else
 *  your home folder. */
export async function defaultTopFolder(): Promise<string> {
  const s = getState();
  const home = homeCard();
  if (home && !isFolderKey(home.key) && s.projects[home.key]) return s.projects[home.key].repo_path;
  if (home?.card.homeFolder) return home.card.homeFolder;
  if (isPreview()) return "/Users/dev";
  const { homeDir } = await import("@tauri-apps/api/path");
  return homeDir();
}

/** The main checkout of the project at `folder`, adding the folder as a
 *  project first when it isn't one. nebula only runs threads in projects,
 *  which are git folders for now. */
async function mainCheckoutAt(folder: string): Promise<{ id: string }> {
  const path = folder.replace(/\/+$/, "");
  const find = () => {
    const s = getState();
    const p = Object.values(s.projects).find((x) => x.repo_path.replace(/\/+$/, "") === path);
    return p ? Object.values(s.worktrees).find((w) => w.project_id === p.id && w.is_main) : undefined;
  };
  const known = find();
  if (known) return known;
  try {
    await request("AddProject", { path, name: null, create_missing: false });
  } catch (e) {
    const msg = errText(e);
    throw new Error(
      /not a git repository/i.test(msg) ? `nebula only runs threads in a git folder for now, and ${path} isn't one. Pick one.` : msg,
    );
  }
  const deadline = Date.now() + 15_000;
  for (;;) {
    const w = find();
    if (w) return w;
    if (Date.now() > deadline) throw new Error(`${path}'s main checkout didn't show up`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const saveTopLead = (top: TopLead | undefined) => savePrefs({ ...getState().prefs, topLead: top });

/** "Start the top lead" (and Restart) in Settings. */
export async function startTopLead(opts: { path: string; model: string; notes: string }): Promise<CardLead> {
  const main = await mainCheckoutAt(opts.path);
  const settings = await readSettings();
  const kind = defaultKind(settings);
  const before = getState().prefs.topLead;
  await retire(before);
  const pet = before?.pet ? { pet: before.pet } : {};
  const s = getState();
  const prompt = topLeadPrompt({
    path: opts.path,
    notes: opts.notes,
    leads: currentRoster(s),
    projects: Object.values(s.projects)
      .map((p) => ({ name: p.name, path: p.repo_path }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    vault: s.prefs.notesFolder,
  });
  return startLeadThread(
    prompt,
    { model: opts.model, notes: opts.notes },
    {
      create: (text, model) =>
        createAgent({ worktree: main.id, kind, settings, prompt: text, preset: { name: "Lead", kind, model }, select: false }),
      save: (lead) => void saveTopLead({ ...lead, ...pet, path: opts.path }),
    },
    DEFAULT_TOP_MODEL,
  );
}

/** The top lead's model field: saved, and a running top lead restarted on it. */
export function setTopLeadModel(top: TopLead, model: string) {
  const running = leadState(top, getState().agents) === "running";
  return changeLeadModel(top, model, running, {
    save: (next) => void saveTopLead({ ...next, path: top.path }),
    restart: async (next) => startTopLead({ path: top.path ?? (await defaultTopFolder()), model: next, notes: top.notes }),
  });
}

/** The top lead's animal, from Settings. */
export function setTopLeadPet(top: TopLead, pet: { kind: string; coat: string }) {
  return saveTopLead({ ...top, pet });
}

/** Turn the top lead off: its thread archived, then forgotten. */
export function removeTopLead() {
  const s = getState();
  return removeTopLeadWith(s.prefs.topLead, s.agents, {
    archive: (id) => request("ArchiveAgent", { id }),
    forget: () => saveTopLead(undefined),
  });
}

/** The ask line for a task starting in `projectId` now (leadAsk.ts), or
 *  null when no lead could answer it. */
export function askLineNow(projectId: string | null): string | null {
  const s = getState();
  return askLineFor(projectId, { cards: allCards(), agents: s.agents, projects: s.projects, topLead: s.prefs.topLead });
}

/** The answers log's path on disk, or null while there's none. */
async function answersLogPath(): Promise<string | null> {
  const [path] = await invoke<(string | null)[]>("resolve_paths", { candidates: [ANSWERS_LOG], cwd: null });
  return path ?? null;
}

/** Today's answers, from the log every lead appends to. */
export async function answerCounts(now = new Date()): Promise<LogCounts> {
  if (isPreview()) return logCounts((await import("./mock")).mockAnswersLog(now), now);
  const path = await answersLogPath();
  if (!path) return { answered: 0, passed: 0 };
  // Read through the preview's file commands: open_preview lets this one
  // file be read, and nothing beside it.
  await invoke("open_preview", { path });
  return logCounts(await invoke<string>("read_preview_text", { path }), now);
}

/** Open the answers log in the preview. */
export async function openAnswersLog() {
  const path = isPreview() ? "/Users/dev/.config/observatory/leads/answers.log" : await answersLogPath();
  if (!path) throw new Error("no lead has answered anything yet");
  await openPreview([path]);
}

/** The model field on a card with a lead: saved, and a running lead
 *  restarted on it. */
export function setLeadModel(projectId: string, lead: CardLead, model: string) {
  const running = leadState(lead, getState().agents) === "running";
  return changeLeadModel(lead, model, running, {
    save: (next) => saveLead(projectId, next),
    restart: (next) => startProjectLead(projectId, { model: next, notes: lead.notes }),
  });
}

// ---- action lines (S28) ----

/** Send report lines to a lead, batched with its other [observatory] lines. */
function tell(leadId: string, lines: string[]) {
  if (!lines.length) return Promise.resolve();
  return inTurn(leadId, async () => {
    const lead = getState().agents[leadId];
    if (lead && !lead.archived) await deliver(lines, leadQueue(leadId, lead));
  });
}

/** The project a lead runs for, and its card's lead, or null for the top
 *  lead and anything else. */
function projectLead(leadId: string): { projectId: string; lead: CardLead } | null {
  for (const [projectId, card] of Object.entries(allCards())) if (card.lead?.agentId === leadId) return { projectId, lead: card.lead };
  return null;
}

/** The lead's started tasks with where each is now. */
export function startedTasks(projectId: string, s: Pick<State, "agents" | "worktrees" | "prs"> = getState()) {
  const batches = allBatches();
  return tasksOf(projectId).map((rec) => {
    const task = batches.find((b) => b.id === rec.batchId)?.tasks.find((t) => t.id === rec.taskId);
    const agentId = rec.agentId ?? task?.agentId;
    const agent = agentId ? s.agents[agentId] : undefined;
    const p = agent ? s.prs[agent.worktree_id] : undefined;
    return { rec, agent, ...startedState(task, agent, p?.kind === "found" ? p.pr : null) };
  });
}

/** Launches are held now, and why (budgetHold.ts), for a task in `projectId`. */
function holdNow(projectId: string): string | null {
  const hold = holdOn(
    { state: "pending", target: "project", projectId } as Parameters<typeof holdOn>[0],
    holds(getState(), allCards()),
  );
  return hold ? holdText(hold) : null;
}

/** Carry out the action lines in a lead's reply `n`. */
async function act(leadId: string, projectId: string, lead: CardLead, n: number, text: string) {
  const actions = parseActions(text);
  if (!actions.length) return;
  if (lead.acts !== true) {
    // Off: the lines are ignored, and the lead is told so once.
    if (leadActs().toldOff.includes(leadId)) return;
    updateLeadActs((x) => ({ toldOff: [...x.toldOff, leadId] }));
    await tell(leadId, [reportLine({ kind: "off" })]);
    return;
  }
  const context = (): DecideContext => {
    const s = getState();
    const waiting = tasksOf(projectId).filter((t) => !t.told).map((t) => t.branch);
    const branches = new Set([
      ...Object.values(s.worktrees)
        .filter((w) => w.project_id === projectId)
        .map((w) => w.branch),
      ...waiting,
    ]);
    const prs = new Set(
      Object.values(s.worktrees).flatMap((w) => {
        const p = w.project_id === projectId ? s.prs[w.id] : undefined;
        return p?.kind === "found" && (p.pr.state === "open" || p.pr.state === "draft") ? [p.pr.number] : [];
      }),
    );
    const threads: DecideContext["threads"] = {};
    for (const x of Object.values(s.agents)) threads[x.id] = { projectId: s.worktrees[x.worktree_id]?.project_id ?? null, archived: x.archived };
    return {
      acts: true,
      top: false,
      leadId,
      projectId,
      running: startedTasks(projectId, s).filter((t) => t.busy).length,
      maxTasks: lead.maxTasks ?? DEFAULT_MAX_TASKS,
      hold: actions.some((a) => a.kind === "start") ? holdNow(projectId) : null,
      branches,
      threads,
      nudges: (id) => nudgesWithin(leadActs().nudges, id),
      prs,
    };
  };
  const done = await runActions(actions, {
    context,
    start: (branch, brief) => {
      const batch = queueNewTask({ text: brief, projectId, branch }, allCards());
      const rec: LeadTask = { leadId, projectId, batchId: batch.id, taskId: batch.tasks[0].id, branch, at: Date.now(), n };
      updateLeadActs((x) => ({ tasks: [...x.tasks, rec] }));
      void import("./batchRunner").then((m) => m.kickBatches());
      const s = getState();
      const working = workingNow(
        allBatches().flatMap((b) => b.tasks),
        s.agents,
      );
      return { full: working >= globalCap(s.prefs.dispatchCap) ? working : null };
    },
    nudge: async (agentId, message) => {
      await enqueue(getState().agents[agentId], message, { stay: true });
      updateLeadActs((x) => ({ nudges: [...x.nudges, { leadId, agentId, at: Date.now() }] }));
    },
    name: (agentId) => getState().agents[agentId]?.name ?? agentId,
  });
  const outcome = { n, lines: done.lines, asks: done.asks };
  updateLeadActs((x) => ({ outcomes: { ...x.outcomes, [leadId]: outcome }, history: [...x.history, { ...outcome, leadId }] }));
  await tell(leadId, done.reports.map(reportLine));
}

/** Lead-started tasks that have launched (or failed to) since last told. */
function followStarts() {
  const batches = allBatches();
  const s = getState();
  for (const rec of leadActs().tasks) {
    if (rec.told) continue;
    const task = batches.find((b) => b.id === rec.batchId)?.tasks.find((t) => t.id === rec.taskId);
    const mark = (patch: Partial<LeadTask>) =>
      updateLeadActs((x) => ({ tasks: x.tasks.map((t) => (t.taskId === rec.taskId ? { ...t, ...patch, told: true } : t)) }));
    if (!task) {
      mark({});
      void tell(rec.leadId, [reportLine({ kind: "refused", action: { kind: "start", branch: rec.branch, brief: "" }, reason: "it was taken off the Dispatch board" })]);
    } else if (task.state === "failed") {
      mark({});
      void tell(rec.leadId, [reportLine({ kind: "refused", action: { kind: "start", branch: rec.branch, brief: "" }, reason: task.note ?? "its launch failed" })]);
    } else if (task.state === "launched" && task.agentId) {
      const agent = s.agents[task.agentId];
      // The branch it got: a name already taken gets a suffix.
      const branch = (agent && s.worktrees[agent.worktree_id]?.branch) || rec.branch;
      mark({ agentId: task.agentId, branch });
      void tell(rec.leadId, [reportLine({ kind: "started", branch, agentId: task.agentId })]);
    }
  }
}

/** Each running lead's finished turn, acted on once. The top lead acts
 *  only through project leads: its PASS lines go on to them, and its other
 *  action lines are ignored. */
function actOnTurns() {
  const s = getState();
  const acted = leadActs().acted;
  const top = s.prefs.topLead?.agentId;
  const ids = [...Object.values(runningLeads(allCards(), s.agents, s.projects)), ...(top ? [top] : [])];
  for (const leadId of ids) {
    const reply = replyToAct(s.agents[leadId], latestReply(leadId), acted[leadId]);
    if (!reply) continue;
    markActed(leadId, reply.n);
    if (leadId === top) {
      void passOn(leadId, reply.text).catch((e) => flash(`The top lead's PASS didn't go: ${errText(e)}`));
      continue;
    }
    const mine = projectLead(leadId);
    if (!mine) continue;
    void act(leadId, mine.projectId, mine.lead, reply.n, reply.text).catch((e) => flash(`The lead's actions didn't go: ${errText(e)}`));
  }
}

/** The top lead's PASS lines, forwarded to each project's lead; its other
 *  action lines are ignored. */
async function passOn(topId: string, text: string) {
  const s = getState();
  const targets: PassTarget[] = Object.entries(allCards()).flatMap(([projectId, card]) => {
    const p = s.projects[projectId];
    if (!card.lead || !p) return [];
    return [{ project: p.name, agentId: card.lead.agentId, running: leadState(card.lead, s.agents) === "running", acts: card.lead.acts === true }];
  });
  const reports = await runPasses(parseActions(text), targets, (agentId, line) => tell(agentId, [line]));
  await tell(topId, reports.map(reportLine));
}

/** Yes or No on a lead's ASK row in the dialogue. */
export function answerLeadAsk(leadId: string, n: number, ask: AskAction, yes: boolean) {
  const mine = projectLead(leadId);
  return answerAsk(askKey(leadId, n, ask), ask, yes, {
    merge: async (number) => {
      const s = getState();
      const wt = Object.values(s.worktrees).find((w) => {
        const p = w.project_id === mine?.projectId ? s.prs[w.id] : undefined;
        return p?.kind === "found" && p.pr.number === number;
      });
      const p = wt ? s.prs[wt.id] : undefined;
      if (!wt || p?.kind !== "found") throw new Error(`no PR #${number} in this project`);
      await mergePr(wt, p.pr);
    },
    archive: (agentId) => {
      const a = getState().agents[agentId];
      if (!a) throw new Error("that thread is gone");
      closeThread(a);
    },
    tell: (line) => tell(leadId, [line]),
  });
}

/** The card's "Let the lead start and nudge threads". A running lead hears
 *  of it: turned on, with what the action lines are (its prompt may not
 *  have had them), and from its next reply on; off, once. */
export function setLeadActs(projectId: string, lead: CardLead, on: boolean) {
  const { acts: _was, ...rest } = lead;
  saveLead(projectId, on ? { ...rest, acts: true } : rest);
  if (leadState(lead, getState().agents) !== "running") return;
  const id = lead.agentId;
  // What it said before now isn't acted on.
  const n = latestReply(id)?.n;
  if (n !== undefined) markActed(id, n);
  if (on) {
    updateLeadActs((x) => ({ toldOff: x.toldOff.filter((t) => t !== id) }));
    void tell(id, [`${LINE_PREFIX}actions are on. ${actionRules(lead.maxTasks ?? DEFAULT_MAX_TASKS)}`]);
  } else {
    updateLeadActs((x) => ({ toldOff: [...x.toldOff.filter((t) => t !== id), id] }));
    void tell(id, [reportLine({ kind: "off" })]);
  }
}

/** How many of the lead's tasks may run at once. */
export function setLeadMaxTasks(projectId: string, lead: CardLead, max: number) {
  if (!Number.isFinite(max) || max < 1) return;
  saveLead(projectId, { ...lead, maxTasks: Math.floor(max) });
}

/** Mount once. */
export function useLeadRunner() {
  useEffect(() => {
    let before: Snapshot | null = null;
    let seen: { agents: State["agents"]; prs: State["prs"]; stuck: StuckEntries; reviews: ReviewRecords; verdicts: number } | null = null;
    // Bumped when a verdict is read, which the store doesn't signal.
    let verdicts = 0;
    let leadsBefore: RosterEntry[] | null = null;
    const tick = () => {
      const s = getState();
      if (!s.loaded || s.link.state !== "connected") return;
      // The top lead hears when a project's lead starts or stops.
      const leadsNow = currentRoster(s);
      const top = s.prefs.topLead;
      const topAgent = top ? s.agents[top.agentId] : undefined;
      const was = leadsBefore;
      if (topAgent && !topAgent.archived && was && rosterLine(was) !== rosterLine(leadsNow))
        void inTurn(topAgent.id, () => tellRoster(was, leadsNow, leadQueue(topAgent.id, topAgent)));
      leadsBefore = leadsNow;
      // S28: what each finished lead turn says to do, and how the tasks
      // leads started are getting on.
      actOnTurns();
      followStarts();
      const stuck = loadStuck();
      const reviews = loadReviews();
      // A lead hears when a thread says ✅ Safe to close: read the verdicts
      // of the threads it's watching as they come to rest.
      const watched = runningLeads(allCards(), s.agents, s.projects);
      for (const a of Object.values(s.agents))
        if (a.status === "finished" && !a.archived && watched[s.worktrees[a.worktree_id]?.project_id ?? ""]) checkVerdict(a);
      if (seen && seen.agents === s.agents && seen.prs === s.prs && seen.stuck === stuck && seen.reviews === reviews && seen.verdicts === verdicts)
        return;
      seen = { agents: s.agents, prs: s.prs, stuck, reviews, verdicts };
      const after = snapshot(s, stuck, reviews);
      // The top lead is in some project's folder, but it isn't one of its tasks.
      if (top) delete after[top.agentId];
      const events = before ? leadEvents(before, after, runningLeads(allCards(), s.agents, s.projects)) : [];
      before = carryUnknown(before ?? {}, after);
      const byLead = new Map<string, LeadEvent[]>();
      for (const e of events) byLead.set(e.leadId, [...(byLead.get(e.leadId) ?? []), e]);
      for (const [leadId, list] of byLead) void inTurn(leadId, () => send(leadId, list));
    };
    const off = subscribe(tick);
    const offCalls = watchLeadCalls(tick);
    const offVerdicts = onVerdicts(() => {
      verdicts++;
      tick();
    });
    // Stuck flags and reviews are kept outside the store: look now and then.
    const timer = setInterval(tick, 5_000);
    return () => {
      off();
      offCalls();
      offVerdicts();
      clearInterval(timer);
    };
  }, []);
}
