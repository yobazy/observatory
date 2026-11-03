// Which moment tasks are done with, so their threads and worktree can go
// without a click. A task started from a marked moment (moments.ts) works on
// its own `moment-…` branch, opens a PR and spawns a reviewer beside itself
// that merges it; once that PR has merged at the commit checked out and
// every thread there has stopped, nothing in the worktree is left to lose.
// Pure, so its tests run under Node; prs.ts acts on it.
import type { State } from "./store";

/** What `cleanable` reads of the app's state. */
export type CleanState = Pick<State, "loaded" | "worktrees" | "agents" | "selectedSession" | "git" | "prs">;

/** How long a thread has stopped before its worktree goes, so its last reply
 *  can still be read as it lands. */
export const GRACE_MS = 60_000;

const STOPPED = new Set(["finished", "terminated", "disconnected"]);

/** Moment worktrees whose PR merged at the commit checked out, with nothing
 *  uncommitted, every thread stopped a minute or more, and none of them the
 *  one open in front of you (`watching`). */
export function cleanable(s: CleanState, now: number, watching: boolean): string[] {
  if (!s.loaded) return [];
  const open = s.selectedSession && "Agent" in s.selectedSession ? s.agents[s.selectedSession.Agent] : undefined;
  return Object.values(s.worktrees)
    .filter((wt) => {
      if (wt.is_main || !wt.branch.startsWith("moment-")) return false;
      const p = s.prs[wt.id];
      const g = s.git[wt.id];
      if (p?.kind !== "found" || p.pr.state !== "merged" || !g || "error" in g) return false;
      if (!g.head || g.head !== p.pr.headOid) return false;
      if (g.staged + g.unstaged + g.untracked + g.conflicted > 0) return false;
      if (watching && open?.worktree_id === wt.id) return false;
      const threads = Object.values(s.agents).filter((a) => a.worktree_id === wt.id);
      return threads.every((a) => a.archived || (STOPPED.has(a.status) && now - a.status_changed_at >= GRACE_MS));
    })
    .map((wt) => wt.id);
}
