// A thread as a conversation (transcript.rs), for the reader view: the
// entries, kept in step as the thread grows, and a run of tool calls said
// in one line. Kept free of the app so its tests run under plain Node.

export interface TStep {
  tool: string;
  target: string;
  ok: boolean | null;
}

export interface Entry {
  /** Its place in the thread, from 0. */
  n: number;
  kind: "you" | "claude" | "steps" | "stopped";
  text: string;
  /** Unix seconds. */
  at: number;
  steps: TStep[];
}

export interface Transcript {
  entries: Entry[];
  dropped: number;
}

/** `prev` brought up to date with `next`, which starts at some entry `prev`
 *  may already hold (the last one, whose steps can still gain results). */
export function merge(prev: Entry[], next: Entry[], dropped: number): Entry[] {
  if (!next.length) return prev.filter((e) => e.n >= dropped);
  const from = next[0].n;
  return [...prev.filter((e) => e.n >= dropped && e.n < from), ...next];
}

const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const LOOKS = new Set(["Read", "Grep", "Glob", "LS"]);

const base = (p: string) => p.split("/").pop() || p;

/** "Read 3 files, edited sync.ts, ran 2 commands (1 failed)". */
export function stepsLine(steps: TStep[]): string {
  const edited = [...new Set(steps.filter((s) => EDITS.has(s.tool)).map((s) => base(s.target)))];
  const looked = steps.filter((s) => LOOKS.has(s.tool)).length;
  const commands = steps.filter((s) => s.tool === "Bash");
  const failed = commands.filter((s) => s.ok === false).length;
  const web = steps.filter((s) => s.tool === "WebFetch" || s.tool === "WebSearch").length;
  const subagents = steps.filter((s) => s.tool === "Agent" || s.tool === "Task").length;
  const counted = edited.length ? steps.filter((s) => EDITS.has(s.tool)).length : 0;
  const other = steps.length - counted - looked - commands.length - web - subagents;
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  if (looked) parts.push(`read ${n(looked, "file")}`);
  if (edited.length) parts.push(`edited ${edited.length <= 2 ? edited.join(" and ") : n(edited.length, "file")}`);
  if (commands.length)
    parts.push(commands.length === 1 ? `ran ${commands[0].target.split("\n")[0]}` : `ran ${n(commands.length, "command")}`);
  if (failed) parts.push(`${failed} failed`);
  if (web) parts.push("searched the web");
  if (subagents) parts.push(`sent ${n(subagents, "subagent")}`);
  if (other) parts.push(`used ${n(other, parts.length ? "other tool" : "tool")}`);
  const line = parts.join(", ");
  return line ? line[0].toUpperCase() + line.slice(1) : "Worked";
}
