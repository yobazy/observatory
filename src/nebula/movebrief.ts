// Moving a thread to another project: a session belongs to its checkout, so
// it can't follow; a new one starts there with this brief instead — what
// was asked, where it got to, what it changed, and where the old one is.
// Kept free of the app so its tests run under plain Node.

import type { Entry } from "./transcript";

const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** The most asks the brief lists, the latest kept; and how much of the last reply it quotes. */
export const MAX_ASKS = 6;
export const MAX_SAID = 1500;

export interface MoveFrom {
  thread: string;
  project: string;
  branch: string;
  /** The checkout's folder. */
  path: string;
  /** What you asked it, oldest first, when there's no transcript to read. */
  prompts: string[];
  /** Its conversation (transcript.ts), when the app can read one. */
  entries?: Entry[] | null;
}

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function relative(path: string, root: string): string {
  const r = root.replace(/\/+$/, "");
  return r && path.startsWith(`${r}/`) ? path.slice(r.length + 1) : tilde(path);
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** The new thread's first prompt. */
export function moveBrief(from: MoveFrom): string {
  const entries = from.entries ?? [];
  const asked = entries.length ? entries.filter((e) => e.kind === "you").map((e) => e.text) : from.prompts;
  const asks = asked.map((a) => a.trim()).filter(Boolean);
  const lastSaid = [...entries].reverse().find((e) => e.kind === "claude" && e.text.trim())?.text ?? null;
  const files = [
    ...new Set(entries.flatMap((e) => e.steps.filter((s) => EDITS.has(s.tool) && s.target).map((s) => relative(s.target, from.path)))),
  ];

  const parts = [
    `This continues “${from.thread}”, a thread in ${from.project} (branch ${from.branch}, ${tilde(from.path)}), moved here because the work belongs in this project. That thread still has the whole conversation.`,
  ];
  if (asks.length) {
    const shown = asks.slice(-MAX_ASKS);
    parts.push(
      [
        asks.length > shown.length ? `What was asked there (the last ${shown.length} of ${asks.length}):` : "What was asked there:",
        ...shown.map((a) => `- ${clip(a, 600).replace(/\n+/g, " ")}`),
      ].join("\n"),
    );
  }
  if (lastSaid) parts.push(`Where it got to, in its last words:\n${clip(lastSaid, MAX_SAID).replace(/^/gm, "> ")}`);
  if (files.length) parts.push(`Files it changed there:\n${files.map((f) => `- ${f}`).join("\n")}`);
  parts.push("Pick up from there, in this project.");
  return parts.join("\n\n");
}
