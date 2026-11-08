// What's sitting unsent on each agent's prompt line: the keys typed into its
// terminal since the last Enter. The Read view takes it into its reply box,
// so a reply sent from there doesn't land on the end of it unseen. Worked
// out from what this app writes to the terminal, so a key that moves the
// cursor or recalls history (arrows, ⌥←, Tab) leaves it unknown, and it's
// left where it is. Pure, so its tests run under Node.

/** The line's text, or null when it can't be told from the keys. */
const lines = new Map<string, string | null>();

const PASTE = /^\x1b\[200~([\s\S]*?)\x1b\[201~/;

/** `line` after `data` was written to the terminal after it. */
export function afterKeys(line: string | null, data: string): string | null {
  let at = line;
  let rest = data;
  while (rest) {
    const paste = PASTE.exec(rest);
    if (paste) {
      if (at !== null) at += paste[1].replace(/\r\n?/g, "\n");
      rest = rest.slice(paste[0].length);
      continue;
    }
    if (rest.startsWith("\x1b\r")) {
      // Shift-Enter: a new line in the same prompt.
      if (at !== null) at += "\n";
      rest = rest.slice(2);
      continue;
    }
    const c = rest[0];
    rest = rest.slice(1);
    if (c === "\r" || c === "\n" || c === "\x03" || c === "\x15") at = "";
    else if (c === "\x7f" || c === "\b") at = at === null ? null : [...at].slice(0, -1).join("");
    else if (c === "\x1b" || c < " ") {
      // An escape sequence or another control key: the cursor may have
      // moved, so what's on the line can't be told from here until an
      // Enter later in this write, or in a later one, empties it.
      const enter = lastEnter(rest);
      return enter < 0 ? null : afterKeys("", rest.slice(enter + 1));
    } else if (at !== null) at += c;
  }
  return at;
}

/** Where the last Enter in `data` is (not a Shift-Enter), or -1. */
function lastEnter(data: string): number {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i] === "\r" && data[i - 1] !== "\x1b") return i;
  }
  return -1;
}

/** What a terminal reports on its own rather than what you type: mouse
 *  moves and clicks (Claude Code turns on any-motion tracking) and focus
 *  in and out. */
const REPORTS = /^(?:\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3}|\x1b\[[IO])+$/;

/** Whether `data` is only the terminal's own reports: no key in it. */
export function isReport(data: string): boolean {
  return REPORTS.test(data);
}

/** Note `data` written to `agentId`'s terminal. */
export function noteKeys(agentId: string, data: string) {
  if (isReport(data)) return;
  const next = afterKeys(lines.has(agentId) ? lines.get(agentId)! : "", data);
  if (next === "") lines.delete(agentId);
  else lines.set(agentId, next);
}

/** Forget `agentId`'s line: it exited, or a question took over its screen. */
export function forgetKeys(agentId: string) {
  lines.delete(agentId);
}

/** What's unsent on `agentId`'s prompt line: "" when nothing, null when
 *  there's something but it can't be told what. */
export function unsentLine(agentId: string): string | null {
  return lines.has(agentId) ? lines.get(agentId)! : "";
}

/** The keys that rub `line` out, from the end where the cursor is. */
export function rubOut(line: string): string {
  return "\x7f".repeat([...line].length);
}
