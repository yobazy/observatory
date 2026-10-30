// What you're typing to each agent in the Read view's reply box: kept when
// the reader remounts for a new session (/clear, resume), and added to from
// outside it (a file sent from the Files list). Pure, so its tests run under
// Node.

const drafts = new Map<string, string>();
const listeners = new Set<(agentId: string) => void>();

export function draftFor(agentId: string): string {
  return drafts.get(agentId) ?? "";
}

/** The reply box's own edits: nobody else needs telling. */
export function keepDraft(agentId: string, text: string) {
  if (text) drafts.set(agentId, text);
  else drafts.delete(agentId);
}

/** Add `text` to `agentId`'s draft from outside the box, which picks it up. */
export function addToDraft(agentId: string, text: string) {
  keepDraft(agentId, withPath(draftFor(agentId), text));
  listeners.forEach((l) => l(agentId));
}

/** Called with the agent whose draft changed from outside the box. */
export function onDraftAdded(fn: (agentId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `text` with `path` added at its end, a space between them; unchanged when
 *  the path is in it already. */
export function withPath(text: string, path: string): string {
  if (!text.trim()) return path;
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|\\s)${esc}(?=\\s|$)`).test(text)) return text;
  return /\s$/.test(text) ? `${text}${path}` : `${text} ${path}`;
}

export type FileTarget = "draft" | "queue" | "terminal" | "nowhere";

/** Where a file sent to an agent goes. The reply box, when the Read view is
 *  up; else the last queued prompt, when one waits; else the agent's own
 *  prompt line in its terminal. An agent asleep gets it in the reply box,
 *  since typing into its terminal would mean waking it, and so does one
 *  waiting on you: its terminal is showing a question or a menu, which a
 *  paste could answer. Without a log to read there's no reply box, so
 *  neither gets it: "nowhere", and the sender says why. */
export function fileTarget(on: {
  reading: boolean;
  queued: number;
  alive: boolean;
  waiting: boolean;
  canRead: boolean;
}): FileTarget {
  if (on.reading) return "draft";
  if (on.queued > 0) return "queue";
  if (on.alive && !on.waiting) return "terminal";
  return on.canRead ? "draft" : "nowhere";
}
