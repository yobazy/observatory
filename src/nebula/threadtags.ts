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
  /** Set when the prompt gave no tag: the key of the tag list it was asked
   *  against (tagging.ts), so it's asked again once the list changes. */
  list?: string;
}

export interface ThreadTagPrefs {
  threadTagLists?: Record<string, string[]>;
  threadTags?: Record<string, ThreadTagRecord>;
  /** A color for some of a project's tags, by repo path, then tag: a
   *  PROJECT_COLORS name. */
  threadTagColors?: Record<string, Record<string, string>>;
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
  // The color goes with the name; merging into a tag keeps that tag's own.
  const { [from]: color, ...colors } = prefs.threadTagColors?.[repo] ?? {};
  if (color && !colors[name]) colors[name] = color;
  return retag(
    { ...withColors(prefs, repo, colors), threadTagLists: { ...prefs.threadTagLists, [repo]: renamed } },
    ids,
    (tags) => (tags.includes(from) ? unique(tags.map((t) => (t === from ? name : t))) : tags),
  );
}

/** `tag` out of the project's list and off every thread that carries it. */
export function deleteTag<P extends ThreadTagPrefs>(prefs: P, repo: string, tag: string, ids?: Iterable<string>): P {
  const list = tagList(prefs, repo);
  if (!list.includes(tag)) return prefs;
  const { [tag]: _gone, ...colors } = prefs.threadTagColors?.[repo] ?? {};
  return retag(
    { ...withColors(prefs, repo, colors), threadTagLists: { ...prefs.threadTagLists, [repo]: list.filter((t) => t !== tag) } },
    ids,
    (tags) => tags.filter((t) => t !== tag),
  );
}

/** The project's tag colors set to `colors`, its entry dropped when empty. */
function withColors<P extends ThreadTagPrefs>(prefs: P, repo: string, colors: Record<string, string>): P {
  if (!prefs.threadTagColors?.[repo] && !Object.keys(colors).length) return prefs;
  const threadTagColors = { ...prefs.threadTagColors };
  if (Object.keys(colors).length) threadTagColors[repo] = colors;
  else delete threadTagColors[repo];
  return { ...prefs, threadTagColors };
}

/** The tag's color (a PROJECT_COLORS name), or null when it has none. */
export function tagColor(prefs: ThreadTagPrefs, repo: string, tag: string): string | null {
  return prefs.threadTagColors?.[repo]?.[tag] ?? null;
}

/** A color for one of the project's tags; null takes it off. A tag that
 *  isn't in the list gets none. */
export function setTagColor<P extends ThreadTagPrefs>(prefs: P, repo: string, tag: string, color: string | null): P {
  if (!tagList(prefs, repo).includes(tag)) return prefs;
  const { [tag]: _was, ...colors } = prefs.threadTagColors?.[repo] ?? {};
  return withColors(prefs, repo, color ? { ...colors, [tag]: color } : colors);
}

/** The thread's tags as set by you, from its menu: cleared ones included,
 *  so the tagging prompt leaves it alone after. */
export function setThreadTags<P extends ThreadTagPrefs>(prefs: P, agentId: string, tags: string[], at = Date.now()): P {
  const record: ThreadTagRecord = { tags: unique(tags.map(cleanTag).filter(Boolean)), by: "you", at };
  return { ...prefs, threadTags: { ...prefs.threadTags, [agentId]: record } };
}

/** `tag` on (or off) each of several threads at once, as you, from the
 *  menu for picked threads. Their other tags stay as they are. */
export function tagThreads<P extends ThreadTagPrefs>(prefs: P, agentIds: string[], tag: string, on: boolean, at = Date.now()): P {
  const name = cleanTag(tag);
  if (!name) return prefs;
  return agentIds.reduce((next, id) => {
    const tags = threadTagsOf(next, id);
    return setThreadTags(next, id, on ? [...tags, name] : tags.filter((t) => t !== name), at);
  }, prefs);
}

/** How many of several threads carry `tag`: all, some or none of them. */
export function tagShare(prefs: ThreadTagPrefs, agentIds: string[], tag: string): "all" | "some" | "none" {
  const n = agentIds.filter((id) => threadTagsOf(prefs, id).includes(tag)).length;
  return n === 0 ? "none" : n === agentIds.length ? "all" : "some";
}

/** The chips on after clicking `tag`: off when it was on, else added. */
export function toggleChip(active: string[], tag: string): string[] {
  return active.includes(tag) ? active.filter((t) => t !== tag) : [...active, tag];
}

/** Whether the thread passes the chips: it carries every one that's on.
 *  Every thread does when none is. */
export function hasTag(prefs: ThreadTagPrefs, agentId: string, active: readonly string[]): boolean {
  if (!active.length) return true;
  const tags = threadTagsOf(prefs, agentId);
  return active.every((t) => tags.includes(t));
}

/** The threads the chips show, in the order given. */
export function filterThreads<T extends Tagged>(threads: T[], prefs: ThreadTagPrefs, active: readonly string[]): T[] {
  return threads.filter((t) => hasTag(prefs, t.id, active));
}

/** The tags any of `agentIds` carry, each once, in the order first met. */
export function carriedTags(prefs: ThreadTagPrefs, agentIds: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of agentIds) for (const t of threadTagsOf(prefs, id)) out.add(t);
  return [...out];
}

/** Whether a thread answers a "#tag" query: one of its tags starts with
 *  what's typed after the `#`, as projects' own tags do in the sidebar. */
export function threadAnswersTag(prefs: ThreadTagPrefs, agentId: string, query: string): boolean {
  const want = cleanTag(query);
  return !!want && threadTagsOf(prefs, agentId).some((t) => t.startsWith(want));
}

/** The chip a "#tag" filter turns on in a project with tags `list`: the
 *  tag itself, else the first that starts with it; none when neither. */
export function chipFor(filter: string | null, list: string[]): string[] {
  const want = filter ? cleanTag(filter) : "";
  if (!want) return [];
  const tag = list.includes(want) ? want : list.find((t) => t.startsWith(want));
  return tag ? [tag] : [];
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
 *  search reads) and carries the chips' tags, when either is on. */
export function threadShows(
  prefs: ThreadTagPrefs,
  agentId: string,
  active: readonly string[],
  terms: string[],
  text: (string | null | undefined)[],
): boolean {
  return hasTag(prefs, agentId, active) && hasTerms(terms, text);
}
