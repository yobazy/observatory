// What a thread did in its latest turn, in a few plain words, built from the
// tool calls its log records (turns.rs) rather than from what the agent says
// about itself: "Edited 4 files in src/nebula · Tests passed · Committed".
// The headline keeps the parts that matter most; the details keep the rest.
// Kept free of the app so its tests run under plain Node.

export interface Step {
  tool: string;
  /** What it acted on: a file, a command, a pattern, a URL, a question. */
  target: string;
  /** The call's own note on what it's for (a command's description). */
  note: string | null;
  /** Whether it worked, once its result is in. */
  ok: boolean | null;
  /** Unix seconds. */
  at: number;
}

export interface Turn {
  number: number;
  prompt: string;
  /** Unix seconds. */
  started: number;
  last: number;
  steps: Step[];
  dropped: number;
  said: string | null;
  interrupted: boolean;
}

export type Tone = "good" | "bad" | "ask" | null;

export interface Part {
  text: string;
  tone: Tone;
}

export interface Command {
  command: string;
  note: string | null;
  ok: boolean | null;
}

export interface Summary {
  /** The most telling parts, in order; at most `HEADLINE`. */
  headline: Part[];
  /** Files it changed, relative to the checkout where they're inside it. */
  edited: string[];
  commands: Command[];
  /** Files read and searches made: how much it looked at. */
  looked: number;
  /** A question it's waiting on you to answer. */
  asking: string | null;
}

const HEADLINE = 4;

const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const LOOKS = new Set(["Read", "Grep", "Glob", "LS"]);
const WEB = new Set(["WebFetch", "WebSearch"]);
const SUBAGENTS = new Set(["Agent", "Task"]);

const TESTS =
  /\b((npm|pnpm|yarn|bun)( run)? test|cargo (nextest|test)|pytest|go test|vitest|jest|rspec|mix test|swift test|deno test|make test|node --test)\b/;
const LINTS = /\b((npm|pnpm|yarn|bun) run lint|eslint|cargo fmt --check|ruff|golangci-lint|swiftlint|prettier --check)\b/;
const BUILDS = /\b((npm|pnpm|yarn|bun) run build|cargo (build|clippy|check)|tsc|swift build|go build|xcodebuild)\b/;

/** What a command did that's worth naming on its own, if anything. */
function gitAction(cmd: string): string | null {
  if (/\bgh pr merge\b/.test(cmd)) return "Merged a PR";
  if (/\bgh pr create\b/.test(cmd)) return "Opened a PR";
  if (/\bgit push\b/.test(cmd)) return "Pushed";
  if (/\bgit commit\b/.test(cmd)) return "Committed";
  return null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `path` relative to `root` when it's inside it. */
function relative(path: string, root: string): string {
  const norm = (p: string) => p.replace(/\/+$/, "").replace(/^\/private\//, "/");
  const r = norm(root);
  const p = norm(path);
  return r && p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

/** The folder every one of `paths` sits in, or "" for none in common. */
function commonDir(paths: string[]): string {
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  const first = dirs[0] ?? [];
  let n = first.length;
  for (const d of dirs) {
    let i = 0;
    while (i < n && d[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join("/");
}

function editsPart(edited: string[]): Part | null {
  if (edited.length === 0) return null;
  if (edited.length === 1) return { text: `Edited ${edited[0].split("/").pop()}`, tone: null };
  const dir = commonDir(edited);
  // An absolute common folder (files outside the checkout) says little.
  const where = dir && !dir.startsWith("/") ? ` in ${dir}` : "";
  return { text: `Edited ${edited.length} files${where}`, tone: null };
}

/** Whether the last run of a kind of command (tests, a build) worked. */
function outcome(commands: Command[], kind: RegExp, name: string): Part | null {
  const last = [...commands].reverse().find((c) => kind.test(c.command));
  if (!last) return null;
  if (last.ok === null) return { text: `Running ${name.toLowerCase()}`, tone: null };
  return last.ok ? { text: `${name} passed`, tone: "good" } : { text: `${name} failed`, tone: "bad" };
}

/** Summarize `turn` of a thread whose checkout is at `root`. `waiting` is
 *  whether the thread is waiting on you right now. */
export function summarize(turn: Turn, root: string, waiting = false): Summary {
  const edited: string[] = [];
  const commands: Command[] = [];
  let looked = 0;
  let web = 0;
  let subagents = 0;
  let asking: string | null = null;
  for (const s of turn.steps) {
    if (EDITS.has(s.tool)) {
      const p = relative(s.target, root);
      if (p && !edited.includes(p)) edited.push(p);
    } else if (s.tool === "Bash") commands.push({ command: s.target, note: s.note, ok: s.ok });
    else if (LOOKS.has(s.tool)) looked++;
    else if (WEB.has(s.tool)) web++;
    else if (SUBAGENTS.has(s.tool)) subagents++;
  }
  const lastStep = turn.steps[turn.steps.length - 1];
  if (lastStep?.tool === "AskUserQuestion" && lastStep.ok === null) asking = lastStep.target || "a question";
  else if (waiting && turn.said?.trim().endsWith("?")) asking = turn.said.trim();

  const parts: Part[] = [];
  const add = (p: Part | null) => p && !parts.some((q) => q.text === p.text) && parts.push(p);
  if (asking) add({ text: lastStep?.tool === "AskUserQuestion" ? "Asking you a question" : "Asked you something", tone: "ask" });
  if (turn.interrupted) add({ text: "Stopped by you", tone: null });
  add(outcome(commands, TESTS, "Tests"));
  // A build is worth naming when it broke; passing builds are the norm.
  const build = outcome(commands, BUILDS, "Build");
  if (build?.tone === "bad") add(build);
  const lint = outcome(commands, LINTS, "Lint");
  if (lint?.tone === "bad") add(lint);
  add(editsPart(edited));
  for (const c of commands) {
    const done = c.ok !== false && gitAction(c.command);
    if (done) add({ text: done, tone: null });
  }
  const plain = commands.filter((c) => ![TESTS, BUILDS, LINTS].some((k) => k.test(c.command)) && !gitAction(c.command));
  if (plain.length) {
    const failed = plain.filter((c) => c.ok === false).length;
    add({ text: `Ran ${plural(plain.length, "command")}${failed ? `, ${failed} failed` : ""}`, tone: null });
  }
  if (subagents) add({ text: `Sent ${plural(subagents, "subagent")}`, tone: null });
  if (web) add({ text: "Searched the web", tone: null });
  if (build && parts.length === 0) add(build);
  if (looked && parts.length === 0) add({ text: `Looked through ${plural(looked, "file")}`, tone: null });
  if (parts.length === 0) add({ text: turn.said ? "Replied" : "Thinking", tone: null });
  return { headline: parts.slice(0, HEADLINE), edited, commands, looked, asking };
}

/** "4m", "1h 5m": how long a turn ran. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}
