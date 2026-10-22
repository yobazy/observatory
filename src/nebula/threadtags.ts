// Tags on threads: each project's own list of tags (by repo path, in the
// order added), and which of them each thread carries (by agent id). The
// desktop app's own marks, like task colors; nebula knows none of it. These
// aren't the project tags in folders.ts, which tag projects for the sidebar.
// Pure, so its tests run under Node; organize.ts writes the results.
// Value imports name their .ts files: the tests load this module in Node.
import { cleanTag } from "./folders.ts";

/** A thread's tags, and who set them: you from its menu, or the tagging
 *  prompt. `[]` set by you stays, so the prompt leaves the thread alone. */
export interface ThreadTagRecord {
  tags: string[];
  by: "you" | "prompt";
  at: number;
}

export interface ThreadTagPrefs {
  threadTagLists?: Record<string, string[]>;
  threadTags?: Record<string, ThreadTagRecord>;
}

/** A thread as far as tags go: its id. */
interface Tagged {
  id: string;
}

/** The project's tags, in the order added. */
export function tagList(prefs: ThreadTagPrefs, repo: string): string[] {
  return prefs.threadTagLists?.[repo] ?? [];
}

/** The thread's tags, none when it has no record. */
export function threadTagsOf(prefs: ThreadTagPrefs, agentId: string): string[] {
  return prefs.threadTags?.[agentId]?.tags ?? [];
}

const unique = (tags: string[]) => [...new Set(tags)];

/** `name`, cleaned, at the end of the project's list. Null when nothing is
 *  left of it after cleaning; the prefs as they were when it's there already. */
export function addTag<P extends ThreadTagPrefs>(prefs: P, repo: string, name: string): P | null {
  const tag = cleanTag(name);
  if (!tag) return null;
  const list = tagList(prefs, repo);
  if (list.includes(tag)) return prefs;
  return { ...prefs, threadTagLists: { ...prefs.threadTagLists, [repo]: [...list, tag] } };
}

/** Every thread record `change` touches, among `ids` when given (the
 *  project's threads, so another project's same-named tag is left alone). */
function retag<P extends ThreadTagPrefs>(prefs: P, ids: Iterable<string> | undefined, change: (tags: string[]) => string[]): P {
  const only = ids && new Set(ids);
  const threadTags = Object.fromEntries(
    Object.entries(prefs.threadTags ?? {}).map(([id, rec]) => [id, only && !only.has(id) ? rec : { ...rec, tags: change(rec.tags) }]),
  );
  return { ...prefs, threadTags };
}

/** `from` renamed to `to` (cleaned) in the list, in the same place, and on
 *  every thread that carries it. A name already in the list merges with it.
 *  Null when `to` cleans to nothing. */
export function renameTag<P extends ThreadTagPrefs>(prefs: P, repo: string, from: string, to: string, ids?: Iterable<string>): P | null {
  const name = cleanTag(to);
  if (!name) return null;
  const list = tagList(prefs, repo);
  if (!list.includes(from) || name === from) return prefs;
  const renamed = unique(list.map((t) => (t === from ? name : t)));
  return retag({ ...prefs, threadTagLists: { ...prefs.threadTagLists, [repo]: renamed } }, ids, (tags) =>
    tags.includes(from) ? unique(tags.map((t) => (t === from ? name : t))) : tags,
  );
}

/** `tag` out of the project's list and off every thread that carries it. */
export function deleteTag<P extends ThreadTagPrefs>(prefs: P, repo: string, tag: string, ids?: Iterable<string>): P {
  const list = tagList(prefs, repo);
  if (!list.includes(tag)) return prefs;
  return retag({ ...prefs, threadTagLists: { ...prefs.threadTagLists, [repo]: list.filter((t) => t !== tag) } }, ids, (tags) =>
    tags.filter((t) => t !== tag),
  );
}

/** The thread's tags as set by you, from its menu: cleared ones included,
 *  so the tagging prompt leaves it alone after. */
export function setThreadTags<P extends ThreadTagPrefs>(prefs: P, agentId: string, tags: string[], at = Date.now()): P {
  const record: ThreadTagRecord = { tags: unique(tags.map(cleanTag).filter(Boolean)), by: "you", at };
  return { ...prefs, threadTags: { ...prefs.threadTags, [agentId]: record } };
}

/** Whether the thread passes the chip: every thread does when none is on. */
export function hasTag(prefs: ThreadTagPrefs, agentId: string, active: string | null): boolean {
  return !active || threadTagsOf(prefs, agentId).includes(active);
}

/** The threads the chip shows, in the order given. */
export function filterThreads<T extends Tagged>(threads: T[], prefs: ThreadTagPrefs, active: string | null): T[] {
  return threads.filter((t) => hasTag(prefs, t.id, active));
}

/** How many of `threads` carry each of the project's tags. */
export function tagCounts(threads: Tagged[], prefs: ThreadTagPrefs, repo: string): Map<string, number> {
  const counts = new Map(tagList(prefs, repo).map((t) => [t, 0]));
  for (const t of threads)
    for (const tag of threadTagsOf(prefs, t.id)) if (counts.has(tag)) counts.set(tag, counts.get(tag)! + 1);
  return counts;
}

/** A search's words, each of which must appear somewhere in a row. */
export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function hasTerms(terms: string[], parts: (string | null | undefined)[]): boolean {
  const text = parts.filter(Boolean).join("\n").toLowerCase();
  return terms.every((t) => text.includes(t));
}

/** Whether a thread's row shows: it matches the search (`text` is what the
 *  search reads) and carries the chip's tag, when either is on. */
export function threadShows(
  prefs: ThreadTagPrefs,
  agentId: string,
  active: string | null,
  terms: string[],
  text: (string | null | undefined)[],
): boolean {
  return hasTag(prefs, agentId, active) && hasTerms(terms, text);
}
