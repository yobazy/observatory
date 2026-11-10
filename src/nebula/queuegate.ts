// When the queue (queue.ts) may type a thread's next prompt in, worked out
// from what it remembers about its sends. Kept free of the app so its tests,
// and the marked-moment fixtures in tests/fixtures/moments, run under Node.
import { heldAtPrompt } from "./transcript.ts";

/** A fresh agent this young is most likely still booting with a starting
 *  prompt in hand: its CLI isn't reading yet, so it can't take another. */
export const BOOTING_MS = 20_000;
/** Longest a send holds its agent: one whose promise never settles (an
 *  IPC call or timer lost while the window was hidden) mustn't hold the
 *  queue for good. Waking an agent takes up to about 23s of it. */
export const SEND_MS = 45_000;
/** How long typing in a thread's terminal holds its queue. */
export const TYPING_MS = 10_000;
/** A prompt that never started a turn (the CLI swallowed it) mustn't stall
 *  the queue for good: after a minute, idle is idle. */
const SWALLOWED_MS = 60_000;

export interface GateAgent {
  status: string;
  status_changed_at: number;
  alive?: boolean;
  archived?: boolean;
}

/** What the queue remembers about one agent, all in ms. */
export interface Sends {
  /** When a send to it started, while one is under way. */
  sendingSince?: number;
  /** When this app last typed a prompt into it. */
  lastSent?: number;
  /** When you last typed into its terminal. */
  lastTyped?: number;
}

/** Whether an agent can take a prompt right now: done with its turn (or
 *  never started one) and not waiting on you. */
export function isIdle(a: GateAgent, now = Date.now()): boolean {
  if (a.archived) return false;
  // A fresh agent this young is most likely still booting with a prompt.
  return a.status === "finished" || (a.status === "fresh" && now - a.status_changed_at >= BOOTING_MS);
}

/** Whether a send to it is under way. */
export function busy(s: Sends, now = Date.now()): boolean {
  return s.sendingSince !== undefined && now - s.sendingSince < SEND_MS;
}

/** Idle, and idle since the last prompt this app sent it. */
export function readyForNext(a: GateAgent, s: Sends, now = Date.now()): boolean {
  const sent = s.lastSent ?? 0;
  return isIdle(a, now) && !busy(s, now) && (a.status_changed_at > sent || now - sent > SWALLOWED_MS);
}

/** Held at its prompt, and nothing typed in since that hasn't reached the log. */
export function reads(a: GateAgent, turnEndedAt: number | null | undefined, s: Sends, now = Date.now()): boolean {
  return !busy(s, now) && heldAtPrompt(a, turnEndedAt, s.lastSent, now);
}

/** Whether a queued prompt can go now, by hand: it's at its prompt, done
 *  with its turn or held there for its subagents. */
export function canSendQueued(a: GateAgent, turnEndedAt: number | null | undefined, s: Sends, now = Date.now()): boolean {
  return reads(a, turnEndedAt, s, now) || (isIdle(a, now) && !busy(s, now));
}

/** Why the queue's runner holds an agent's next prompt back, or null when
 *  it sends it. An agent asleep (reaped when idle) waits: waking it means
 *  attaching, which would switch the terminal out from under you. Unless
 *  it's the thread on screen: then nothing switches, and you're waiting on
 *  it. */
export function holdNext(a: GateAgent, s: Sends, onScreen: boolean, now = Date.now()): "not ready" | "asleep" | "typing" | null {
  if (!readyForNext(a, s, now)) return "not ready";
  if (!a.alive && !onScreen) return "asleep";
  if (now - (s.lastTyped ?? 0) < TYPING_MS) return "typing";
  return null;
}
