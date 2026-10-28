// Which threads the Live strip (LiveStrip.tsx) shows, in its order.
import type { Agent } from "./types";

/** What needs you first, then what's working, then finished turns you
 *  haven't read; the newest first within each. */
export function liveThreads(agents: Agent[]): Agent[] {
  const rank = (a: Agent) =>
    a.status === "needs_feedback" ? 0 : a.status === "running" ? 1 : a.status === "finished" && a.unseen ? 2 : -1;
  return agents
    .filter((a) => !a.archived && rank(a) >= 0)
    .sort((a, b) => rank(a) - rank(b) || b.status_changed_at - a.status_changed_at);
}
