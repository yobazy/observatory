// What an agent's terminal shows right now, without attaching to it: the
// end of its output (TailOutput) played into an off-screen xterm, so cursor
// moves and redraws land where they would on screen, then read back as
// plain lines. From those, a question with numbered choices — a permission
// prompt — can be answered from outside the terminal.
import { Terminal } from "@xterm/xterm";
import { promptAnswered, sendInput, tailOutput } from "./client";
import type { Agent, SessionRef } from "./types";
import { findQuestion, type Choice, type Question } from "./question";

export { findQuestion, lastRows, looksLikePicker, type Choice, type Question } from "./question";

/** The grid each agent's PTY was last sized to by this app, and the main
 *  terminal's for ones it never sized: the CLI draws (and redraws, by
 *  relative cursor moves) for that width, so replaying at another one
 *  garbles the screen. */
const sizes = new Map<string, { cols: number; rows: number }>();
let lastSize = { cols: 100, rows: 40 };

export function noteSize(agentId: string, cols: number, rows: number) {
  sizes.set(agentId, { cols, rows });
  lastSize = { cols, rows };
}

/** The last rows of the agent's screen, trimmed; null when it has no live
 *  terminal to read. */
export async function readScreen(agent: Agent, maxBytes = 48_000): Promise<string[] | null> {
  if (!agent.alive) return null;
  const tail = await tailOutput({ Agent: agent.id }, maxBytes, null);
  if (!tail) return null;
  const { cols, rows } = sizes.get(agent.id) ?? lastSize;
  const term = new Terminal({ cols, rows, scrollback: 200, allowProposedApi: true });
  try {
    await new Promise<void>((r) => term.write(tail.data, r));
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.slice(-rows);
  } finally {
    term.dispose();
  }
}

/** Pick a choice by its number, as pressing the key in the terminal does —
 *  after checking the same question is still on screen, since the agent
 *  may have moved on (or you answered in the terminal) since it was read. */
export async function answer(agent: Agent, q: Question, choice: Choice): Promise<void> {
  const lines = await readScreen(agent);
  const now = lines && findQuestion(lines);
  const same =
    now && now.prompt === q.prompt && now.choices.some((c) => c.key === choice.key && c.label === choice.label);
  if (!same) throw new Error(`${agent.name} isn't asking that any more`);
  await sendChoice({ Agent: agent.id }, choice);
  promptAnswered(agent);
}

/** Type what picks a choice: its key, or its arrow keys and Enter one at a
 *  time, so the CLI reads each as its own press. */
export async function sendChoice(ref: SessionRef, choice: Choice): Promise<void> {
  if (!choice.keys) return sendInput(ref, choice.key);
  for (const [n, k] of choice.keys.entries()) {
    if (n) await new Promise((r) => setTimeout(r, 60));
    await sendInput(ref, k);
  }
}
