// A Claude turn can end without the Stop hook nebula listens for: an API
// error the CLI gives up on, say. It's back at its input box, but the daemon
// keeps the row "running" for good, so the thread reads as working and its
// queued prompts wait. These say when its screen and log show it's stopped
// (stallWatch.ts holds it as finished). Kept free of the app so its tests
// run under Node.
import { findQuestion, lastRows, looksLikePicker } from "./question.ts";

/** How long its terminal has to sit still at an idle prompt, and the row
 *  have been running, before it counts as stopped. A working CLI redraws its
 *  spinner every second, so a quiet minute is a long one. */
export const QUIET_MS = 45_000;

/** The CLI is mid-turn: its spinner's hint, or the spinner line itself
 *  ("✻ Thinking… (12s · ↓ 300 tokens)"), which a narrow window can cut the
 *  hint off. */
const BUSY = [/esc to interrupt|ctrl\+c to (stop|cancel)/i, /^\s*[·✢✳✶✻✽*]\s+\S[^…]*…/];

/** Its screen shows it waiting at its input box: no spinner, and no menu or
 *  question (that's waiting on you, which the daemon reports itself). */
export function screenIdle(lines: string[]): boolean {
  const rows = lastRows(lines, 12);
  if (rows.some((l) => BUSY.some((re) => re.test(l)))) return false;
  return !looksLikePicker(lines) && !findQuestion(lines);
}

/** Running by the daemon, yet stopped: quiet at an idle prompt since
 *  `idleSince`, and its log ends on a turn that never finished (`hasLog`,
 *  and no turn ending since it went running). A turn that did end, with
 *  subagents still out, is held at running on purpose (heldAtPrompt). */
export function stalled(
  a: { status: string; status_changed_at: number },
  idleSince: number | null,
  log: { turnEndedAt?: number | null } | null,
  now = Date.now(),
): boolean {
  if (a.status !== "running" || idleSince === null || !log) return false;
  if (now - idleSince < QUIET_MS || now - a.status_changed_at < QUIET_MS) return false;
  return !((log.turnEndedAt ?? 0) > a.status_changed_at);
}
