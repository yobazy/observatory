// Project cards: what lives in each project and how tasks run there, so
// Dispatch's router has something to route against. A card is drafted from
// the notes a project keeps for agents (CLAUDE.md, AGENTS.md, skills) and its
// README, then edited by hand. Like dispatch.ts, it keeps its own small
// store in localStorage rather than a slot in store.ts, so drafting and
// storage can be tested without the rest of the app.
//
// Cards are keyed by project id. Home, where errands and scheduling run, can
// be a project's card flagged `isHome`, or a plain folder that isn't a nebula
// project: that card is keyed `folder:<path>` and exists only while it's Home.
import { useSyncExternalStore } from "react";

/** Isolated: each task gets its own worktree. Shared: tasks run side by side
 *  in the main checkout, at most `concurrency` at once. */
export type RunPolicy = "isolated" | "shared";

export interface ProjectCard {
  /** What lives in the project, in a few sentences. */
  description: string;
  /** Skill names (the folder names under `.claude/skills`). */
  skills: string[];
  /** Each skill's own description, from its SKILL.md frontmatter, by name. */
  skillNotes: Record<string, string>;
  /** Kinds of task that belong here, e.g. "job applications". */
  taskKinds: string[];
  policy: RunPolicy;
  /** How many tasks may run at once under the Shared policy; at least 1. */
  concurrency: number;
  isHome: boolean;
  /** The folder Home's sessions run in; null unless this card is Home. */
  homeFolder: string | null;
  /** How Home books time for tasks ("check my calendar, ask, then book it").
   *  Empty: nothing is scheduled, `you` tasks just wait on the board. */
  schedulingInstruction: string;
}

/** A file a card is drafted from, its path relative to the project root. */
export interface SourceFile {
  path: string;
  text: string;
}

export interface CardSources {
  files: SourceFile[];
  isGitRepo: boolean;
}

const KEY = "observatory.cards";
/** Longest drafted description; the rest is the user's to add. */
export const MAX_DESCRIPTION = 400;
const FOLDER = "folder:";

/** The key of a Home card for a plain folder. */
export const folderKey = (path: string) => FOLDER + path;
export const isFolderKey = (key: string) => key.startsWith(FOLDER);

/** YAML frontmatter at the top of a Markdown file, and the body after it. */
function splitFrontmatter(text: string): { front: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: "", body: text };
}

/** A frontmatter field's value: inline, quoted, or a `>`/`|` block below it. */
function frontField(front: string, name: string): string {
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^${name}\\s*:`).test(l));
  if (at < 0) return "";
  const inline = lines[at].replace(/^[^:]*:\s*/, "").trim();
  if (inline && !/^[>|][+-]?$/.test(inline)) return inline.replace(/^(["'])(.*)\1$/, "$2").trim();
  const block: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (!/^\s/.test(l) && l.trim()) break;
    block.push(l.trim());
  }
  return block.join(" ").replace(/\s+/g, " ").trim();
}

/** Cut `text` to `max` characters at a word, marking the cut. */
function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The first prose paragraphs of a Markdown file, up to `max` characters:
 *  headings, code, tables, badges, HTML and rules are skipped. */
export function excerpt(markdown: string, max = MAX_DESCRIPTION): string {
  const { body } = splitFrontmatter(markdown);
  const paragraphs: string[] = [];
  let current: string[] = [];
  let fenced = false;
  const end = () => {
    if (current.length) paragraphs.push(current.join(" "));
    current = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      end();
      continue;
    }
    if (fenced) continue;
    const skip =
      !line ||
      /^#{1,6}(\s|$)/.test(line) ||
      /^(<|\|)/.test(line) ||
      /^\[?!\[/.test(line) ||
      /^([-*_])(\s*\1){2,}$/.test(line) ||
      /^=+$|^-+$/.test(line);
    if (skip) end();
    else current.push(line);
    if (paragraphs.join(" ").length >= max || paragraphs.length >= 2) break;
  }
  end();
  // Inline Markdown that reads as noise in a plain-text description.
  const text = paragraphs
    .slice(0, 2)
    .join("\n\n")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, "$1");
  return cap(text.trim(), max);
}

/** Where a description is drafted from, in order of preference. */
const DESCRIBED_BY = [/^CLAUDE\.md$/i, /^AGENTS\.md$/i, /^README/i];
const SKILL = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/i;

/** A first card for a project, from its files: the first meaningful
 *  paragraphs of CLAUDE.md, AGENTS.md or the README, and its skills. A git
 *  repo starts Isolated; a plain folder can't have worktrees, so Shared. */
export function draftCard(sources: CardSources): ProjectCard {
  let description = "";
  for (const re of DESCRIBED_BY) {
    for (const f of sources.files.filter((f) => re.test(f.path))) {
      description ||= excerpt(f.text);
    }
  }
  const skills: string[] = [];
  const skillNotes: Record<string, string> = {};
  for (const f of sources.files) {
    const name = SKILL.exec(f.path)?.[1];
    if (!name || skills.includes(name)) continue;
    skills.push(name);
    const note = frontField(splitFrontmatter(f.text).front, "description");
    if (note) skillNotes[name] = cap(note, 200);
  }
  return {
    description,
    skills,
    skillNotes,
    taskKinds: [],
    policy: sources.isGitRepo ? "isolated" : "shared",
    concurrency: 1,
    isHome: false,
    homeFolder: null,
    schedulingInstruction: "",
  };
}

/** The card under another policy. Shared starts at one task at a time. */
export function withPolicy(card: ProjectCard, policy: RunPolicy): ProjectCard {
  return { ...card, policy, concurrency: normalConcurrency(card.concurrency) };
}

export function withConcurrency(card: ProjectCard, n: number): ProjectCard {
  return { ...card, concurrency: normalConcurrency(n) };
}

const normalConcurrency = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;

/** Whether Home can book time for `you` tasks: it has an instruction for it. */
export function canSchedule(home: ProjectCard | null | undefined): boolean {
  return !!home?.isHome && home.schedulingInstruction.trim() !== "";
}

/** A comma- or newline-separated field as a list, blanks and repeats dropped. */
export function splitList(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);

/** A stored card as a whole one: missing or bad fields get their defaults. */
function normalize(x: unknown): ProjectCard | null {
  if (!x || typeof x !== "object") return null;
  const c = x as Partial<ProjectCard>;
  const notes = c.skillNotes && typeof c.skillNotes === "object" ? c.skillNotes : {};
  return {
    description: typeof c.description === "string" ? c.description : "",
    skills: strings(c.skills),
    skillNotes: Object.fromEntries(Object.entries(notes).filter(([, v]) => typeof v === "string")),
    taskKinds: strings(c.taskKinds),
    policy: c.policy === "shared" ? "shared" : "isolated",
    concurrency: normalConcurrency(c.concurrency),
    isHome: c.isHome === true,
    homeFolder: typeof c.homeFolder === "string" ? c.homeFolder : null,
    schedulingInstruction: typeof c.schedulingInstruction === "string" ? c.schedulingInstruction : "",
  };
}

export type Cards = Record<string, ProjectCard>;

/** The saved cards, as last written; none when there are none or they can't be read. */
export function loadCards(): Cards {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const out: Cards = {};
    for (const [k, v] of Object.entries(raw?.cards ?? {})) {
      const card = normalize(v);
      if (card) out[k] = card;
    }
    return out;
  } catch {
    return {};
  }
}

let cards: Cards | null = null;
const listeners = new Set<() => void>();

export function allCards(): Cards {
  return (cards ??= loadCards());
}

export function cardFor(key: string): ProjectCard | null {
  return allCards()[key] ?? null;
}

/** Drop what's in memory and read the cards from storage again. */
export function reloadCards() {
  cards = loadCards();
  listeners.forEach((l) => l());
}

function write(next: Cards) {
  cards = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ cards: next }));
  } catch {
    // Without storage the cards last until the app quits.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCards(): Cards {
  return useSyncExternalStore(subscribe, allCards);
}

/** There is one Home: when another card had it, it's cleared. A plain
 *  folder's card goes with it, since it's a card only for being Home. */
function withoutOtherHomes(all: Cards, key: string): Cards {
  const out: Cards = {};
  for (const [k, c] of Object.entries(all)) {
    if (k === key || !c.isHome) out[k] = c;
    else if (!isFolderKey(k)) out[k] = { ...c, isHome: false, homeFolder: null };
  }
  return out;
}

/** Save a card. Flagging it Home takes Home from whichever card had it. A
 *  plain folder's card is always Home and always Shared. */
export function saveCard(key: string, card: ProjectCard) {
  let next = normalize(card)!;
  if (isFolderKey(key)) {
    next = { ...withPolicy(next, "shared"), isHome: true, homeFolder: next.homeFolder ?? key.slice(FOLDER.length) };
  }
  if (!next.isHome) next.homeFolder = null;
  const all = next.isHome ? withoutOtherHomes(allCards(), key) : { ...allCards() };
  all[key] = next;
  write(all);
}

export function removeCard(key: string) {
  const { [key]: _gone, ...rest } = allCards();
  write(rest);
}

/** Home's card and its key, or null when nothing is Home. */
export function homeCard(all: Cards = allCards()): { key: string; card: ProjectCard } | null {
  const hit = Object.entries(all).find(([, c]) => c.isHome);
  return hit ? { key: hit[0], card: hit[1] } : null;
}

/** Nothing is Home any more. */
export function clearHome() {
  write(withoutOtherHomes(allCards(), ""));
}

/** The card key for a folder picked as Home: the project's, when it is one. */
export function homeKeyFor(path: string, projects: { id: string; repo_path: string }[]): string {
  const trimmed = path.replace(/\/+$/, "");
  return projects.find((p) => p.repo_path.replace(/\/+$/, "") === trimmed)?.id ?? folderKey(trimmed);
}

/** Make a folder Home: its card (the project's, or a new one drafted from
 *  `sources`) flagged Home, running there. A folder that isn't a git repo
 *  has no worktrees to isolate tasks in, so it runs them Shared. */
export function setHomeFolder(key: string, folder: string, sources: CardSources): ProjectCard {
  const base = cardFor(key) ?? draftCard(sources);
  const card = sources.isGitRepo ? base : withPolicy(base, "shared");
  saveCard(key, { ...card, isHome: true, homeFolder: folder });
  return cardFor(key)!;
}
