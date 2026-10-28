// A thread as a conversation (transcript.rs), for the reader view: the
// entries, kept in step as the thread grows, and a run of tool calls said
// in one line. Kept free of the app so its tests run under plain Node.

export interface TStep {
  tool: string;
  target: string;
  ok: boolean | null;
  /** What it changed as diff lines ("- old", "+ new"), or the end of what
   *  it printed when it failed. */
  detail?: string;
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

/** What the step under way is doing, for the reader's working line:
 *  "Editing sync.ts", "Running npm test". */
export function doingLine(s: TStep): string {
  const first = s.target.split("\n")[0].trim();
  if (EDITS.has(s.tool)) return `Editing ${base(s.target)}`;
  if (s.tool === "Read") return `Reading ${base(s.target)}`;
  if (LOOKS.has(s.tool)) return "Looking through files";
  // "cd /long/path && npm test" says what it runs, not where.
  const command = first.replace(/^cd\s+\S+\s*&&\s*/, "");
  if (s.tool === "Bash") return command ? `Running ${command}` : "Running a command";
  if (s.tool === "WebFetch" || s.tool === "WebSearch") return "Searching the web";
  if (s.tool === "Agent" || s.tool === "Task") return "Waiting on a subagent";
  return `Using ${s.tool.replace(/^mcp__.+?__/, "").replace(/_/g, " ")}`;
}

/** What kind of thing the step under way is, for the cat on the working
 *  line to act out. */
export type Act = "edit" | "read" | "run" | "web" | "wait" | "other";

export function actOf(s: TStep): Act {
  if (EDITS.has(s.tool)) return "edit";
  if (LOOKS.has(s.tool)) return "read";
  if (s.tool === "Bash") return "run";
  if (s.tool === "WebFetch" || s.tool === "WebSearch") return "web";
  if (s.tool === "Agent" || s.tool === "Task") return "wait";
  return "other";
}

/** Where `query` occurs in `text`, ignoring case: each start offset. */
export function findAll(text: string, query: string): number[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const out: number[] = [];
  for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + q.length)) out.push(at);
  return out;
}

/** "45s", "1m 20s", "1h 5m": how long the turn under way has run. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
