// A lead as its pet (S27): each lead (lead.ts, and S26's top lead) is a
// pixel-pets animal, and since S29 the face of its project's chat
// (projectChat.ts). This file is the pure part: which pet a lead is and the
// colour its chat is tinted with, the lead's latest reply, whether a lead is
// calling you, and what you've seen. Kept free of the app so its tests run
// under plain Node.
import { COATS, coatFor, FRAMES, type CritterKind } from "../vendor/pixel-pets/frames.ts";
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

/** Personalities that suit each animal, offered beside free text: the
 *  pet is the lead, so it talks like one. */
export const PERSONALITY_PRESETS: Record<CritterKind, string[]> = {
  cat: ["dry and brief", "aloof, a little smug, usually right", "curious, notices the small things"],
  dog: ["warm, cheers me on", "eager and loyal, keen to help", "upbeat, celebrates every merge"],
  turtle: ["calm and unhurried", "patient and steady, never rushes me", "plain-spoken, thinks before it talks"],
  frog: ["chirpy and playful", "laid back, takes things easy", "jumps straight to the point"],
  leopard: ["sharp and quick, no wasted words", "confident, backs its calls"],
  bobcat: ["scrappy and blunt", "independent, says what it would do"],
  jaguar: ["quiet authority, few words", "sees the whole picture, sums it up"],
};

/** The presets for a pet; any kind without its own gets the cat's. */
export const personalityPresets = (kind: string): string[] => PERSONALITY_PRESETS[kind as CritterKind] ?? PERSONALITY_PRESETS.cat;

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

/** Relative luminance of a `#rrggbb` colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const [r, g, b] = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The colour a lead's chat is tinted with (S29): its coat's base colour,
 *  from pixel-pets' coats. A coat too dark or too pale to tint with on
 *  either theme (a black cat, a white one) gives way to its stripes, then
 *  its shade, then its muzzle. */
export function petTint(p: LeadPet): string {
  const c = coatFor(p.kind, p.coat);
  return [c.O, c.D, c.S, c.W].find((x) => {
    const l = luminance(x);
    return l >= 0.08 && l <= 0.7;
  }) ?? c.O;
}

/** The ink for words on a tint (a button, a badge): the app's dark ink or
 *  white, whichever has the higher contrast against it (WCAG's ratio), so a
 *  pale coat's button gets dark words. */
export const DARK_INK = "#121726";
export const LIGHT_INK = "#ffffff";
export function inkOn(tint: string): string {
  const l = luminance(tint);
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(l, luminance(DARK_INK)) >= ratio(l, 1) ? DARK_INK : LIGHT_INK;
}

/** WCAG's contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A tint to fill a button or badge with: the tint itself when its ink
 *  reads at 4.5:1 or better, else the tint lightened toward white until
 *  dark ink does (a mid grey-blue coat, say). */
export function solidTint(tint: string): string {
  if (contrast(tint, inkOn(tint)) >= 4.5) return tint;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(tint.trim());
  if (!m) return tint;
  const rgb = m.slice(1).map((h) => parseInt(h, 16));
  for (let k = 0.05; k <= 1; k += 0.05) {
    const hex = `#${rgb.map((c) => Math.round(c + (255 - c) * k).toString(16).padStart(2, "0")).join("")}`;
    if (contrast(hex, DARK_INK) >= 4.5) return hex;
  }
  return "#ffffff";
}

// ---- the avatar ----

/** The square of a pet's `sit` frame its round avatar shows, in the
 *  frame's pixels: its face, close up, with a little chest under it. The
 *  circle is the square's inscribed circle, so each box is sized to keep
 *  the eyes, ears and cheeks inside it. Big cats are drawn from the cat's
 *  frames, so they share its box. The box may run past the frame's edge;
 *  that part is the tint. */
export interface FaceBox {
  x: number;
  y: number;
  size: number;
}

const CAT_FACE: FaceBox = { x: 6, y: -1.5, size: 15 };
export const FACE: Record<CritterKind, FaceBox> = {
  cat: CAT_FACE,
  leopard: CAT_FACE,
  bobcat: CAT_FACE,
  jaguar: CAT_FACE,
  dog: { x: 5, y: -1.5, size: 15 },
  // Seen from the side: its head, with the front of its shell.
  turtle: { x: 16.5, y: 6.5, size: 11 },
  // All face: its eyes sit on top, so the box is wide.
  frog: { x: 3.5, y: -4.5, size: 20 },
};

/** The frames an avatar can show: the face is where `sit` has it in both. */
export type FaceFrame = "sit" | "blink";

/** The rows of `kind`'s `frame`, for its avatar. */
export const faceRows = (kind: CritterKind, frame: FaceFrame = "sit") => FRAMES[kind][frame];

export const petKey = (p: LeadPet) => `${p.kind}:${p.coat}`;

export function petFromKey(key: string): LeadPet | null {
  const [kind, coat] = key.split(":");
  return validPet({ kind, coat });
}

export function petLabel(p: LeadPet): string {
  return PET_CHOICES.find((c) => c.kind === p.kind && c.coat === p.coat)?.label ?? kindLabel(p.kind);
}

// ---- the reply, in a line ----

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

/** The last reply of a lead you saw in its chat: its entry and when it was
 *  said. A restarted session numbers its entries from 0 again, so a reply
 *  is seen by its time when that's known, not by its number alone. */
export interface Seen {
  n: number;
  /** Unix seconds; missing on a mark saved before S29. */
  at?: number;
}

/** Whether `seen` covers `reply`: said no later than the reply you saw.
 *  An old mark without a time goes by entry number. */
export function seenCovers(seen: Seen | null, reply: LeadReply): boolean {
  if (!seen) return false;
  return seen.at !== undefined ? reply.at <= seen.at : reply.n <= seen.n;
}

/** Whether a lead has something for you: its latest reply asks you
 *  (`ASK_USER:`, or an ASK line), or it's unread, since you last opened its
 *  chat (`seen`). `asks`, when given, is how many of the reply's ASK lines
 *  are still open (the app took them, and they aren't answered), in place
 *  of counting the lines in its text. */
export function callState(o: { reply: LeadReply | null; unseen: boolean; seen: Seen | null; actions?: boolean; asks?: number }): Call {
  const { reply } = o;
  if (!reply) return QUIET;
  if (seenCovers(o.seen, reply)) return QUIET;
  const asks = o.asks !== undefined ? askCount(reply.text) + o.asks : askCount(reply.text, o.actions);
  if (asks > 0) return { calling: true, count: asks, why: "ask" };
  if (o.unseen) return { calling: true, count: 1, why: "unread" };
  return QUIET;
}

// ---- which leads ----

/** The top lead's chat. */
export const ALL_PROJECTS = "All projects";

export interface LeadEntry {
  /** The lead's thread. */
  agentId: string;
  /** Its project's id, or null for the top lead. */
  projectId: string | null;
  /** "<project> lead", or "Top lead". */
  title: string;
  /** What its chat is called (S29): the project's name, or "All projects". */
  name: string;
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
  if (top && live(top.agentId)) out.push({ agentId: top.agentId, projectId: null, title: "Top lead", name: ALL_PROJECTS, model: top.model, pet: petOf(top, null), acts: false });
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
      name: r.name,
      model: r.lead.model,
      pet: petOf(r.lead, r.name),
      acts: r.lead.acts === true,
    });
  return out;
}

// ---- what you've seen ----

const SEEN_KEY = "observatory.leadChat.seen";

function loadSeen(): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** The last reply of `agentId`'s thread you saw in its chat, or null. A
 *  mark saved before S29 is a bare entry number. */
export function seenInChat(agentId: string): Seen | null {
  const v = loadSeen()[agentId];
  if (typeof v === "number") return { n: v };
  if (v && typeof v === "object" && typeof (v as Seen).n === "number")
    return typeof (v as Seen).at === "number" ? { n: (v as Seen).n, at: (v as Seen).at } : { n: (v as Seen).n };
  return null;
}

/** You saw reply `n`, said at `at`: kept unless a later reply was seen, so
 *  it never goes backwards, and a restarted session's new replies (its
 *  numbers from 0 again, its times later) still call. */
export function markSeenInChat(agentId: string, n: number, at: number) {
  try {
    const all = loadSeen();
    const was = seenInChat(agentId);
    if (was?.at !== undefined && was.at >= at) return;
    all[agentId] = { n, at };
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    // Without storage a lead calls again next launch.
  }
}
