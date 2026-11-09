// Wires the project leads (lead.ts) to the app: watches the store for each
// thread's status, its stuck flag and the PR on its branch, and sends the
// events to its project's lead through enqueue() (queue.ts), so a busy lead
// gets them, batched, when its turn ends. Nothing is watched for a project
// without a running lead, and nothing is sent while a lead is stopped.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createAgent, defaultKind } from "./actions";
import { allCards, homeCard, isFolderKey, saveLead, type CardLead, type ProjectCard } from "./cards";
import { isPreview, readSettings, request } from "./client";
import {
  changeLeadModel,
  deliver,
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
  await retire(allCards()[projectId]?.lead);
  return startLead(
    { project: project.name, path: main.path, notes: opts.notes, model: opts.model },
    {
      create: (prompt, model) =>
        createAgent({ worktree: main.id, kind, settings, prompt, preset: { name: "Lead", kind, model }, select: false }),
      send: sendToLead,
      save: (lead) => saveLead(projectId, lead, opts.base),
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
  await retire(getState().prefs.topLead);
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
      send: sendToLead,
      save: (lead) => void saveTopLead({ ...lead, path: opts.path }),
    },
    DEFAULT_TOP_MODEL,
  );
}

/** The top lead's model field: saved, and sent when it runs. */
export function setTopLeadModel(top: TopLead, model: string) {
  const running = leadState(top, getState().agents) === "running";
  return changeLeadModel(top, model, running, {
    send: sendToLead,
    save: (next) => void saveTopLead({ ...next, path: top.path }),
  });
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
      const stuck = loadStuck();
      const reviews = loadReviews();
      if (seen && seen.agents === s.agents && seen.prs === s.prs && seen.stuck === stuck && seen.reviews === reviews) return;
      seen = { agents: s.agents, prs: s.prs, stuck, reviews };
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
    // Stuck flags and reviews are kept outside the store: look now and then.
    const timer = setInterval(tick, 5_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
}
