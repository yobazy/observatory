// Talk to a lead as its pet (S27): each lead (lead.ts, and S26's top lead)
// is a pixel-pets animal, and talking to one opens a DS-style dialogue along
// the bottom of whatever view is open. This file is the pure part: which pet
// a lead is, the lead's latest reply cut into box-sized pages (code, tables
// and long lists left to the Read view), whether a lead is calling you, and
// who ⌘L opens. LeadChat.tsx draws it. Kept free of the app so its tests run
// under plain Node.
import { COATS, coatFor, type CritterKind } from "../vendor/pixel-pets/frames.ts";
import { ASK_USER } from "./leadAsk.ts";
import { askLines } from "./leadActions.ts";
import type { Entry } from "./transcript";

// ---- pets ----

export interface LeadPet {
  kind: CritterKind;
  coat: string;
}

/** The top lead is a big cat: the jaguar, in gold. */
export const TOP_PET: LeadPet = { kind: "jaguar", coat: "jaguar" };

/** The animals a project's lead is picked from by default: the everyday
 *  ones, so the big cat stands for the top lead. Any kind can be picked. */
const EVERYDAY: CritterKind[] = ["cat", "dog", "turtle", "frog"];

/** Every animal and coat, in pixel-pets' order. */
export const PET_CHOICES: (LeadPet & { label: string })[] = (Object.keys(COATS) as CritterKind[]).flatMap((kind) =>
  COATS[kind].map((c) => ({ kind, coat: c.id, label: `${kindLabel(kind)} · ${c.label}` })),
);

function kindLabel(kind: CritterKind): string {
  return kind[0].toUpperCase() + kind.slice(1);
}

/** FNV-1a over the name's UTF-16 units: the same name, the same number,
 *  on every launch and machine. */
export function nameHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const DEFAULTS: LeadPet[] = EVERYDAY.flatMap((kind) => COATS[kind].map((c) => ({ kind, coat: c.id })));

/** The pet a project's lead is when none was picked, from its name. */
export function defaultPet(project: string): LeadPet {
  return DEFAULTS[nameHash(project.trim().toLowerCase()) % DEFAULTS.length];
}

/** A saved pet, if it's one pixel-pets draws. */
export function validPet(x: unknown): LeadPet | null {
  if (!x || typeof x !== "object") return null;
  const p = x as Partial<LeadPet>;
  if (typeof p.kind !== "string" || !(p.kind in COATS)) return null;
  const kind = p.kind as CritterKind;
  return { kind, coat: coatFor(kind, typeof p.coat === "string" ? p.coat : null).id };
}

/** The pet a lead is: the one picked for it, else its default. */
export function petOf(lead: { pet?: unknown } | undefined, project: string | null): LeadPet {
  return validPet(lead?.pet) ?? (project === null ? TOP_PET : defaultPet(project));
}

export const petKey = (p: LeadPet) => `${p.kind}:${p.coat}`;

export function petFromKey(key: string): LeadPet | null {
  const [kind, coat] = key.split(":");
  return validPet({ kind, coat });
}

export function petLabel(p: LeadPet): string {
  return PET_CHOICES.find((c) => c.kind === p.kind && c.coat === p.coat)?.label ?? kindLabel(p.kind);
}

// ---- the reply, in pages ----

/** What a block the box doesn't page says instead. */
export const readViewLine = (what: "code" | "table" | "list") => `(${what}, see Read view)`;

/** Lists longer than this are left to the Read view. */
export const LIST_MAX = 4;

const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;

/** Markdown's marks taken off a line, keeping its words. */
export function plainLine(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A reply as the paragraphs the box says, in order: code blocks, tables
 *  and lists of more than LIST_MAX items become one line pointing at the
 *  Read view; a short list's items are a paragraph each. */
export function paragraphs(md: string): string[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    const text = plainLine(para.join(" "));
    if (text) out.push(text);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flush();
      const mark = line.trim().slice(0, 3);
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) i++;
      out.push(readViewLine("code"));
    } else if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      flush();
      while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1])) i++;
      out.push(readViewLine("table"));
    } else if (ITEM.test(line)) {
      flush();
      const items: string[] = [];
      for (; i < lines.length; i++) {
        if (ITEM.test(lines[i])) items.push(lines[i]);
        // An indented line goes on with the item above it.
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
      }
      i--;
      if (items.length > LIST_MAX) out.push(readViewLine("list"));
      else
        for (const it of items) {
          const num = it.match(/^\s*(\d+[.)])\s+/)?.[1];
          const text = plainLine(it.replace(ITEM, ""));
          if (text) out.push(`${num ?? "•"} ${text}`);
        }
    } else if (!line.trim()) flush();
    else para.push(line);
  }
  flush();
  return out;
}

/** The box's size in characters: `cols` to a line, `rows` lines. */
export interface BoxSize {
  cols: number;
  rows: number;
}

/** Words wrapped into lines of at most `cols` characters. A word longer
 *  than a line has one to itself and is never cut. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= cols) cur += ` ${word}`;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** The reply in pages that fit the box: at most `rows` wrapped lines each,
 *  paragraphs starting on a line of their own ("\n" between them), words
 *  never split across lines or pages. */
export function pages(md: string, box: BoxSize): string[] {
  const cols = Math.max(8, Math.floor(box.cols));
  const rows = Math.max(1, Math.floor(box.rows));
  const lines = paragraphs(md).flatMap((p) => wrap(p, cols).map((text, i) => ({ text, starts: i === 0 })));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += rows) {
    const page = lines.slice(i, i + rows);
    out.push(page.map((l, j) => (j === 0 ? "" : l.starts ? "\n" : " ") + l.text).join(""));
  }
  return out;
}

/** Whether a reply has a block only the Read view shows. */
export const hasStandIn = (md: string) => paragraphs(md).some((p) => /^\((code|table|list), see Read view\)$/.test(p));

// ---- the dialogue on screen ----

/** Where the dialogue is: nothing on screen ("closed", so it renders
 *  nothing and takes no layout), sliding in or away, or up. `open` is the
 *  lead asked for, `shown` the one still drawn while it slides away, `up`
 *  whether the slide up has started. */
export function talkPhase(open: string | null, shown: string | null, up: boolean): "closed" | "sliding" | "open" {
  if (shown === null) return "closed";
  return open === shown && up ? "open" : "sliding";
}

// ---- calling you ----

export interface LeadReply {
  n: number;
  text: string;
  /** Unix seconds. */
  at: number;
}

/** A thread's latest reply, as the Read view finds it: its last assistant
 *  entry with something said. */
export function lastReply(entries: readonly Pick<Entry, "n" | "kind" | "text" | "at">[] | null | undefined): LeadReply | null {
  for (let i = (entries?.length ?? 0) - 1; i >= 0; i--) {
    const e = entries![i];
    if (e.kind === "claude" && e.text.trim()) return { n: e.n, text: e.text, at: e.at };
  }
  return null;
}

/** How many questions a reply passes to you: its `ASK_USER:` lines, and
 *  (S28, when the lead's actions are on) its `ASK merge` and `ASK archive`
 *  lines. */
export function askCount(text: string, actions = false): number {
  return text.split("\n").filter((l) => l.includes(ASK_USER)).length + (actions ? askLines(text) : 0);
}

export interface Call {
  calling: boolean;
  /** What the badge counts: the reply's ASK_USER lines, else 1 unread reply. */
  count: number;
  why: "ask" | "unread" | null;
}

export const QUIET: Call = { calling: false, count: 0, why: null };

/** Whether a lead has something for you: its latest reply asks you
 *  (`ASK_USER:`), or it's unread, since you last opened it here or in the
 *  Read view (`seen`, the last entry you saw). */
export function callState(o: { reply: LeadReply | null; unseen: boolean; seen: number | null; actions?: boolean }): Call {
  const { reply } = o;
  if (!reply) return QUIET;
  if (o.seen !== null && reply.n <= o.seen) return QUIET;
  const asks = askCount(reply.text, o.actions);
  if (asks > 0) return { calling: true, count: asks, why: "ask" };
  if (o.unseen) return { calling: true, count: 1, why: "unread" };
  return QUIET;
}

// ---- which leads, and who ⌘L opens ----

export interface LeadEntry {
  /** The lead's thread. */
  agentId: string;
  /** Its project's id, or null for the top lead. */
  projectId: string | null;
  /** "<project> lead", or "Top lead". */
  title: string;
  model: string;
  pet: LeadPet;
  /** Its action lines are carried out (S28): a project lead with them on. */
  acts: boolean;
}

/** Every running lead, the top lead first, then projects by name. */
export function leadsOf(
  cards: Record<string, { lead?: { agentId: string; model: string; pet?: unknown; acts?: boolean } }>,
  top: { agentId: string; model: string; pet?: unknown } | undefined | null,
  agents: Record<string, { archived: boolean }>,
  projects: Record<string, { name: string } | undefined>,
): LeadEntry[] {
  const live = (id: string) => !!agents[id] && !agents[id].archived;
  const out: LeadEntry[] = [];
  if (top && live(top.agentId)) out.push({ agentId: top.agentId, projectId: null, title: "Top lead", model: top.model, pet: petOf(top, null), acts: false });
  const rows = Object.entries(cards)
    .flatMap(([key, c]) => {
      const p = projects[key];
      return c.lead && p && live(c.lead.agentId) ? [{ key, lead: c.lead, name: p.name }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const r of rows)
    out.push({
      agentId: r.lead.agentId,
      projectId: r.key,
      title: `${r.name} lead`,
      model: r.lead.model,
      pet: petOf(r.lead, r.name),
      acts: r.lead.acts === true,
    });
  return out;
}

/** The lead ⌘L opens: one calling you (a question before an unread reply,
 *  then in list order), else the top lead; null when neither is there. */
export function shortcutTarget(leads: readonly LeadEntry[], calls: Record<string, Call>): string | null {
  const calling = (why: Call["why"]) => leads.find((l) => calls[l.agentId]?.calling && calls[l.agentId].why === why);
  return (calling("ask") ?? calling("unread") ?? leads.find((l) => l.projectId === null))?.agentId ?? null;
}

// ---- what you've seen ----

const SEEN_KEY = "observatory.leadChat.seen";

function loadSeen(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** The last entry of `agentId`'s thread you saw in the dialogue, or null. */
export function seenInChat(agentId: string): number | null {
  const n = loadSeen()[agentId];
  return typeof n === "number" ? n : null;
}

export function markSeenInChat(agentId: string, n: number) {
  try {
    const all = loadSeen();
    if ((all[agentId] ?? -1) >= n) return;
    all[agentId] = n;
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    // Without storage a lead calls again next launch.
  }
}

/** The later of two "last seen" entries, either of which may be unknown. */
export const laterSeen = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));
