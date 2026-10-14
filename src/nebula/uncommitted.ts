// Uncommitted work across every checkout, each file under the thread that
// left it (threadfiles.ts), so a thread that finished and was forgotten
// still shows what it left behind. The sidebar counts from the polled git
// state; the full view reads each dirty checkout's diff and the threads'
// logs when it opens.
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { loadDiff, type DiffFile } from "./diff";
import { changedFiles } from "./git";
import { projectOfWorktree, type State } from "./store";
import { byThread, type Group, type ThreadEdit } from "./threadfiles";
import type { Agent, Project, Worktree } from "./types";

export interface BranchWork {
  worktree: Worktree;
  project: Project | undefined;
  groups: Group<DiffFile>[];
}

/** Dirty checkouts by the polled git state: what the sidebar counts. */
export function dirtyWorktrees(s: State): { worktree: Worktree; files: number }[] {
  return Object.values(s.worktrees).flatMap((worktree) => {
    const g = s.git[worktree.id];
    if (!g || "error" in g) return [];
    const files = changedFiles(g);
    return files > 0 ? [{ worktree, files }] : [];
  });
}

/** The threads whose logs say what they changed: Claude Code, for now. */
function threadsOf(s: State, worktreeId: string): Agent[] {
  return Object.values(s.agents).filter((a) => a.worktree_id === worktreeId && a.kind === "claude" && !!a.session_id);
}

/** Each thread's edits by agent id, read from the logs in one call. */
async function editsByAgent(s: State, agents: Agent[]): Promise<Record<string, ThreadEdit[]>> {
  if (!agents.length) return {};
  const sessions = agents.map((a) => a.session_id!);
  const bySession: Record<string, ThreadEdit[]> = isPreview()
    ? (await import("./mock")).mockThreadEdits(s, sessions)
    : await invoke<Record<string, ThreadEdit[]>>("thread_edits", { sessions });
  return Object.fromEntries(agents.flatMap((a) => (bySession[a.session_id!] ? [[a.id, bySession[a.session_id!]]] : [])));
}

/** Every dirty checkout's files, grouped by thread; checkouts in the
 *  sidebar's project order, the one changed most recently first within. */
export async function loadUncommitted(s: State): Promise<BranchWork[]> {
  const dirty = dirtyWorktrees(s).map((d) => d.worktree);
  const edits = await editsByAgent(s, dirty.flatMap((w) => threadsOf(s, w.id)));
  const work = await Promise.all(
    dirty.map(async (worktree) => {
      const diff = await loadDiff(worktree, "uncommitted");
      const g = s.git[worktree.id];
      const since = g && !("error" in g) ? (g.lastCommit?.time ?? null) : null;
      const mine = Object.fromEntries(threadsOf(s, worktree.id).flatMap((a) => (edits[a.id] ? [[a.id, edits[a.id]]] : [])));
      return { worktree, project: projectOfWorktree(s, worktree.id), groups: byThread(diff.files, worktree.path, mine, since) };
    }),
  );
  return work.filter((w) => w.groups.length > 0);
}

/** What to tell a thread when asked to commit its share of the changes. */
export function commitPrompt(files: string[]): string {
  return (
    `Commit the changes you made in this thread: ${files.join(", ")}. ` +
    "Leave out changes to these files that aren't yours, and anything else uncommitted here. " +
    "Write the commit message from what you did and why."
  );
}
