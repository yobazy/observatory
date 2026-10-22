import { getState, setState, subscribe, type State } from "./store.ts";
import type { Agent } from "./types";

const KEY = "observatory.recentThreads";
const MAX = 20;

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

let recent: string[] = load();

/** `ids` with `id` moved to the front, at most MAX long. */
export function visit(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, MAX);
}

/** Threads you've opened, most recent first: not the open one, nor any
 *  archived or gone since. */
export function recentThreads(s: State, ids: string[] = recent): Agent[] {
  const sel = s.selectedSession;
  const open = sel && "Agent" in sel ? sel.Agent : null;
  return ids
    .filter((id) => id !== open)
    .map((id) => s.agents[id])
    .filter((a): a is Agent => !!a && !a.archived);
}

/** The selection once the open thread or shell closes: the thread you had
 *  open before it, else nothing. */
export function afterClosing(s: State, ids: string[] = recent): Partial<State> {
  const back = recentThreads(s, ids)[0];
  if (!back) return { selectedSession: null };
  return {
    selectedProject: s.worktrees[back.worktree_id]?.project_id ?? s.selectedProject,
    selectedSession: { Agent: back.id },
  };
}

/** Remembers each thread as it's opened, from anywhere; returns the unsubscribe. */
export function trackRecent(): () => void {
  let last: string | null = null;
  const note = () => {
    const sel = getState().selectedSession;
    const id = sel && "Agent" in sel ? sel.Agent : null;
    if (!id || id === last) return;
    last = id;
    recent = visit(recent, id);
    try {
      localStorage.setItem(KEY, JSON.stringify(recent));
    } catch {
      // A convenience: the list starts over next launch.
    }
  };
  note();
  return subscribe(note);
}

/** ⌘[: back to the thread you had open before this one. */
export function previousThread() {
  const s = getState();
  if (recentThreads(s).length) setState(afterClosing(s));
}
