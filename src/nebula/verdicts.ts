// Whether each thread can be closed, from the line its last reply ends with
// ("✅ Safe to close", "🟠 Keep open: …", "🔴 Don't close: …"). Read from the
// log's latest turn once per status change, and only for threads at rest.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview, request } from "./client";
import { flash, getState, setState } from "./store";
import { afterClosing } from "./recentThreads";
import { readVerdict, type Chip } from "./replycard";
import type { Turn } from "./turnsummary";
import { noteTurnNumber } from "./turnCount";
import { sameSession, type Agent } from "./types";

const known = new Map<string, { key: string; verdict: Chip | null; last: number | null }>();
const listeners = new Set<() => void>();
let version = 0;
// One log read at a time: a sidebar full of threads shouldn't read them all at once.
let line: Promise<unknown> = Promise.resolve();
const queued = new Set<string>();

const keyOf = (a: Agent) => `${a.session_id}:${a.status}:${a.status_changed_at}`;

/** Only a finished thread whose log the app reads can say it's done. */
const readable = (a: Agent) => !a.archived && a.status === "finished" && !!a.session_id && (a.kind === "claude" || a.kind === "codex");

function set(agent: Agent, verdict: Chip | null, last: number | null = null) {
  known.set(agent.id, { key: keyOf(agent), verdict, last });
  version++;
  listeners.forEach((l) => l());
}

/** A turn already read elsewhere (the turn strip) counts too. */
export function noteTurn(agent: Agent, turn: Turn | null) {
  noteTurnNumber(agent.id, turn?.number);
  if (readable(agent) && turn) set(agent, readVerdict(turn.saidEnd ?? turn.said ?? ""), turn.last);
}

/** The thread's verdict, if it's at rest and its last reply gave one. */
export function verdictOf(agent: Agent): Chip | null {
  const got = known.get(agent.id);
  return readable(agent) && got?.key === keyOf(agent) ? got.verdict : null;
}

/** The verdict and when its reply landed (Unix seconds), once read for the
 *  thread as it is now; undefined until then. */
export function readingOf(agent: Agent): { verdict: Chip | null; last: number | null } | undefined {
  const got = known.get(agent.id);
  return readable(agent) && got?.key === keyOf(agent) ? got : undefined;
}

/** Read the thread's latest turn if it hasn't been yet, in line with the
 *  rest; resolves once it's been read (or found unreadable). */
export function readTurn(agent: Agent): Promise<unknown> {
  check(agent);
  return line;
}

function check(agent: Agent) {
  if (!readable(agent) || known.get(agent.id)?.key === keyOf(agent) || queued.has(agent.id)) return;
  queued.add(agent.id);
  line = line.then(async () => {
    const now = getState().agents[agent.id] ?? agent;
    try {
      if (!readable(now) || known.get(now.id)?.key === keyOf(now)) return;
      const turn = isPreview()
        ? (await import("./mock")).mockTurn(getState(), now.id)
        : await invoke<Turn | null>("thread_turn", { session: now.session_id, kind: now.kind });
      noteTurnNumber(now.id, turn?.number);
      set(now, turn ? readVerdict(turn.saidEnd ?? turn.said ?? "") : null, turn?.last ?? null);
    } catch {
      set(now, null);
    } finally {
      queued.delete(agent.id);
    }
  });
}

function useVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/** The thread's verdict, read when it comes to rest. */
export function useVerdict(agent: Agent | undefined): Chip | null {
  useVersion();
  const key = agent ? keyOf(agent) : "";
  useEffect(() => {
    if (agent) check(agent);
  }, [agent?.id, key]);
  return agent ? verdictOf(agent) : null;
}

/** Close a thread its reply said was done: archive it, move on from it, and
 *  offer Undo instead of asking first. */
export function closeThread(agent: Agent) {
  void request("ArchiveAgent", { id: agent.id });
  if (sameSession(getState().selectedSession, { Agent: agent.id })) setState(afterClosing);
  flash(`Closed ${agent.name}`, 6000, { label: "Undo", run: () => void request("UnarchiveAgent", { id: agent.id }) });
}
