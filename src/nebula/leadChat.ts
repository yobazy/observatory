// A lead as its pet (S27): each lead (lead.ts, and S26's top lead) is a
// pixel-pets animal, and since S29 the face of its project's chat
// (projectChat.ts). This file is the pure part: which pet a lead is and the
// colour its chat is tinted with, the lead's latest reply, whether a lead is
// calling you, and what you've seen. Kept free of the app so its tests run
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
