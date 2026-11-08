// What you might send next, offered under a thread's latest reply in the
// Read view: your last message and the reply go to the user's agent CLI,
// headless (`suggestCommand`, router.rs), and it answers with a few short
// prompts. This module builds that prompt and reads the answer; Reader.tsx
// asks once per reply and keeps what came back. Pure, so its tests run under
// Node. Value imports name their .ts files for the same reason.
import { extractJson } from "./router.ts";

/** Whether a reply is worth suggesting for: you hadn't seen it when you
 *  opened the thread, or the agent worked while you had it open. Opening an
 *  old thread just to read it costs nothing. */
export function freshReply(unseenAtOpen: boolean, workedSinceOpen: boolean): boolean {
  return unseenAtOpen || workedSinceOpen;
}

/** How many suggestions show, and how long one may be. */
export const MAX_PROMPTS = 3;
export const MAX_PROMPT_LENGTH = 140;
/** How much of the reply, and of your message, goes in: their ends, where
 *  the open questions and the ask usually are. */
const MAX_REPLY = 6000;
const MAX_YOURS = 1200;

/** The command to run, or null when suggestions are off. Off until you turn
 *  them on in Settings, since each one is a model call; then an unset
 *  command is a cheap model. */
export const DEFAULT_SUGGEST = "claude -p --model haiku --no-session-persistence";
export function suggestCommand(on: boolean | undefined, pref: string | undefined): string | null {
  if (!on) return null;
  const c = pref?.trim();
  if (!c) return DEFAULT_SUGGEST;
  return c.toLowerCase() === "off" ? null : c;
}

const end = (text: string, max: number) => (text.length > max ? `…${text.slice(-max)}` : text);

export function buildSuggestPrompt(you: string, reply: string): string {
  return [
    "You suggest what a developer might type next to a coding agent, after reading its latest reply.",
    "Give up to 3 short prompts, each something they would plausibly send as-is: answer an open",
    "question, take the obvious next step, or ask for something the reply left out. Write them in",
    "the developer's voice, plain and brief (under 15 words), with no numbering or quotes. Skip",
    "anything the reply already did. When there's no sensible next step, give an empty list.",
    "",
    'Answer with JSON only: {"prompts": ["...", "..."]}',
    "",
    "The developer's last message:",
    "<<<",
    end(you.trim(), MAX_YOURS) || "(none)",
    ">>>",
    "",
    "The agent's reply:",
    "<<<",
    end(reply.trim(), MAX_REPLY),
    ">>>",
  ].join("\n");
}

/** The prompts in the CLI's answer: strings only, trimmed, unquoted, no
 *  repeats, at most MAX_PROMPTS. Null when there's no JSON to read. */
export function readSuggestions(text: string): string[] | null {
  const json = extractJson(text);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { prompts?: unknown })?.prompts;
  if (!Array.isArray(list)) return null;
  const out: string[] = [];
  for (const p of list) {
    if (typeof p !== "string") continue;
    const s = p
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(\d+[.)]|[-*•])\s+/, "")
      .replace(/^["“'](.*)["”']$/, "$1")
      .trim();
    if (!s || s.length > MAX_PROMPT_LENGTH) continue;
    if (out.some((o) => o.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length === MAX_PROMPTS) break;
  }
  return out;
}

/** What the preview's mock CLI answers. */
export function previewSuggestions(): string {
  return JSON.stringify({ prompts: ["Open a PR for it", "Run the sandbox checks first", "What's left to do?"] });
}
