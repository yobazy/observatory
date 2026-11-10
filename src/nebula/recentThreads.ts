import { getState, leadThreads, projectWorktrees, setState, subscribe, worktreeAgents, type State } from "./store.ts";
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
  // A lead is its project's chat (S29), not a thread to go back to.
  const leads = leadThreads(s);
  return ids
    .filter((id) => id !== open && !leads.has(id))
    .map((id) => s.agents[id])
    .filter((a): a is Agent => !!a && !a.archived);
}

/** The selection once the open thread or shell closes: the thread below it
 *  in its project's list (else the one above, else the project's first),
 *  staying in that project; nothing open when it has no other thread. */
export function afterClosing(s: State): Partial<State> {
  const sel = s.selectedSession;
  const open = sel && "Agent" in sel ? s.agents[sel.Agent] : undefined;
  const shell = sel && "Terminal" in sel ? s.terminals[sel.Terminal] : undefined;
  const wtId = open?.worktree_id ?? shell?.worktree_id;
  const projectId = (wtId && s.worktrees[wtId]?.project_id) || s.selectedProject;
  if (!projectId) return { selectedSession: null };
  const list = projectWorktrees(s, projectId).flatMap((w) => worktreeAgents(s, w.id));
  const at = open ? list.findIndex((a) => a.id === open.id) : -1;
  const rest = list.filter((a) => a.id !== open?.id);
  const next = at >= 0 ? (list[at + 1] ?? list[at - 1]) : rest[0];
  return { selectedProject: projectId, selectedSession: next ? { Agent: next.id } : null };
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
  const back = recentThreads(s)[0];
  if (!back) return;
  setState({
    selectedProject: s.worktrees[back.worktree_id]?.project_id ?? s.selectedProject,
    selectedSession: { Agent: back.id },
  });
}
