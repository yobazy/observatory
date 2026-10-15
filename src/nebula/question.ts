// A question with numbered choices at the bottom of an agent's screen — a
// permission prompt — read from the screen's plain lines (screen.ts gets
// them). Kept apart from the reading so it can be tested on its own.

export interface Choice {
  /** What to type to pick it. */
  key: string;
  label: string;
  selected: boolean;
}

export interface Question {
  /** The question's own line(s), above the choices. */
  prompt: string;
  choices: Choice[];
}

/** Box-drawing edges and the marks a picker puts before its current row. */
const EDGE = /^[\s│┃|╭╰╮╯─]+|[\s│┃|╭╰╮╯─]+$/g;
const CHOICE = /^([❯›>▶●]\s*)?(\d{1,2})[.)]\s+(.+)$/;

/** The numbered choices at the bottom of a screen, as Claude Code, Codex and
 *  friends draw a permission prompt: "❯ 1. Yes", "2. No, and tell me…". Only
 *  a run numbered 1, 2, 3… in the last rows counts, so a numbered list in
 *  the agent's prose above doesn't. */
export function findQuestion(lines: string[]): Question | null {
  const rows = lines.map((l) => l.replace(EDGE, ""));
  let end = rows.length - 1;
  // Footer hints ("Esc to cancel · Tab to amend") may sit under the choices.
  let skipped = 0;
  while (end >= 0 && !CHOICE.test(rows[end]) && skipped < 6) {
    end--;
    skipped++;
  }
  if (end < 0 || !CHOICE.test(rows[end])) return null;
  const choices: Choice[] = [];
  // Rows a label wrapped onto, waiting for the choice above them.
  let wrapped: string[] = [];
  let i = end;
  for (; i >= 0; i--) {
    const m = rows[i].match(CHOICE);
    if (!m) {
      // A choice's label may wrap onto a row or two of its own: keep going
      // if the choice before this one sits just above.
      const want = String(Number(choices[0].key) - 1);
      const wraps = rows[i].trim() && [1, 2].some((k) => rows[i - k]?.match(CHOICE)?.[2] === want);
      if (wraps) {
        wrapped.unshift(rows[i].trim());
        continue;
      }
      break;
    }
    choices.unshift({ key: m[2], label: [m[3].trim(), ...wrapped].join(" "), selected: !!m[1] });
    wrapped = [];
  }
  // The last choice's label may wrap too, onto rows the footer skip above
  // passed over: rows indented exactly to where its label starts.
  const lastRaw = lines[end].replace(/^[│┃|]/, "");
  const labelAt = lastRaw.search(/\S/) >= 0 ? lastRaw.indexOf(choices[choices.length - 1]?.label.split(" ")[0] ?? "\u0000") : -1;
  if (labelAt > 0) {
    for (let j = end + 1; j < lines.length; j++) {
      const raw = lines[j].replace(/^[│┃|]/, "");
      if (!raw.trim() || raw.search(/\S/) !== labelAt) break;
      choices[choices.length - 1].label += ` ${raw.trim().replace(EDGE, "")}`;
    }
  }
  if (!choices.length || choices[0].key !== "1") return null;
  if (!choices.every((c, n) => Number(c.key) === n + 1)) return null;
  // A picker marks exactly one row as current; a numbered list in prose
  // marks none.
  if (choices.filter((c) => c.selected).length !== 1) return null;
  const above: string[] = [];
  for (let j = i; j >= 0 && above.length < 3; j--) {
    const t = rows[j].trim();
    if (!t) {
      if (above.length) break;
      continue;
    }
    above.unshift(t);
  }
  return { prompt: above.join(" "), choices };
}

/** Whether the screen's bottom rows hold a picker this module couldn't
 *  read: typing a reply there would have Enter pick its current row. */
export function looksLikePicker(lines: string[]): boolean {
  // Not a bare ❯ or ›: Claude Code and Codex draw their ordinary input line
  // with one. A marked numbered row, or two numbered rows, is a menu — or
  // a numbered list, where sending you to the terminal is the safe miss.
  const rows = lines.slice(-10).map((l) => l.replace(EDGE, ""));
  return rows.some((l) => /^[❯›▶>]\s*\d{1,2}[.)]\s/.test(l)) || rows.filter((l) => /^\d{1,2}[.)]\s/.test(l)).length >= 2;
}

/** The screen's last few meaningful rows, for a preview. */
export function lastRows(lines: string[], n: number): string[] {
  return lines
    .map((l) => l.replace(EDGE, "").trimEnd())
    .filter((l) => l.trim())
    .slice(-n);
}
