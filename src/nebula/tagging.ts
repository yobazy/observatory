// The tagging prompt: untagged threads go to the user's agent CLI, headless,
// with the project's tags, and the tags it picks are stored as the prompt's
// (threadtags.ts). Tags you set from a thread's menu, cleared ones included,
// are never sent and never changed. This module picks the threads, builds
// the prompt, reads the reply and applies it, and runs a pass given its
// effects; taggingRunner.ts wires that to the app. Pure, so its tests run
// under Node. Value imports name their .ts files for the same reason.
import { cleanTag } from "./folders.ts";
import { extractJson } from "./router.ts";
import { tagList, type ThreadTagPrefs, type ThreadTagRecord } from "./threadtags.ts";
import type { ThreadEdit } from "./threadfiles";

/** Threads per call, how much of a first prompt goes in, and how many of
 *  the files a thread touched. */
export const BATCH_SIZE = 20;
export const MAX_PROMPT_CHARS = 1000;
export const MAX_FILES = 30;

/** A thread as the tagging pass reads it: an agent, and its checkout. */
export interface TagSource {
  id: string;
  name: string;
  recent_prompts: { text: string }[];
  /** The checkout it runs in, which its file paths are made relative to. */
  root: string;
}

/** A thread as the prompt shows it. */
export interface TagThread {
  id: string;
  title: string;
  firstPrompt: string;
  files: string[];
}

export type TagReply = { ok: true; threads: Record<string, string[]> } | { ok: false; error: string };

/** A short key for a tag list, order aside: what a thread given no tag was
 *  asked against. */
export function listKey(list: string[]): string {
  let h = 5381;
  for (const c of [...list].sort().join("\n")) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** The threads to send: those with no record, and those the prompt gave no
 *  tag against an older tag list. None when the project has no tags. */
export function toTag<T extends { id: string }>(threads: T[], prefs: ThreadTagPrefs, repo: string): T[] {
  const list = tagList(prefs, repo);
  if (!list.length) return [];
  const key = listKey(list);
  return threads.filter((t) => {
    const rec = prefs.threadTags?.[t.id];
    return !rec || (rec.by === "prompt" && rec.tags.length === 0 && rec.list !== key);
  });
}

const norm = (path: string) => path.replace(/\/+$/, "").replace(/^\/private\//, "/");

/** `t` as the prompt shows it: its first prompt clipped, and the files it
 *  touched last first, relative to its checkout (or the repo). */
export function tagThread(t: TagSource, edits: ThreadEdit[], repo: string): TagThread {
  const bases = [norm(t.root), norm(repo)].filter(Boolean).map((b) => `${b}/`);
  const files: string[] = [];
  for (const e of [...edits].sort((a, b) => b.at - a.at)) {
    const path = norm(e.path);
    const base = bases.find((b) => path.startsWith(b));
    const rel = base ? path.slice(base.length) : path;
    if (!files.includes(rel)) files.push(rel);
    if (files.length === MAX_FILES) break;
  }
  return { id: t.id, title: t.name, firstPrompt: (t.recent_prompts[0]?.text ?? "").slice(0, MAX_PROMPT_CHARS), files };
}

/** `items` in runs of at most `size`. */
export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The prompt for one call: the project's tags once, then each thread. JSON
 *  out, only. */
export function buildTagPrompt(tags: string[], threads: TagThread[]): string {
  const L = [
    "You tag coding-agent threads with the tags of the project they're in. Reply with JSON only: one object, no prose, no code fence.",
    "",
    `Tags: ${tags.join(", ")}`,
    "",
    "Rules:",
    "- Give a thread only tags from the list above, and only those its work is clearly for. A thread that fits none gets [].",
    "- Judge by its title, first prompt and the files it touched.",
    "- Every thread below goes in the reply once, by its id.",
    "",
    "Reply shape:",
    '{"threads":[{"id":"<thread id>","tags":["<tag>"]}]}',
    "",
    "Threads:",
  ];
  for (const t of threads) {
    L.push(`- [${t.id}] ${oneLine(t.title)}`);
    if (t.firstPrompt.trim()) L.push(`  first prompt: ${JSON.stringify(t.firstPrompt)}`);
    if (t.files.length) L.push(`  files: ${t.files.join(", ")}`);
  }
  return L.join("\n");
}

/** The reply's tags per thread, cleaned and kept to the project's list.
 *  Ids that weren't sent are ignored, and a thread left out of the reply
 *  gets no record (it's sent again next pass). One error when the reply
 *  isn't a JSON object with a `threads` list. */
export function parseTagReply(text: string, sent: string[], list: string[]): TagReply {
  const json = extractJson(text ?? "");
  if (json === null) return { ok: false, error: "The tagging reply had no JSON in it." };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `The tagging reply wasn't valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const rows = (raw as { threads?: unknown })?.threads;
  if (!Array.isArray(rows)) return { ok: false, error: 'The tagging reply had no "threads" list.' };
  const ids = new Set(sent);
  const allowed = new Set(list);
  const threads: Record<string, string[]> = {};
  for (const row of rows) {
    const id = (row as { id?: unknown })?.id;
    if (typeof id !== "string" || !ids.has(id)) continue;
    const given = (row as { tags?: unknown }).tags;
    const tags = Array.isArray(given) ? given.filter((t): t is string => typeof t === "string").map(cleanTag) : [];
    threads[id] = [...new Set(tags.filter((t) => allowed.has(t)))];
  }
  return { ok: true, threads };
}

/** The reply stored as the prompt's tags, against the prefs as they are
 *  now: a thread you tagged meanwhile keeps yours, and a tag deleted
 *  meanwhile isn't put back. `key` is the list it was asked against. */
export function applyTagReply<P extends ThreadTagPrefs>(
  prefs: P,
  repo: string,
  threads: Record<string, string[]>,
  key: string,
  at: number,
): P {
  const list = new Set(tagList(prefs, repo));
  const threadTags = { ...prefs.threadTags };
  for (const [id, given] of Object.entries(threads)) {
    if (threadTags[id]?.by === "you") continue;
    const tags = given.filter((t) => list.has(t));
    const record: ThreadTagRecord = tags.length ? { tags, by: "prompt", at } : { tags: [], by: "prompt", at, list: key };
    threadTags[id] = record;
  }
  return { ...prefs, threadTags };
}

// ---- a pass ----

export interface TagProject {
  repo: string;
  threads: TagSource[];
}

/** What a pass does to the world, given so it can be tested without it. */
export interface PassDeps {
  /** The `tagCommand` pref; empty or unset is off. */
  command: string | undefined;
  /** The prefs as they are now, read again before each project. */
  prefs: () => ThreadTagPrefs;
  projects: TagProject[];
  /** The files each thread touched, by thread id (thread_edits). */
  edits: (threads: TagSource[]) => Promise<Record<string, ThreadEdit[]>>;
  /** One call of the CLI (tag_threads): the prompt in, its reply out. */
  run: (prompt: string, tags: string[], threads: TagThread[]) => Promise<string>;
  /** Write a change to the prefs, worked out against them as they are then. */
  save: (change: (prefs: ThreadTagPrefs) => ThreadTagPrefs) => Promise<unknown>;
  now?: () => number;
}

export interface PassResult {
  /** CLI calls made. */
  calls: number;
  /** Threads sent, and how many of them came back with a tag. */
  sent: number;
  tagged: number;
  errors: string[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One pass: each project with tags, its threads that need them, in calls
 *  of at most BATCH_SIZE. A failed call is an error and changes nothing;
 *  the other calls still go. */
export async function tagPass(deps: PassDeps): Promise<PassResult> {
  const result: PassResult = { calls: 0, sent: 0, tagged: 0, errors: [] };
  if (!deps.command?.trim()) return result;
  const now = deps.now ?? Date.now;
  for (const project of deps.projects) {
    const list = tagList(deps.prefs(), project.repo);
    const todo = toTag(project.threads, deps.prefs(), project.repo);
    if (!todo.length) continue;
    // Files are a hint: without them the title and prompt still go.
    const edits = await deps.edits(todo).catch(() => ({}) as Record<string, ThreadEdit[]>);
    const key = listKey(list);
    for (const batch of batches(todo.map((t) => tagThread(t, edits[t.id] ?? [], project.repo)))) {
      result.calls++;
      result.sent += batch.length;
      let reply: TagReply;
      try {
        reply = parseTagReply(await deps.run(buildTagPrompt(list, batch), list, batch), batch.map((t) => t.id), list);
      } catch (e) {
        reply = { ok: false, error: errText(e) };
      }
      if (!reply.ok) {
        result.errors.push(reply.error);
        continue;
      }
      const threads = reply.threads;
      await deps.save((prefs) => applyTagReply(prefs, project.repo, threads, key, now()));
      result.tagged += Object.values(threads).filter((t) => t.length).length;
    }
  }
  return result;
}

/** What the browser preview answers with, having no CLI: each thread gets
 *  the tags its title or first prompt names. */
export function previewTagReply(tags: string[], threads: TagThread[]): string {
  return JSON.stringify({
    threads: threads.map((t) => {
      const text = `${t.title}\n${t.firstPrompt}`.toLowerCase();
      return { id: t.id, tags: tags.filter((tag) => text.includes(tag)) };
    }),
  });
}
