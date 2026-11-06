// A question with numbered choices at the bottom of an agent's screen — a
// permission prompt — read from the screen's plain lines (screen.ts gets
// them). Kept apart from the reading so it can be tested on its own.

export interface Choice {
  /** What to type to pick it, or its place in a row of choices. */
  key: string;
  label: string;
  selected: boolean;
  /** The keys to press in turn to pick it, when typing `key` doesn't: a
   *  choice in a row is reached by arrow keys, then Enter. */
  keys?: string[];
  /** The explanation under it, in a question an agent put to you. */
  note?: string;
  /** Its box, ticked or not, when the question lets you pick several. */
  checked?: boolean;
  /** Picking it leaves the prompt up, on another step or with a box ticked,
   *  so the session is still waiting on you. */
  stays?: boolean;
  /** It opens a line to type your own answer on, in the terminal. */
  typed?: boolean;
}

export interface Question {
  /** The question's own line(s), above the choices. */
  prompt: string;
  /** What it's asking about, when the prompt sits in a panel that says:
   *  Claude Code's "Bash command" and the command, above "Do you want to
   *  proceed?". Blank rows between paragraphs stay as "". */
  detail?: string[];
  choices: Choice[];
}

/** Box-drawing edges and the marks a picker puts before its current row. */
const EDGE = /^[\s│┃|╭╰╮╯─]+|[\s│┃|╭╰╮╯─]+$/g;
const CHOICE = /^([❯›>▶●]\s*)?(\d{1,2})[.)]\s+(.+)$/;
/** The rule or box top a permission panel starts under. */
const RULE = /^\s*[╭─━]{3}[─━╮]*\s*$/;
/** The last row of a question an agent put to you, under a rule of its own. */
const CHAT = "Chat about this";
/** That row when its choices have previews: no number, and only ↓ reaches it. */
const CHAT_ROW = /^(?:[❯›▶]\s*)?Chat about this$/;
/** A choice's preview box, to the right of its row. */
const BOXED = /\s{2,}[┌│├└].*$/;
/** A box before a choice's label, when the question lets you pick several. */
const BOX = /^\[(.)\]\s+(.+)$/;
/** The row of tabs above such a question, one box per question. */
const TABS = /^(?:←\s*)?[☐☒]/;

/** The screen without the blank rows under its last text: a short session
 *  draws its prompt partway down a tall pane, not on the bottom row. */
function upToText(lines: string[]): string[] {
  let n = lines.length;
  while (n > 0 && !lines[n - 1].replace(EDGE, "")) n--;
  return lines.slice(0, n);
}

/** The numbered choices at the bottom of a screen, as Claude Code, Codex and
 *  friends draw a permission prompt: "❯ 1. Yes", "2. No, and tell me…". Only
 *  a run numbered 1, 2, 3… in the last rows counts, so a numbered list in
 *  the agent's prose above doesn't. */
export function findQuestion(screen: string[]): Question | null {
  return previewed(screen) ?? numbered(screen) ?? inRow(screen);
}

function numbered(screen: string[]): Question | null {
  const lines = upToText(screen);
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
  // Rows a label wrapped onto, or a note under it, waiting for the choice
  // above them, and those rows for each choice.
  let wrapped: string[] = [];
  const under: string[][] = [];
  let i = end;
  for (; i >= 0; i--) {
    const m = rows[i].match(CHOICE);
    if (!m) {
      // A choice's label may wrap onto a few rows of its own, and a rule
      // may part the last choice from the rest: keep going if the choice
      // before this one sits just above.
      const rule = RULE.test(lines[i]);
      const want = String(Number(choices[0].key) - 1);
      if ((rows[i].trim() || rule) && choiceAbove(lines, rows, i, want)) {
        if (!rule) wrapped.unshift(rows[i].trim());
        continue;
      }
      break;
    }
    choices.unshift({ key: m[2], label: m[3].trim(), selected: !!m[1] });
    under.unshift(wrapped);
    wrapped = [];
  }
  const asked = choices[choices.length - 1]?.label === CHAT;
  if (!asked) choices.forEach((c, n) => (c.label = [c.label, ...under[n]].join(" ")));
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
  // marks none. An agent's own question can have its mark on the row under
  // the numbers instead.
  const marked = choices.filter((c) => c.selected).length;
  if (marked > 1 || (!marked && !asked)) return null;
  const [prompt, j] = textAbove(rows, i, asked ? 8 : 3);
  const detail = panelAbove(lines, rows, j, asked);
  if (asked) return putToYou(prompt, detail, choices, under);
  return detail ? { prompt, detail, choices } : { prompt, choices };
}

/** The paragraph ending at or above row `from`, up to `most` rows of it, and
 *  the row above where it stopped. */
function textAbove(rows: string[], from: number, most: number): [string, number] {
  const above: string[] = [];
  let j = from;
  for (; j >= 0 && above.length < most; j--) {
    const t = rows[j].trim();
    if (!t) {
      if (above.length) break;
      continue;
    }
    above.unshift(t);
  }
  return [above.join(" "), j];
}

/** Whether the next row up that isn't a label's wrap or a rule is choice
 *  number `want`. */
function choiceAbove(lines: string[], rows: string[], from: number, want: string): boolean {
  for (let j = from - 1; j >= 0 && from - j <= 6; j--) {
    const m = rows[j].match(CHOICE);
    if (m) return m[2] === want;
    if (!rows[j].trim() && !RULE.test(lines[j])) return false;
  }
  return false;
}

/** A question an agent put to you, Claude Code's AskUserQuestion: a note
 *  under each choice, then a line for your own answer, then "Chat about
 *  this". With several questions a digit answers and moves to the next tab;
 *  with boxes a digit ticks one and Tab moves on, so that's a choice too. */
function putToYou(prompt: string, panel: string[] | undefined, choices: Choice[], under: string[][]): Question | null {
  const own = choices.length - 2;
  // On your own line, digits would land in your answer, not pick a choice.
  if (own < 0 || choices[own].selected) return null;
  const { last, detail } = steps(panel);
  const boxes = choices.some((c) => BOX.test(c.label));
  // "Next", or "Submit" on the last question, is under the boxes.
  const onward = boxes ? under[own].pop()?.replace(MARK, "") : undefined;
  const asked = choices.map((c, n) => {
    const box = c.label.match(BOX);
    const note = under[n].join(" ");
    return {
      ...c,
      label: box ? box[2] : c.label,
      ...(note ? { note } : {}),
      ...(box ? { checked: box[1] !== " " } : {}),
      ...(n === choices.length - 1 ? {} : !last || boxes || n === own ? { stays: true } : {}),
      ...(n === own ? { typed: true } : {}),
    };
  });
  if (boxes) asked.splice(-1, 0, { key: "next", label: onward || "Next", selected: false, keys: ["\t"], stays: true });
  return detail.length ? { prompt, detail, choices: asked } : { prompt, choices: asked };
}

/** What a form's tabs say: whether this is its only question, and the panel
 *  rows to show. A lone tab is drawn too, so with no tabs on screen they may
 *  have scrolled off, and more steps may follow. */
function steps(panel: string[] | undefined): { last: boolean; detail: string[] } {
  const tabs = panel && TABS.test(panel[0]) ? panel[0] : null;
  const last = !!tabs && (tabs.match(/[☐☒]/g) ?? []).length === 1;
  // The tabs say how far along you are, which one question doesn't need.
  const shown = last ? panel!.slice(1) : (panel ?? []);
  return { last, detail: shown.filter((t, n, all) => t || (n && n < all.length - 1)) };
}

/** A question whose choices each have a preview, drawn in a box beside them.
 *  There's no line for your own answer and "Chat about this" has no number.
 *  A digit only moves the mark here, so Enter has to follow it, and ↓ from
 *  the last choice reaches the chat row. */
function previewed(screen: string[]): Question | null {
  const lines = upToText(screen);
  const rows = lines.map((l) => l.replace(EDGE, ""));
  const beside = (l: string) => l.replace(BOXED, "").trim();
  let chat = rows.length - 1;
  while (chat >= 0 && rows.length - chat <= 6 && !CHAT_ROW.test(rows[chat].trim())) chat--;
  if (chat < 0 || !CHAT_ROW.test(rows[chat].trim())) return null;
  let first = chat - 1;
  while (first >= 0 && chat - first < 40 && beside(lines[first]).match(CHOICE)?.[2] !== "1") first--;
  if (first < 0 || chat - first >= 40) return null;
  const choices: Choice[] = [];
  for (let i = first; i < chat; i++) {
    const t = beside(lines[i]);
    const m = t.match(CHOICE);
    if (m) choices.push({ key: m[2], label: m[3].trim(), selected: !!m[1], keys: [m[2], "\r"] });
    else if (t && !RULE.test(lines[i])) choices[choices.length - 1].label += ` ${t}`;
    else if (!BOXED.test(lines[i])) break;
  }
  if (!choices.every((c, n) => Number(c.key) === n + 1)) return null;
  const [prompt, j] = textAbove(rows, first - 1, 8);
  const { last, detail } = steps(panelAbove(lines, rows, j, true));
  // With the mark on the chat row, the last choice keeps a mark of its own.
  const onChat = rows[chat].trim() !== CHAT;
  const asked: Choice[] = [
    ...choices.map((c) => ({ ...c, selected: c.selected && !onChat, ...(last ? {} : { stays: true }) })),
    {
      key: "chat",
      label: CHAT,
      selected: onChat,
      keys: [choices[choices.length - 1].key, "\x1b[B", "\r"],
    },
  ];
  return detail.length ? { prompt, detail, choices: asked } : { prompt, choices: asked };
}

/** A mark before one of several short choices spaced apart on one row, as
 *  an MCP server's "❯ Accept    Decline" draws. */
const ROW = /^(?:[❯›▶]\s*)?\S+(?: \S+){0,3}(?:\s{3,}(?:[❯›▶]\s*)?\S+(?: \S+){0,3})+$/;
const MARK = /^[❯›▶]\s*/;

/** Choices drawn side by side on one row, under the question: Claude Code's
 *  MCP input prompt. ← and → move the mark along the row, Enter picks. */
function inRow(screen: string[]): Question | null {
  const lines = upToText(screen);
  const rows = lines.map((l) => l.replace(EDGE, ""));
  let end = rows.length - 1;
  let skipped = 0;
  while (end >= 0 && !ROW.test(rows[end]) && skipped < 6) {
    end--;
    skipped++;
  }
  if (end < 0 || !ROW.test(rows[end])) return null;
  const parts = rows[end].trim().split(/\s{3,}/);
  const at = parts.findIndex((p) => MARK.test(p));
  if (at < 0 || parts.filter((p) => MARK.test(p)).length !== 1) return null;
  const choices: Choice[] = parts.map((p, n) => {
    const step = n > at ? "\x1b[C" : "\x1b[D";
    return {
      key: String(n + 1),
      label: p.replace(MARK, ""),
      selected: n === at,
      keys: [...Array<string>(Math.abs(n - at)).fill(step), "\r"],
    };
  });
  const above: string[] = [];
  let j = end - 1;
  for (; j >= 0 && above.length < 6; j--) {
    const t = rows[j].trim();
    if (!t) {
      if (above.length) break;
      continue;
    }
    above.unshift(t);
  }
  const title: string[] = [];
  for (; j >= 0 && title.length < 2; j--) {
    const t = rows[j].trim();
    if (!t || RULE.test(lines[j])) {
      if (title.length || RULE.test(lines[j])) break;
      continue;
    }
    title.unshift(t);
  }
  return title.length ? { prompt: above.join(" "), detail: title, choices } : { prompt: above.join(" "), choices };
}

/** The panel rows above the prompt, up to the rule or box top the panel
 *  starts under. Without one close by, the rows above are the agent's
 *  prose, not part of the question, so there's no detail. */
function panelAbove(lines: string[], rows: string[], from: number, asked = false): string[] | undefined {
  const out: string[] = [];
  for (let j = from; j >= 0 && from - j < 40; j--) {
    // In a short terminal the rule above an agent's question scrolls off
    // first, and its tabs are the top of the panel.
    const tabs = asked && TABS.test(rows[j].trim());
    if (tabs) out.unshift(rows[j].trim());
    if (tabs || RULE.test(lines[j])) {
      while (out.length && !out[0]) out.shift();
      while (out.length && !out[out.length - 1]) out.pop();
      // One blank row between paragraphs is enough.
      const kept = out.filter((t, n) => t || out[n - 1]).map((t) => (TABS.test(t) ? t.replace(/^←\s*|\s*→$/g, "") : t));
      return kept.length ? kept : undefined;
    }
    out.unshift(rows[j].trim());
  }
  return undefined;
}

/** Whether the screen's bottom rows hold a picker this module couldn't
 *  read: typing a reply there would have Enter pick its current row. */
export function looksLikePicker(lines: string[]): boolean {
  // Not a bare ❯ or ›: Claude Code and Codex draw their ordinary input line
  // with one. A marked numbered row, or two numbered rows, is a menu — or
  // a numbered list, where sending you to the terminal is the safe miss.
  // Choices on one row, like an MCP server's "❯ Accept    Decline", count
  // too: a mark on one of several words spaced apart.
  const rows = upToText(lines).slice(-10).map((l) => l.replace(EDGE, ""));
  return (
    rows.some((l) => /^[❯›▶>]\s*\d{1,2}[.)]\s/.test(l)) ||
    rows.filter((l) => /^\d{1,2}[.)]\s/.test(l)).length >= 2 ||
    rows.some((l) => /^[❯›▶]\s*\S+(?: \S+)?\s{3,}\S/.test(l) || /\S\s{3,}[❯›▶]\s*\S/.test(l)) ||
    rows.some((l) => CHAT_ROW.test(l.trim()))
  );
}

/** The screen's last few meaningful rows, for a preview. */
export function lastRows(lines: string[], n: number): string[] {
  return lines
    .map((l) => l.replace(EDGE, "").trimEnd())
    .filter((l) => l.trim())
    .slice(-n);
}
