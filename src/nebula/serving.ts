// Where an agent's dev server is: the local address an agent printed while
// starting one itself (`npm run dev` from its own shell, not the band's
// Start), read off its output the way runs.ts reads a run terminal's, and
// whether anything still answers there. Shown on the task's row and above
// its terminal (store `agentUrls`), so it's a click away instead of a scroll
// back through the chat.
// The watching is in runs.ts; this is kept free of the app so its tests run
// under plain Node.
import { ANSI } from "./pathtext.ts";
import type { State } from "./store.ts";

export type AgentUrl = { url: string; live: boolean };

/** A local address, with its scheme or, in an agent's prose ("it's up on
 *  localhost:5173"), without one but with a port. */
const LOCAL_URL =
  /(?<![\w@/.-])(?:https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?|(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5})(?:\/[^\s'"`<>)\]]*)?/g;

const clean = (url: string) => {
  const bare = url.replace(/[.,;:!?]+$/, "").replace("0.0.0.0", "localhost").replace(/\[::1?\]/, "localhost");
  return /^https?:/.test(bare) ? bare : `http://${bare}`;
};

/** A TUI's output as text. Claude Code places words with cursor moves rather
 *  than printing spaces ("at\x1b[32Ghttp://…"), and moves down a row rather
 *  than printing a newline, so those read as a space and a line break before
 *  the rest of the escapes go. */
export function plainText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[\d*(?:;\d*)?[BEHf]/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[\d*[CG]/g, " ")
      .replace(ANSI, "")
  );
}

/** Every local address in `text`, each once, in the order they were last
 *  printed. */
export function localUrls(text: string): string[] {
  const found = (plainText(text).match(LOCAL_URL) ?? []).map(clean);
  return [...new Set(found.reverse())].reverse();
}

/** How many addresses are kept per agent to choose from. */
export const KEEP = 6;

/** `before` with `found` added as the newest, at most KEEP of them. */
export function remember(before: string[], found: string[]): string[] {
  return [...before.filter((u) => !found.includes(u)), ...found].slice(-KEEP);
}

/** What to show for an agent: the newest address it printed that answers.
 *  When none does, the one shown before stays, greyed, since it did answer
 *  once; an address that never answered (an example in the agent's prose,
 *  say) isn't shown at all. */
export function pick(found: string[], up: Set<number>, shown: AgentUrl | undefined): AgentUrl | undefined {
  for (let i = found.length - 1; i >= 0; i--) if (up.has(portOf(found[i]))) return { url: found[i], live: true };
  return shown && { url: shown.url, live: false };
}

/** The port an address is served on. */
export function portOf(url: string): number {
  const u = new URL(url);
  return u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
}

/** The agent's dev server, when it's still answering: what its row shows. */
export function liveUrl(s: State, agentId: string): string | null {
  const at = s.agentUrls[agentId];
  return at?.live ? at.url : null;
}
