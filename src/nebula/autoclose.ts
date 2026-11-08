// Which finished threads can be closed without a click: those whose last
// reply said "✅ Safe to close" and that have sat finished a day since, with
// nothing said to them after it. Anything that hints you mean to come back
// (pinned, flagged to follow up, a draft or a queued prompt, open in front of
// you) keeps it. Pure, so its tests run under Node; autocloseRunner.ts acts
// on it.
import type { State } from "./store";
import type { Tone } from "./replycard";
import type { Agent } from "./types";

/** What `closable` reads of the app's state. */
export type CloseState = Pick<State, "loaded" | "agents" | "selectedSession" | "queue" | "prefs">;

/** How long a thread sits finished before it's closed on its own. */
export const CLOSE_AFTER_MS = 24 * 60 * 60 * 1000;

/** A thread's latest turn, as far as closing goes: the verdict its reply
 *  ended on, and when that reply landed (Unix seconds). */
export interface Reading {
  tone: Tone | null;
  last: number;
}

/** Whether a thread is the kind whose log the app reads, at rest long
 *  enough, and not kept for any reason the verdict can't see. The cheap
 *  part, checked before any log is read. */
export function mayClose(s: CloseState, a: Agent, now: number, after = CLOSE_AFTER_MS, hasDraft: (id: string) => boolean = () => false): boolean {
  if (a.archived || a.status !== "finished" || !a.session_id) return false;
  if (a.kind !== "claude" && a.kind !== "codex") return false;
  if (now - a.status_changed_at < after) return false;
  const sel = s.selectedSession;
  if (sel && "Agent" in sel && sel.Agent === a.id) return false;
  if (s.prefs.pinnedTasks?.[a.worktree_id]?.includes(a.id)) return false;
  // A flag you set yourself; the app's own (autoFollowUps) don't count.
  if (s.prefs.followUps?.[a.id] && !s.prefs.autoFollowUps?.[a.id]) return false;
  if (s.queue[a.id]?.length) return false;
  if (hasDraft(a.id)) return false;
  return true;
}

/** Threads to read the latest turn of, before deciding. */
export function candidates(s: CloseState, now: number, after = CLOSE_AFTER_MS, hasDraft?: (id: string) => boolean): Agent[] {
  if (!s.loaded || s.prefs.autoCloseSafe === false) return [];
  return Object.values(s.agents).filter((a) => mayClose(s, a, now, after, hasDraft));
}

/** Whether a read turn lets the thread go: it ended on ✅, and no prompt
 *  went in after that reply. */
export function readingAllows(a: Agent, r: Reading | null | undefined): boolean {
  if (!r || r.tone !== "done") return false;
  // The log keeps whole seconds; a prompt in that same second is the turn's own.
  const replied = (r.last + 1) * 1000;
  return !a.recent_prompts.some((p) => p.submitted_at > replied);
}

/** The threads to close now, given what each one's latest turn said. */
export function closable(
  s: CloseState,
  now: number,
  readings: (a: Agent) => Reading | null | undefined,
  after = CLOSE_AFTER_MS,
  hasDraft?: (id: string) => boolean,
): string[] {
  return candidates(s, now, after, hasDraft)
    .filter((a) => readingAllows(a, readings(a)))
    .map((a) => a.id);
}
