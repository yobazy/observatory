// Runs parking (park.ts): once the app has connected, then every 10 minutes,
// it looks for threads idle past the park threshold. Off unless `parkOn`.
// The first time, what's due waits in a list for you to confirm (ParkConfirm);
// after that OK, due threads park on their own and the sidebar says so with
// Undo. No model call: the brief comes from the transcript as it stands.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview, request } from "./client";
import { flash, getState, projectOfWorktree, subscribe, type State } from "./store";
import { savePrefs } from "./theme";
import { allBatches } from "./batch";
import { allCards } from "./cards";
import { leadIds } from "./lead";
import { loadTriage } from "./triage";
import { addIdeas, deleteIdeas, markStarted } from "./ideas";
import type { Transcript } from "./transcript";
import type { Idea } from "./ideaList";
import type { Agent } from "./types";
import {
  parkMs,
  parkThreads,
  parkedLine,
  resumeParked,
  toPark,
  undoPark,
  unsettledAgents,
  type ParkDeps,
  type Parked,
  type ParkThread,
} from "./park";

const EVERY = 10 * 60_000;
/** The store's prefs before desktop.json has been read. */
const unloaded = getState().prefs;

export interface ParkStatus {
  /** Due threads waiting for the first OK. */
  confirm: ParkThread[] | null;
  /** The last park, for the sidebar's line and its Undo. */
  last: Parked | null;
  busy: boolean;
}
let status: ParkStatus = { confirm: null, last: null, busy: false };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<ParkStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}
export function useParkStatus(): ParkStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

/** "Not now" on the first list: asked again next launch, not every pass. */
let declined = false;

const deps: ParkDeps = {
  addIdeas,
  deleteIdeas,
  request: (variant, body) => request(variant, body),
};

const readable = (a: Agent) => !!a.session_id && (a.kind === "claude" || a.kind === "codex");

async function entries(a: Agent): Promise<Transcript["entries"] | null> {
  if (!readable(a)) return null;
  try {
    if (isPreview()) return (await import("./mock")).mockTranscript(getState(), a.id)?.entries ?? null;
    return (await invoke<Transcript | null>("thread_transcript", { session: a.session_id, from: null, kind: a.kind }))?.entries ?? null;
  } catch {
    return null;
  }
}

/** Due sessions, by the store as it is now. */
function due(s: State): Agent[] {
  const pinned = new Set(Object.values(s.prefs.pinnedTasks ?? {}).flat());
  const queued = (id: string) => s.queue[id]?.length ?? 0;
  return toPark(Object.values(s.agents), Date.now(), parkMs(s.prefs.parkDays), {
    pinned,
    inBatch: unsettledAgents(allBatches(), s.agents, queued),
    held: new Set(Object.keys(s.limits).filter((id) => s.limits[id])),
    leads: leadIds(allCards()),
    kept: s.prefs.parkKeep,
  });
}

async function thread(a: Agent): Promise<ParkThread> {
  const s = getState();
  const wt = s.worktrees[a.worktree_id];
  const project = projectOfWorktree(s, a.worktree_id);
  return {
    id: a.id,
    thread: a.name,
    project: project?.name ?? "its project",
    repo: project?.repo_path ?? null,
    branch: wt?.branch ?? "?",
    path: wt?.path ?? project?.repo_path ?? "",
    prompts: a.recent_prompts.map((p) => p.text),
    entries: await entries(a),
    status_changed_at: a.status_changed_at,
    unseen: a.unseen,
    label: loadTriage()[a.id]?.label,
  };
}

/** Keep these out of parking until they change again. */
async function keep(ids: string[]) {
  const s = getState();
  const kept = { ...s.prefs.parkKeep };
  for (const id of ids) {
    const a = s.agents[id];
    if (a) kept[id] = a.status_changed_at;
  }
  await savePrefs({ ...getState().prefs, parkKeep: kept }).catch(() => {});
}

async function park(threads: ParkThread[]) {
  const done = await parkThreads(threads, deps);
  if (done.items.length) setStatus({ last: done });
  if (done.failed.length) flash(`Couldn't park ${done.failed.length}: ${done.failed.slice(0, 2).join("; ")}`, 6000);
  else if (done.items.length) flash(`${parkedLine(done)} in Ideas. Undo is in the sidebar.`, 5000);
}

let running = false;

async function pass() {
  const s = getState();
  if (running || !ready(s)) return;
  const agents = due(s);
  if (!agents.length) return;
  if (!s.prefs.parkConfirmed && (declined || status.confirm)) return;
  running = true;
  setStatus({ busy: true });
  try {
    const threads: ParkThread[] = [];
    for (const a of agents) threads.push(await thread(a));
    // Read again: something may have moved while the briefs were written.
    const still = new Set(due(getState()).map((a) => a.id));
    const go = threads.filter((t) => still.has(t.id));
    if (!go.length) return;
    if (!getState().prefs.parkConfirmed) setStatus({ confirm: go });
    else await park(go);
  } finally {
    running = false;
    setStatus({ busy: false });
  }
}

/** The first list, OK'd: the ticked ones park, the unticked are kept out,
 *  and from now on due threads park on their own. */
export async function confirmPark(ticked: Set<string>) {
  const list = status.confirm ?? [];
  setStatus({ confirm: null });
  await keep(list.filter((t) => !ticked.has(t.id)).map((t) => t.id));
  await savePrefs({ ...getState().prefs, parkConfirmed: true });
  await park(list.filter((t) => ticked.has(t.id)));
}

export function declinePark() {
  declined = true;
  setStatus({ confirm: null });
}

/** Undo the last park: every thread from it back, its idea gone. */
export async function undoLastPark() {
  const last = status.last;
  if (!last) return;
  setStatus({ last: null });
  const { restored, errors } = await undoPark(last, deps);
  await keep(restored);
  flash(errors.length ? `Brought back ${restored.length}; ${errors.join("; ")}` : `Brought back ${restored.length} thread${restored.length === 1 ? "" : "s"}`, 5000);
}

export function dismissParked() {
  setStatus({ last: null });
}

/** Resume from Ideas: the thread unarchived and opened. */
export async function resumeIdea(idea: Idea) {
  try {
    const id = await resumeParked(idea, { request: deps.request, markStarted });
    await keep([id]);
    return id;
  } catch (e) {
    flash(`Couldn't resume it: ${e instanceof Error ? e.message : e}`, 6000);
    return null;
  }
}

const ready = (s: State) => s.loaded && s.link.state === "connected" && s.prefs !== unloaded && s.prefs.parkOn === true;

/** Mount once. */
export function useParkRunner() {
  useEffect(() => {
    let was = false;
    const off = subscribe(() => {
      const now = ready(getState());
      if (now && !was) void pass();
      was = now;
    });
    const timer = setInterval(() => void pass(), EVERY);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
}
