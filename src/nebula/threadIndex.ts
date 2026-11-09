// The thread index: one short entry per past thread (finished or archived),
// so the router can send a follow-up back to the thread that holds its
// context instead of starting over. An entry is what's already known about
// a thread (its title, branch, PR, tags, and S7's one-line need or the
// latest turn summary), never its transcript. Kept app-side in
// localStorage; threadIndexRunner.ts keeps it current. This module holds the
// entry, the update and the search, pure, so the tests run under plain Node.
import { useSyncExternalStore } from "react";

/** Most of a summary kept. */
export const SUMMARY_CHARS = 200;
/** Matches per item, and past threads per router call. */
export const PER_ITEM = 10;
export const MAX_PAST = 30;

export interface IndexPr {
  number: number;
  title: string;
}

export interface IndexEntry {
  id: string;
  projectId: string;
  title: string;
  branch: string;
  pr: IndexPr | null;
  tags: string[];
  /** S7's need line, else the latest turn summary, at most SUMMARY_CHARS. */
  summary: string;
  archived: boolean;
  /** When it was archived (ms), when it is. */
  archivedAt?: number;
  /** When the thread last changed (ms): the newest win ties in a search. */
  at: number;
}

export type ThreadIndex = Record<string, IndexEntry>;

/** What's known of a thread now. A field that's unknown now (the branch or
 *  PR of a worktree since removed) keeps what the entry had. */
export interface IndexSource {
  id: string;
  projectId: string;
  title: string;
  branch?: string | null;
  pr?: IndexPr | null;
  tags: string[];
  /** S7's need line for it (triage.ts), when it has one. */
  need?: string | null;
  /** Its latest turn in a few words (turnsummary.ts), when read. */
  turnSummary?: string | null;
  archived: boolean;
  archivedAt?: number;
  at: number;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => {
  const one = oneLine(s);
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** A thread's entry: only the fields above, the summary clipped. */
export function indexEntry(src: IndexSource, prev?: IndexEntry): IndexEntry {
  const summary = oneLine(src.need ?? "") || oneLine(src.turnSummary ?? "") || prev?.summary || "";
  const pr = src.pr === undefined ? (prev?.pr ?? null) : src.pr ? { number: src.pr.number, title: oneLine(src.pr.title) } : (prev?.pr ?? null);
  const entry: IndexEntry = {
    id: src.id,
    projectId: src.projectId,
    title: oneLine(src.title),
    branch: src.branch || prev?.branch || "",
    pr,
    tags: [...src.tags],
    summary: clip(summary, SUMMARY_CHARS),
    archived: src.archived,
    at: src.at,
  };
  if (src.archived && (src.archivedAt || prev?.archivedAt)) entry.archivedAt = src.archivedAt || prev?.archivedAt;
  return entry;
}

const same = (a: IndexEntry | undefined, b: IndexEntry) => !!a && JSON.stringify(a) === JSON.stringify(b);

/** The index after a refresh: each source's entry made or updated, and
 *  entries for threads nebula no longer has dropped. The same object back
 *  when nothing changed, so a caller can skip the write. */
export function refreshIndex(index: ThreadIndex, sources: IndexSource[], exists: (id: string) => boolean): ThreadIndex {
  let changed = false;
  const next: ThreadIndex = {};
  for (const [id, e] of Object.entries(index)) {
    if (exists(id)) next[id] = e;
    else changed = true;
  }
  for (const src of sources) {
    const entry = indexEntry(src, next[src.id]);
    if (same(next[src.id], entry)) continue;
    next[src.id] = entry;
    changed = true;
  }
  return changed ? next : index;
}

// ---- search ----

/** Words too common to say two things are related. */
const STOP = new Set(
  "a an and are as at be been but by can do does for from get got has have i if in into is it its just me my no not of on or our please so that the then this to up us was we were will with you your again also still now some any all more make sure".split(
    " ",
  ),
);

/** The words in a text that count for a match: lower case, no stop words,
 *  a plural's s dropped. */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.add(raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

function entryWords(e: IndexEntry): Set<string> {
  return words([e.title, e.summary, e.tags.join(" "), e.branch, e.pr ? `${e.pr.number} ${e.pr.title}` : ""].join(" "));
}

/** The entries that best match an item: by words shared with the title,
 *  summary, tags, branch and PR, then by words shared with the title, then
 *  the newest. At most `n`, and none that share no word. */
export function searchIndex(entries: Iterable<IndexEntry>, text: string, n = PER_ITEM): IndexEntry[] {
  const want = words(text);
  if (!want.size) return [];
  const scored: { e: IndexEntry; score: number; title: number }[] = [];
  for (const e of entries) {
    const has = entryWords(e);
    let score = 0;
    for (const w of want) if (has.has(w)) score++;
    if (!score) continue;
    const t = words(e.title);
    let title = 0;
    for (const w of want) if (t.has(w)) title++;
    scored.push({ e, score, title });
  }
  scored.sort((a, b) => b.score - a.score || b.title - a.title || b.e.at - a.e.at);
  return scored.slice(0, n).map((s) => s.e);
}

/** The past threads one router call gets: each item's best matches, taken
 *  in turn (every item's first, then every item's second, …) so no item
 *  crowds out the rest, each thread once, at most `max`. Threads in
 *  `exclude` (the open sessions, listed already) are left out. */
export function pastThreadsFor(
  items: { text: string; context?: string[] }[],
  index: ThreadIndex,
  exclude: Set<string> = new Set(),
  max = MAX_PAST,
): IndexEntry[] {
  const pool = Object.values(index).filter((e) => !exclude.has(e.id));
  const lists = items.map((i) => searchIndex(pool, [i.text, ...(i.context ?? [])].join(" "), PER_ITEM));
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  for (let rank = 0; rank < PER_ITEM && out.length < max; rank++) {
    for (const list of lists) {
      const e = list[rank];
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
      if (out.length >= max) break;
    }
  }
  return out;
}

// ---- the review's line ----

const DAY = 24 * 3600_000;

/** "archived 5 days ago", "archived today", or "finished" for one not archived. */
export function pastState(e: { archived: boolean; archivedAt?: number }, now = Date.now()): string {
  if (!e.archived) return "finished";
  if (!e.archivedAt) return "archived";
  const days = Math.floor((now - e.archivedAt) / DAY);
  return days <= 0 ? "archived today" : days === 1 ? "archived 1 day ago" : `archived ${days} days ago`;
}

/** The routing review's line for a task sent back to a past thread. */
export function followsUpText(e: { title: string; archived: boolean; archivedAt?: number }, now = Date.now()): string {
  return `Follows up ${e.title} (${pastState(e, now)})`;
}

// ---- storage ----

const KEY = "observatory.threadIndex";

const isStr = (x: unknown): x is string => typeof x === "string";

/** Only well-formed entries, and only their own fields: nothing else gets
 *  stored, whatever was handed in. */
function clean(raw: unknown): ThreadIndex {
  const out: ThreadIndex = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<IndexEntry>;
    if (!e || !isStr(e.title) || !isStr(e.projectId)) continue;
    const pr = e.pr && typeof e.pr.number === "number" && isStr(e.pr.title) ? { number: e.pr.number, title: e.pr.title } : null;
    const entry: IndexEntry = {
      id,
      projectId: e.projectId,
      title: e.title,
      branch: isStr(e.branch) ? e.branch : "",
      pr,
      tags: Array.isArray(e.tags) ? e.tags.filter(isStr) : [],
      summary: isStr(e.summary) ? clip(e.summary, SUMMARY_CHARS) : "",
      archived: e.archived === true,
      at: typeof e.at === "number" ? e.at : 0,
    };
    if (entry.archived && typeof e.archivedAt === "number") entry.archivedAt = e.archivedAt;
    out[id] = entry;
  }
  return out;
}

let index: ThreadIndex | null = null;
const listeners = new Set<() => void>();

export function loadIndex(): ThreadIndex {
  if (index) return index;
  try {
    index = clean(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    index = {};
  }
  return index;
}

export function saveIndex(next: ThreadIndex) {
  index = clean(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(index));
  } catch {
    // Without storage the index lasts until the app quits.
  }
  listeners.forEach((l) => l());
}

/** Drop what's in memory and read from storage again (tests, mostly). */
export function reloadIndex() {
  index = null;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThreadIndex(): ThreadIndex {
  return useSyncExternalStore(subscribe, loadIndex);
}
