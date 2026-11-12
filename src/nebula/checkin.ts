// Check-ins: while a finished thread's last reply says work is still running
// somewhere ("🟠 Keep open: round 3 is running on `pc`"), the app asks it for
// a fresh status card every half hour, so you don't have to type "status".
// Pure helpers, so their tests run under Node; checkinRunner.ts sends them.
import type { Chip } from "./replycard";

export const CHECK_IN_EVERY_MS = 30 * 60 * 1000;
/** A job that never ends shouldn't be asked about forever: 12 hours' worth. */
export const MAX_CHECK_INS = 24;
/** A thread that said "running" longer ago than this, without you turning
 *  check-ins on for it, is left alone: its job is long over or forgotten,
 *  and a launch shouldn't ask every old thread at once. */
export const STALE_MS = 3 * 60 * 60 * 1000;

export const CHECK_IN_PROMPT =
  "Automatic check-in from Observatory, which asks every 30 minutes while your last reply says something is running: " +
  "look at the running work and reply with a short status card (what's finished, what's running now, anything wrong). " +
  "If it has finished, wrap it up as you planned and report the results. " +
  'If nothing is still running, end with a verdict that doesn\'t say "running", so the check-ins stop.';

/** Per thread, kept across launches: `on` or `off` when you chose, how many
 *  check-ins were sent since, and when the last one went. */
export interface CheckIn {
  on?: boolean;
  sent?: number;
  count?: number;
}
export type CheckIns = Record<string, CheckIn>;

/** A verdict that says work is going on elsewhere, which the thread can
 *  report on later: "round 3 is running", "the batch is in progress". */
const RUNNING = /\b(running|in progress|underway|still (going|building|working))\b/i;

export const saysRunning = (verdict: Chip | null | undefined) => verdict?.tone === "wait" && RUNNING.test(verdict.text);

/** Whether the thread is checked in on: a waiting verdict that says
 *  something's running, unless you turned it off, or any waiting verdict
 *  you turned it on for. */
export function watching(verdict: Chip | null | undefined, c: CheckIn | undefined): boolean {
  if (verdict?.tone !== "wait") return false;
  return c?.on ?? saysRunning(verdict);
}

/** When the next check-in goes (ms), or null when none will: half an hour
 *  after the reply landed (`last`, Unix seconds) and after the last one sent. */
export function nextCheckIn(
  verdict: Chip | null | undefined,
  c: CheckIn | undefined,
  last: number | null | undefined,
  now: number,
  every = CHECK_IN_EVERY_MS,
): number | null {
  if (!watching(verdict, c) || last == null || (c?.count ?? 0) >= MAX_CHECK_INS) return null;
  const since = Math.max(last * 1000, c?.sent ?? 0);
  if (c?.on !== true && now - since > STALE_MS) return null;
  return since + every;
}

/** "12m", "1h 5m": how long until `at`. */
export function untilText(at: number, now: number): string {
  const m = Math.max(1, Math.ceil((at - now) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

/** Choices and counts for threads the daemon still has, so the store
 *  doesn't keep every thread ever checked on. */
export function prune(all: CheckIns, alive: (id: string) => boolean): CheckIns {
  return Object.fromEntries(Object.entries(all).filter(([id]) => alive(id)));
}
