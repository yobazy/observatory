// The shell command in a reply's code block, when it holds one, as a single
// line an agent can run: Run sends it to the agent as "! <command>", Claude
// Code's way to run a command itself, so its output lands in the thread.
// Pure, so its tests run under Node.
import type { Entry, TStep } from "./transcript";

const SHELL = new Set(["bash", "sh", "shell", "zsh", "console"]);

/** The block's command on one line, or null when it isn't one. `lang` is
 *  the fence's language ("" when it has none). An untagged block counts
 *  when its first line starts with something command-shaped. */
export function commandIn(lang: string, text: string): string | null {
  if (lang && !SHELL.has(lang.toLowerCase())) return null;
  const lines: string[] = [];
  let carry = "";
  for (const raw of text.replace(/\s*\\\n\s*/g, " ").split("\n")) {
    const line = raw.trim().replace(/^\$\s+/, "");
    if (!line || line.startsWith("#")) continue;
    // A line ending in && or | goes on with the next.
    if (/(&&|\|\||\|)$/.test(line)) {
      carry += `${line} `;
      continue;
    }
    lines.push(carry + line);
    carry = "";
  }
  if (carry) lines.push(carry.trim());
  if (!lines.length) return null;
  if (!lang && !/^(sudo\s+)?([a-z][\w.-]*|\.{0,2}\/\S+|~\/\S+)(\s|$)/.test(lines[0])) return null;
  return lines.join(" && ");
}

/** A command an agent was told to run itself, as "! cmd". */
export interface ShellRun {
  command: string;
  at: number;
}

const sameCommand = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** The command in a prompt of the form "! cmd", or null. */
export function commandOf(text: string): string | null {
  const m = /^!\s*([\s\S]+)$/.exec(text.trim());
  return m ? m[1] : null;
}

/** The command to show as running for a prompt to a thread of `kind`. Only
 *  Claude Code logs "! cmd" as a step, and that step is what ends a run. */
export function trackedCommand(kind: string, text: string): string | null {
  return kind === "claude" ? commandOf(text) : null;
}

export function isRun(run: ShellRun, command: string): boolean {
  return sameCommand(run.command, command);
}

/** `run`'s step in the thread, once it has stopped or gone to the background
 *  (`ok` unknown, but it printed). The log's times are whole seconds. */
export function stepOf(run: ShellRun, entries: Entry[]): TStep | null {
  const since = Math.floor(run.at / 1000);
  for (const e of entries) {
    if (e.kind !== "steps" || e.at < since) continue;
    const step = e.steps.find((s) => s.tool === "Bash" && isRun(run, s.target) && (s.ok !== null || s.detail));
    if (step) return step;
  }
  return null;
}
