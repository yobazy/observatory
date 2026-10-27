// A reply read as a card, for the reader view: a bold first line as its
// headline, a line of status dots as chips, a "Needs you" (or "Decisions")
// list whose lettered options become buttons, "Details" folded away, and
// the closing "Safe to close" line set apart at the foot. Anything the
// reply doesn't say that way stays as prose, so a reply written any other
// way reads as it always did. Kept free of the app so its tests run under
// plain Node.

export type Tone = "done" | "wait" | "bad" | "idle";

export interface Chip {
  tone: Tone;
  text: string;
}

export interface Option {
  letter: string;
  label: string;
}

/** One numbered decision: "2. Ship today?  A today · B Monday". */
export interface Ask {
  n: number;
  text: string;
  options: Option[];
}

export interface Card {
  /** Inline Markdown, without the bold around it. */
  headline: string | null;
  chips: Chip[];
  /** Markdown: everything not read as one of the other parts. */
  body: string;
  asks: Ask[];
  /** Markdown under the Needs you list: "I'd pick 1A, 2B…". */
  asksNote: string;
  details: string | null;
  /** Absolute paths of the images the reply names, in order. */
  images: string[];
  /** Absolute paths of the videos it names: in backticks a path may have
   *  spaces, as a render's file name often does. */
  videos: string[];
  /** The closing line: "✅ Safe to close", "🟠 Keep open: …". */
  verdict: Chip | null;
}

const TONES: [RegExp, Tone][] = [
  [/^(✅|🟢|☑️|✔️)/u, "done"],
  [/^(🟠|🟡|⏳)/u, "wait"],
  [/^(🔴|❌)/u, "bad"],
  [/^(⚪|⚫|◽)/u, "idle"],
];

const toneOf = (s: string): Tone | null => TONES.find(([re]) => re.test(s))?.[1] ?? null;

/** "✅ done · 🟠 waiting on you" as chips, or null when any part has no dot. */
export function readChips(line: string): Chip[] | null {
  const parts = line.split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const chips: Chip[] = [];
  for (const p of parts) {
    const tone = toneOf(p);
    if (!tone) return null;
    chips.push({ tone, text: p.replace(TONES.find(([, t]) => t === tone)![0], "").replace(/^️/, "").trim() });
  }
  return chips;
}

// One option's letter and label, however a reply writes it: "A today",
// "A: today", "A · today", "A) today", "**A** today" or "**A (recommended):** today".
const OPTION = /^(?:\*\*|__)?([A-Z])(\s*\([^)]*\))?(?:\s*[:.)·–—-])?(?:\*\*|__)?(?:\s*[:.)·–—-])?\s+(\S.*)$/;
// An option on a line of its own under the question: "  - A: today" or
// "  - **A (recommended):** today". The letter needs punctuation or bold
// after it, so prose like "A lot" isn't one.
const OPTION_LINE = /^\s*(?:[-*]\s+)?(\*\*|__)?([A-Z])(\s*\([^)]*\))?(\s*[:.)·–—-])?(\*\*|__)?(\s*[:.)·–—-])?\s+(\S.*)$/;

function readOptionLine(line: string): Option | null {
  const m = OPTION_LINE.exec(line);
  // A bullet marks it as an option too: "  - A today".
  const bulleted = /^\s*[-*]\s/.test(line);
  if (!m || (m[1] ?? "") !== (m[5] ?? "") || !(m[1] || m[4] || m[6] || bulleted)) return null;
  const aside = m[3]?.trim();
  return { letter: m[2], label: aside ? `${aside} ${m[7].trim()}` : m[7].trim() };
}

/** "Ship today?  A today · B Monday" into the question and its options,
 *  lettered from A in order. No options when it doesn't read that way. */
export function readAsk(n: number, line: string): Ask {
  const optionsFrom = (at: number): Option[] | null => {
    const options = line
      .slice(at)
      // "A · today" separates the letter with a dot too; make it "A: today"
      // so splitting on the dots between options leaves it whole.
      .replace(/(^|\s)((?:\*\*|__)?[A-Z](?:\*\*|__)?)\s+·\s+/g, "$1$2: ")
      .split(/\s+·\s+/)
      .map((p, i) => {
        const got = OPTION.exec(p.trim());
        if (!got || got[1] !== String.fromCharCode(65 + i)) return null;
        const aside = got[2]?.trim();
        return { letter: got[1], label: aside ? `${aside} ${got[3].trim()}` : got[3].trim() };
      });
    return options.length >= 2 && options.every(Boolean) ? (options as Option[]) : null;
  };
  // Every "A" that could start the options; the convention puts two spaces
  // before them, so those win over an "A" inside the question.
  const starts = [...line.matchAll(/(\s+)(?=(?:\*\*|__)?A(?:\s*\([^)]*\))?(?:\s*[:.)·–—-])?(?:\*\*|__)?(?:\s*[:.)·–—-])?\s)/g)].map((m) => ({
    at: m.index! + m[1].length,
    wide: m[1].length > 1,
  }));
  const valid = starts.filter((s) => optionsFrom(s.at));
  const pick = valid.find((s) => s.wide) ?? valid[valid.length - 1];
  if (!pick) return { n, text: line.trim(), options: [] };
  return { n, text: line.slice(0, pick.at).trim(), options: optionsFrom(pick.at)! };
}

const SECTION = /^\s*(?:#{1,4}\s*)?(?:\*\*|__)?\s*(Needs you|Decisions?|Details)(?:\s*\([^)]*\))?[\s:*_]*$/i;
// "**Needs you:** nothing tonight." starts the section and says it too.
const SECTION_INLINE = /^\s*(?:\*\*|__)(Needs you|Decisions?|Details)(?:\s*\([^)]*\))?:?(?:\*\*|__):?\s+(\S.*)$/i;
// The close verdict a reply ends on, once its bold is gone, also as a bullet.
const VERDICT = /^\s*(?:[-*]\s+)?(✅|🟠|🔴)\uFE0F?\s*((?:Safe to close|Keep open|Don['’]t close|Do not close)\b.*)$/u;

/** A line like "**🟠 Keep open:** waiting on 2", read as a close verdict. */
function verdictOf(line: string): Chip | null {
  const m = VERDICT.exec(line.replace(/\*\*|__/g, ""));
  return m ? { tone: toneOf(m[1])!, text: m[2].trim() } : null;
}

/** The close verdict a reply ends on, from its last line. */
export function readVerdict(text: string): Chip | null {
  const last = text.trimEnd().split("\n").pop();
  return last ? verdictOf(last) : null;
}
// A numbered decision, also as a bullet or with its number in bold:
// "2. Ship today?", "- 2. Ship today?", "- **2. Ship today?** A …".
const ITEM = /^\s*(?:[-*]\s+)?(\*\*|__)?(\d+)[.)]\s+(.+)$/;
const IMAGE = /(?:^|[\s`("'[])(\/[^\s`)"'\]]+\.(?:png|jpe?g|gif|webp|svg|avif))/gi;
const VIDEO = /`(\/[^`\n]+\.(?:mp4|m4v|mov|webm))`|(?:^|[\s("'[])(\/[^\s`)"'\]]+\.(?:mp4|m4v|mov|webm))/gi;

/** Paragraphs, with fenced code kept whole. */
function paragraphs(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && !line.trim()) {
      if (cur.length) out.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

/** Decisions run together on one line ("2. Ship? A x · B y 3. Name? A …")
 *  split back into one per number, where the numbers count up. */
function splitAsks(line: string): string[] {
  const first = ITEM.exec(line);
  if (!first) return [line];
  const out: string[] = [];
  let next = Number(first[2]) + 1;
  let rest = line;
  for (;;) {
    const at = rest.search(new RegExp(`\\s(?:\\*\\*|__)?${next}[.)]\\s+\\S`));
    // The one before has to have read as a choice, so "under 5. Then" stays.
    if (at < 0 || !readAsk(0, rest.slice(0, at).replace(ITEM, "$3")).options.length) break;
    out.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
    next++;
  }
  return [...out, rest];
}

export function readCard(text: string): Card {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // The verdict on the last line comes off before anything else reads it,
  // unless it's all the reply says.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const verdict = lines.length > 1 ? verdictOf(lines[lines.length - 1]) : null;
  if (verdict) lines.pop();
  // Split into the part before any section, and the sections by name.
  const lead: string[] = [];
  const sections: Record<"needs" | "details", string[]> = { needs: [], details: [] };
  let into: string[] = lead;
  let fenced = false;
  for (const [i, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    // A bare "Details" line only starts a section after a blank line; bold
    // or a heading always does.
    const marked = /^\s*(#|\*\*|__)/.test(line);
    const s =
      fenced || (!marked && i > 0 && lines[i - 1].trim()) ? null : (SECTION.exec(line) ?? SECTION_INLINE.exec(line));
    if (s) {
      into = s[1].toLowerCase() === "details" ? sections.details : sections.needs;
      if (s[2]) into.push(s[2]);
    } else into.push(line);
  }

  const paras = paragraphs(lead.join("\n"));
  let headline: string | null = null;
  let chips: Chip[] = [];
  const bold = paras.length ? /^\s*(?:\*\*|__)([^\n]+?)(?:\*\*|__)\s*$/.exec(paras[0]) : null;
  if (bold && !/\*\*|__/.test(bold[1])) {
    headline = bold[1].trim();
    paras.shift();
  }
  if (paras.length && !paras[0].includes("\n")) {
    const got = readChips(paras[0]);
    if (got) {
      chips = got;
      paras.shift();
    }
  }

  const asks: Ask[] = [];
  const note: string[] = [];
  // The decision lines under it still belong to; prose after it closes it.
  let open: Ask | null = null;
  // The lines each ask's own-line options came from, to give back if they
  // don't make a choice.
  const lined = new Map<Ask, string[]>();
  for (const line of sections.needs.flatMap(splitAsks)) {
    const item = ITEM.exec(line);
    const opt = open && readOptionLine(line);
    if (item) {
      // Bold that opened before the number closes after the question; drop it.
      const text = item[1] ? item[3].replace(item[1], "") : item[3];
      asks.push((open = readAsk(Number(item[2]), text)));
    } else if (open && opt && opt.letter === String.fromCharCode(65 + open.options.length)) {
      open.options.push(opt);
      lined.set(open, [...(lined.get(open) ?? []), line]);
    } else if (open && /^\s{2,}\S/.test(line)) open.text += ` ${line.trim()}`;
    else {
      if (line.trim()) open = null;
      note.push(line);
    }
  }

  // A lone option on its own line isn't a choice; give it back as written.
  for (const a of asks) {
    if (a.options.length === 1 && lined.has(a)) {
      a.text += `\n${lined.get(a)!.join("\n")}`;
      a.options = [];
    }
  }

  const details = sections.details.join("\n").trim();
  const images = [...new Set([...text.matchAll(IMAGE)].map((m) => m[1]))];
  const videos = [...new Set([...text.matchAll(VIDEO)].map((m) => m[1] ?? m[2]))];
  return {
    headline,
    chips,
    body: paras.join("\n\n").trim(),
    asks,
    asksNote: note.join("\n").trim(),
    details: details || null,
    images,
    videos,
    verdict,
  };
}

/** Whether there's more to it than prose. */
export const isCard = (c: Card) => !!(c.headline || c.chips.length || c.asks.length || c.details || c.verdict);

/** What tapping answers sends: "1 A, 2 B", then anything typed after it. */
export function answerText(picks: Record<number, string>, typed: string): string {
  const all = Object.entries(picks)
    .filter(([, l]) => l.trim())
    .sort(([a], [b]) => Number(a) - Number(b));
  // A lettered answer is "2 B"; one written in ("Other…") gets a line of its own.
  const letters = all.filter(([, l]) => /^[A-Z]$/.test(l));
  const written = all.filter(([, l]) => !/^[A-Z]$/.test(l)).map(([n, l]) => `${n}: ${l.trim()}`);
  const said = [letters.map(([n, l]) => `${n} ${l}`).join(", "), ...written].filter(Boolean).join("\n");
  const rest = typed.trim();
  if (!said || !rest) return said || rest;
  // Answers to earlier replies, from the tray, keep a paragraph of their own.
  return written.length || rest.startsWith("About your reply") ? `${said}\n\n${rest}` : `${said}. ${rest}`;
}

/** A reply's opening words, to say which one you mean: its first line with
 *  the Markdown taken off, cut short. */
export function replyQuote(text: string, max = 80): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const plain = line
    .replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+[.)]\s+|>\s*)/, "")
    .replace(/(\*\*|__|`)/g, "")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** What "Point at this" sends: which reply, how it looked, then what you
 *  said about it. */
export function pointerText(quote: string, shot: string | null, said: string): string {
  const about = `About your reply that starts "${quote}"`;
  const look = shot ? ` (how the Read view showed it: ${shot})` : "";
  const rest = said.trim();
  return rest ? `${about}${look}\n\n${rest}` : `${about}${look}`;
}

/** The answers a message opens with, as tapping writes them ("1 A, 2 B"),
 *  so a reply can show what you picked. Nothing for anything else, like
 *  "3D printing". */
export function answersIn(text: string): Record<number, string> {
  return leadingAnswers(text).picks;
}

/** Every answer a message gives: the lettered ones it opens with, and any
 *  written in on a line of their own ("2: keep it for a week"). */
export function answersSaid(text: string): Record<number, string> {
  const out = { ...answersIn(text) };
  for (const m of text.matchAll(/^(\d+): (\S.*)$/gm)) out[Number(m[1])] ??= m[2].trim();
  return out;
}

/** The answers a message opens with and what it says after them. */
function leadingAnswers(text: string): { picks: Record<number, string>; rest: string } {
  // "1 A, 2 B", and the ways dictation writes it: "1a 2b", "1: A and 2: B".
  // Read one pair at a time, so a long message can't make it backtrack.
  const pair = /\s*(?:[,;]\s*)?(?:and\s+)?(\d+)[ \t]*(?::[ \t]*)?([a-z])(?![a-z]|\.[a-z])/iy;
  const out: Record<number, string> = {};
  let at = 0;
  let count = 0;
  for (let m: RegExpExecArray | null; ((pair.lastIndex = at), (m = pair.exec(text))); at = pair.lastIndex, count++)
    out[Number(m[1])] = m[2].toUpperCase();
  // Two answers or more can run into whatever else you said; one alone needs
  // punctuation or the end after it, so "3D printing" isn't an answer.
  const rest = text.slice(at);
  return count && (/^\s*($|[.;,!\n])/.test(rest) || (count >= 2 && /^\s/.test(rest)))
    ? { picks: out, rest: rest.replace(/^\s*[.;,!]?\s*/, "") }
    : { picks: {}, rest: text };
}

/** The answers you're typing or dictating into the box ("2 a, 3 b"), as
 *  taps on the card they answer, with the rest of what you said. Only
 *  answers the card offers count; anything else leaves the text alone. */
export function typedAnswers(card: Card | null, text: string): { picks: Record<number, string>; rest: string } {
  const got = card?.asks.length ? leadingAnswers(text) : { picks: {}, rest: text };
  const known = Object.entries(got.picks).every(([n, l]) => card!.asks.some((a) => a.n === Number(n) && a.options.some((o) => o.letter === l)));
  return Object.keys(got.picks).length && known ? got : { picks: {}, rest: text };
}

/** The answers a card recommends, for the reply box to offer: what follows
 *  "I'd pick" (or "I'd go with", "I recommend"), else each question's
 *  "(recommended)" option. Empty when it recommends nothing. */
export function suggested(card: Card): Record<number, string> {
  const said = /\bI(?:'d| would)?\s+(?:pick|go with|recommend|lean(?: towards?)?)\s+(.+)/i.exec(`${card.asksNote}\n${card.body}`);
  const picked = said ? answersIn(said[1].replace(/\*\*|__/g, "")) : {};
  const known = Object.entries(picked).filter(([n, l]) => card.asks.some((a) => a.n === Number(n) && a.options.some((o) => o.letter === l)));
  if (known.length) return Object.fromEntries(known.map(([n, l]) => [Number(n), l]));
  const out: Record<number, string> = {};
  for (const a of card.asks) {
    const rec = a.options.find((o) => /^\(recommended\)/i.test(o.label) || /\(recommended\)\s*$/i.test(o.label));
    if (rec) out[a.n] = rec.letter;
  }
  return out;
}

/** Decisions earlier replies asked that the message after them didn't
 *  answer, newest last, for the reader to keep in view. The latest reply's
 *  own are on its card, so they don't count. */
export function openDecisions(
  entries: { n: number; kind: string; text: string }[],
  latest: number,
): { entry: number; quote: string; asks: Ask[] }[] {
  const out: { entry: number; quote: string; asks: Ask[] }[] = [];
  let pending: { entry: number; quote: string; asks: Ask[] } | null = null;
  for (const e of entries) {
    if (e.kind === "claude") {
      const asks = readCard(e.text).asks.filter((a) => a.options.length);
      if (asks.length && e.n !== latest) pending = { entry: e.n, quote: replyQuote(e.text), asks };
    } else if (e.kind === "you") {
      // "About your reply that starts "…": 2 B" answers an earlier one.
      for (const m of e.text.matchAll(/^About your reply that starts "(.+)": ([^\n]+)$/gm)) {
        const said = answersSaid(m[2]);
        for (const o of out) if (o.quote === m[1]) o.asks = o.asks.filter((a) => !said[a.n]);
      }
    }
    if (e.kind === "you" && pending) {
      // A message pointing at a reply says which first, then the answers.
      const said = answersSaid(e.text);
      const got = Object.keys(said).length ? said : answersSaid(e.text.split(/\n\s*\n/).slice(1).join("\n\n"));
      const left = pending.asks.filter((a) => !got[a.n]);
      if (left.length) out.push({ ...pending, asks: left });
      pending = null;
    }
  }
  return out.filter((o) => o.asks.length);
}

/** What "Reply about this" sends: the passage you selected in a reply,
 *  quoted, then what you said about it. */
export function passageText(passage: string, said: string, max = 600): string {
  const clipped = passage.trim().length > max ? `${passage.trim().slice(0, max - 1).trimEnd()}…` : passage.trim();
  const quoted = clipped
    .split("\n")
    .map((l) => `> ${l}`.trimEnd())
    .join("\n");
  return `About this part of your reply:\n${quoted}\n\n${said.trim()}`;
}

/** The thread's turns for the outline beside it: each of your messages,
 *  and how the last reply to it ended (its verdict, else its worst chip). */
export function turnsOf(entries: { n: number; kind: string; text: string }[]): { n: number; prompt: string; tone: Tone | null }[] {
  const out: { n: number; prompt: string; tone: Tone | null }[] = [];
  for (const e of entries) {
    if (e.kind === "you") out.push({ n: e.n, prompt: replyQuote(e.text, 60), tone: null });
    else if (e.kind === "claude" && out.length) {
      const c = readCard(e.text);
      const worst = (["bad", "wait", "done", "idle"] as Tone[]).find((t) => c.chips.some((x) => x.tone === t)) ?? null;
      const tone = c.verdict?.tone ?? worst;
      if (tone) out[out.length - 1].tone = tone;
    }
  }
  return out;
}

/** A reply's two pictures as before and after, when it says which is which:
 *  by their names ("reader-before.png") or on the lines naming them. */
export function beforeAfter(images: string[], text: string): [string, string] | null {
  if (images.length !== 2) return null;
  const said = (p: string) => {
    const name = p.split("/").pop() ?? p;
    const line = text.split("\n").find((l) => l.includes(p)) ?? "";
    for (const where of [name, line]) {
      const before = /\bbefore\b/i.test(where.replace(/[-_.]/g, " "));
      const after = /\bafter\b/i.test(where.replace(/[-_.]/g, " "));
      if (before !== after) return before ? "before" : "after";
    }
    return null;
  };
  const [a, b] = images.map(said);
  if (a === "before" && b === "after") return [images[0], images[1]];
  if (a === "after" && b === "before") return [images[1], images[0]];
  return null;
}

/** A reply kept as a Markdown note: named after its headline (else its
 *  opening words), with where it came from in the note's properties. */
export function noteFor(text: string, from: { thread: string; project: string; date: string }): { name: string; body: string } {
  const card = readCard(text);
  const name = (card.headline ?? replyQuote(text, 80)).replace(/\*\*|__|`/g, "").replace(/[.:]+$/, "").trim() || "Reply";
  const yaml = (s: string) => JSON.stringify(s);
  const body = ["---", "tags: [observatory]", `thread: ${yaml(from.thread)}`, `project: ${yaml(from.project)}`, `saved: ${from.date}`, "---", "", text.trim(), ""].join("\n");
  return { name, body };
}

/** The reply a thread is waiting on you to decide: its latest, when that
 *  asks decisions and nothing you said came after it. */
export function pendingCard(entries: { n: number; kind: string; text: string }[]): { n: number; text: string; card: Card } | null {
  const last = [...entries].reverse().find((e) => e.kind === "claude" || e.kind === "you");
  if (!last || last.kind !== "claude") return null;
  const card = readCard(last.text);
  return card.asks.some((a) => a.options.length) ? { n: last.n, text: last.text, card } : null;
}
