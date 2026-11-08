// The order of a branch's threads in the project list. A row moves only
// when you give it a priority or send it a prompt (it goes to the top of its
// priority band). Status changes (working, waiting, done) and opening an
// unseen reply never move it: the dot says those, so the row you're about to
// click stays where it is. Pure, so its tests run under Node.

import { rank } from "./priority.ts";

interface Orderable {
  id: string;
  status_changed_at: number;
  sort_order: number;
  recent_prompts: { submitted_at: number }[];
}

/** When the thread was last given a prompt; one with none yet counts from
 *  its status change (a new thread's is when it was made). */
export function lastPromptedAt(a: Orderable): number {
  let at = -Infinity;
  for (const p of a.recent_prompts) at = Math.max(at, p.submitted_at);
  return at === -Infinity ? a.status_changed_at : at;
}

/** `agents` by priority, then most recently prompted first; ties keep the
 *  daemon's order. `priorities` is by agent id. */
export function threadOrder<T extends Orderable>(agents: T[], priorities?: Record<string, string>): T[] {
  return [...agents].sort(
    (a, b) =>
      rank(priorities?.[a.id]) - rank(priorities?.[b.id]) ||
      lastPromptedAt(b) - lastPromptedAt(a) ||
      a.sort_order - b.sort_order ||
      a.id.localeCompare(b.id),
  );
}
