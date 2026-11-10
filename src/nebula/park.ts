// Parking: a thread that has sat idle for days is filed away as an Idea,
// with a brief of what was asked and where it got to (moveBrief, no model
// call), and its session archived. Nothing is lost: the session keeps its
// whole conversation, Resume unarchives it, and Undo right after a park
// puts every thread from it back. Off unless `parkOn`; the first time,
// what's due is listed for you to confirm. This module picks what's due,
// makes the ideas and runs a park or its undo given its effects;
// parkRunner.ts wires that to the app. Value imports name their .ts files
// so the tests run under plain Node.
import { moveBrief, type MoveFrom } from "./movebrief.ts";
import { batchSummary, type QueuedFor } from "./board.ts";
import type { Batch } from "./batch";
import type { Idea, Priority } from "./ideaList";
import type { TriageLabel } from "./triage";
import type { Agent, AgentStatus } from "./types";

export const DEFAULT_PARK_DAYS = 3;
const DAY = 24 * 3600_000;
export const parkMs = (days: number | undefined) => (days && days > 0 ? days : DEFAULT_PARK_DAYS) * DAY;

/** Statuses a thread can be parked from: its turn is over and it isn't
 *  asking anything. Running, fresh, waiting on you and disconnected (the
 *  link dropped mid-turn, maybe) never are. */
const PARKABLE: AgentStatus[] = ["finished", "terminated"];

/** A session as toPark sees it. */
export interface ParkSession {
  id: string;
  status: AgentStatus;
  /** Its last change (ms). */
  status_changed_at: number;
  archived?: boolean;
}

/** What keeps a thread out whatever its age. */
export interface ParkGuards {
  /** Dragged into place in its list (prefs.pinnedTasks). */
  pinned: Set<string>;
  /** In a Dispatch batch that hasn't settled. */
  inBatch: Set<string>;
  /** Stopped at a usage limit (limits.ts): it's waiting on you. */
  held?: Set<string>;
  /** Unticked at the first confirm, resumed, or brought back by Undo: kept
   *  out while its last change is still the one it had then. */
  kept?: Record<string, number>;
  /** Project leads' threads (lead.ts): long-lived on purpose, never parked. */
  leads?: Set<string>;
}

/** Sessions in a Dispatch batch still on the board that hasn't settled
 *  (board.ts): parking one would pull it out from under the batch. */
export function unsettledAgents(batches: Batch[], agents: Record<string, Agent>, queued: QueuedFor = () => 0, now = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const b of batches) {
    if (b.dismissed || batchSummary(b.tasks, agents, queued, now).settled) continue;
    for (const t of b.tasks) if (t.agentId) out.add(t.agentId);
  }
  return out;
}

/** The threads due to park: open, idle past the threshold, oldest first. */
export function toPark<T extends ParkSession>(sessions: T[], now: number, ms: number, g: ParkGuards): T[] {
  return sessions
    .filter(
      (s) =>
        !s.archived &&
        PARKABLE.includes(s.status) &&
        now - s.status_changed_at > ms &&
        !g.pinned.has(s.id) &&
        !g.inBatch.has(s.id) &&
        !g.held?.has(s.id) &&
        !g.leads?.has(s.id) &&
        g.kept?.[s.id] !== s.status_changed_at,
    )
    .sort((a, b) => a.status_changed_at - b.status_changed_at || a.id.localeCompare(b.id));
}

/** A thread to park, with what its idea and brief are made from. */
export interface ParkThread extends Omit<MoveFrom, "why" | "close"> {
  id: string;
  /** Its project's repo path, the idea's project; null is Unsorted. */
  repo: string | null;
  status_changed_at: number;
  /** Its turn ended and you haven't looked. */
  unseen: boolean;
  /** Its triage label, when it has one (triage.ts). */
  label?: TriageLabel;
}

/** An idea before it has an id. */
export type NewIdea = Omit<Idea, "id" | "createdAt">;

export function idleDays(since: number, now: number): number {
  return Math.max(1, Math.floor((now - since) / DAY));
}

/** The idea a parked thread becomes: its title, its brief, its project, and
 *  high priority when it had work for you to look at. */
export function parkIdea(t: ParkThread, now: number): NewIdea {
  const days = idleDays(t.status_changed_at, now);
  const brief = moveBrief({
    ...t,
    why: `parked in Ideas after ${days} day${days === 1 ? "" : "s"} idle`,
    close: "Pick up from there.",
  });
  const priority: Priority | null = t.label === "review" || t.unseen ? "high" : null;
  return {
    text: t.thread.trim() || "Parked thread",
    project: t.repo,
    source: { kind: "parked", agent: t.id },
    brief,
    ...(priority ? { priority } : {}),
  };
}

/** What a park does to the world, given so it can be tested without it. */
export interface ParkDeps {
  /** Write the ideas down in one save; the ones made, in order, or null. */
  addIdeas: (ideas: NewIdea[]) => Promise<Idea[] | null>;
  deleteIdeas: (ids: string[]) => Promise<boolean>;
  /** A daemon request (client.ts's request). */
  request: (variant: "ArchiveAgent" | "UnarchiveAgent", body: { id: string }) => Promise<unknown>;
}

/** One park, for its Undo: each thread's agent and the idea it became. */
export interface Parked {
  at: number;
  items: { agent: string; idea: string; name: string }[];
  /** Threads that couldn't be archived: their ideas were taken back. */
  failed: string[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Park threads: the ideas are written first, then each session archived.
 *  A session that won't archive keeps going as it was, and its idea is
 *  taken back, so a thread is never in both places or neither. */
export async function parkThreads(threads: ParkThread[], deps: ParkDeps, now = Date.now()): Promise<Parked> {
  const out: Parked = { at: now, items: [], failed: [] };
  if (!threads.length) return out;
  const made = await deps.addIdeas(threads.map((t) => parkIdea(t, now)));
  if (!made || made.length !== threads.length) {
    if (made?.length) await deps.deleteIdeas(made.map((i) => i.id));
    out.failed = threads.map((t) => t.thread);
    return out;
  }
  const undo: string[] = [];
  for (const [n, t] of threads.entries()) {
    try {
      await deps.request("ArchiveAgent", { id: t.id });
      out.items.push({ agent: t.id, idea: made[n].id, name: t.thread });
    } catch (e) {
      undo.push(made[n].id);
      out.failed.push(`${t.thread} (${errText(e)})`);
    }
  }
  if (undo.length) await deps.deleteIdeas(undo);
  return out;
}

/** Undo a park: every thread from it unarchived, and its idea removed. An
 *  idea stays when its thread couldn't be brought back, so it's still
 *  findable. */
export async function undoPark(p: Parked, deps: ParkDeps): Promise<{ restored: string[]; errors: string[] }> {
  const restored: string[] = [];
  const errors: string[] = [];
  const drop: string[] = [];
  for (const it of p.items) {
    try {
      await deps.request("UnarchiveAgent", { id: it.agent });
      restored.push(it.agent);
      drop.push(it.idea);
    } catch (e) {
      errors.push(`${it.name}: ${errText(e)}`);
    }
  }
  if (drop.length) await deps.deleteIdeas(drop);
  return { restored, errors };
}

export function isParked(i: Pick<Idea, "source">): boolean {
  return i.source?.kind === "parked" && !!i.source.agent;
}

/** Resume a parked idea: its session unarchived, and the idea marked
 *  started as that session. Resolves with the agent's id. */
export async function resumeParked(
  idea: Idea,
  deps: Pick<ParkDeps, "request"> & { markStarted: (ids: string[], as: string) => Promise<unknown> },
): Promise<string> {
  const agent = idea.source?.kind === "parked" ? idea.source.agent : undefined;
  if (!agent) throw new Error("This idea isn't a parked thread.");
  await deps.request("UnarchiveAgent", { id: agent });
  await deps.markStarted([idea.id], agent);
  return agent;
}

/** What Start fresh opens the New task box with: the brief, in its project. */
export function freshStart(idea: Idea): { task: string; repo: string | null } {
  return { task: idea.brief?.trim() || idea.text, repo: idea.project };
}

/** The sidebar's line for a park. */
export function parkedLine(p: Parked): string {
  const n = p.items.length;
  return `Parked ${n} idle thread${n === 1 ? "" : "s"}`;
}
