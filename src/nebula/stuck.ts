// Stuck and over-budget sessions, flagged in the triage queue (triage.ts).
// Two checks, both without a model call: the latest turn hitting the same
// error over and over (from its steps, turns.rs), and a session that's
// spent most of its budget (in the usage view's API-equivalent dollars)
// since your last prompt to it, or for a Dispatch task since it launched.
// Either one makes the session's label `stuck`, with the reason as its need,
// whatever the model said. A flag holds until the session runs again (you
// replied, or redirected it) or you press "Got it"; a budget flag put down
// by Got it comes back only at 100% of the same spend. Nothing is stopped or
// archived on its own. Pure, so the tests load it in Node; triageRunner.ts
// runs it in the triage pass, and the 85%/100% banners go through notify.ts.
// Value imports name their .ts files so the tests run under plain Node.
//
// Later stories read the flags: `loadStuck()` / `useStuck()` give a
// `StuckEntry` per agent id, and `stuckNeed()` its reason while it's up.
import { useSyncExternalStore } from "react";
import { dollars } from "./budgetHold.ts";
import { costOf, type Tokens, type UsageReport } from "./usageData.ts";
import type { Batch } from "./batch.ts";
import type { Step, Turn } from "./turnsummary.ts";
import type { AgentKind, AgentStatus, PromptEntry } from "./types";

/** A session's budget when neither Settings nor its task sets one. */
export const DEFAULT_TASK_BUDGET = 10;
/** The share of its budget at which a session is flagged, and banners. */
export const NEAR = 0.85;
/** Failures of one error that make a session stuck. */
export const REPEATS = 3;
/** How far back the error check looks: the turn's latest steps. */
export const LAST_STEPS = 20;
/** The error's length in the need line. */
export const ERROR_CHARS = 60;

export type StuckKind = "errors" | "budget";

/** Why a session is stuck. `mark` says which flag this is: putting one
 *  down doesn't put down the next (another turn's errors, or 100%). */
export interface StuckFlag {
  kind: StuckKind;
  reason: string;
  mark: string;
}

// ---- repeated errors ----

const clip = (s: string, max: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** An error with what changes between runs taken out: timestamps, paths,
 *  long hex ids and numbers. Two errors are the same when these match. */
export function errorKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})?/g, " ")
    .replace(/\b\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\b/g, " ")
    .replace(/(?<![\w.@+-])(?:[a-z]:)?(?:~|\.{1,2})?(?:[\\/][\w.@+-]+)+[\\/]?/g, " ")
    .replace(/\b[0-9a-f]{7,}\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** Lines that say a call failed but not how. */
const BARE = /^(exit code \d+|error:?|command failed.*|<\/?tool_use_error>)$/i;

/** What a failed step said, in a line: its result's first telling line, or
 *  else the tool and what it acted on. */
export function errorText(step: Pick<Step, "tool" | "target" | "error">): string {
  const lines = (step.error ?? "")
    .split("\n")
    .map((l) => l.replace(/<\/?tool_use_error>/g, "").trim())
    .filter(Boolean);
  const telling = lines.find((l) => !BARE.test(l));
  if (telling) return telling;
  const what = step.target.split("\n")[0].trim();
  return what ? `${step.tool} ${what} failed` : `${step.tool} failed`;
}

/** The error that failed most often in the turn's latest steps, and how
 *  often. Errors compare by `errorKey()`, and by tool. */
export function repeatedError(steps: Pick<Step, "tool" | "target" | "error" | "ok">[]): { count: number; text: string; key: string } | null {
  const seen = new Map<string, { count: number; text: string }>();
  for (const s of steps.slice(-LAST_STEPS)) {
    if (s.ok !== false) continue;
    const text = errorText(s);
    const key = `${s.tool}|${errorKey(text) || errorKey(s.target)}`;
    const was = seen.get(key);
    // The latest wording is the one shown.
    seen.set(key, { count: (was?.count ?? 0) + 1, text });
  }
  let best: { count: number; text: string; key: string } | null = null;
  for (const [key, v] of seen) if (!best || v.count > best.count) best = { ...v, key };
  return best;
}

/** An error as the need shows it: no timestamps, and paths down to their
 *  file name, so the part that says what went wrong fits. */
export function shownError(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, "")
    .replace(/(?<![\w.@+-])(?:[A-Za-z]:)?(?:~|\.{1,2})?(?:[\\/][\w.@+-]+)*[\\/]([\w.@+-]+)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The turn's flag when one error failed REPEATS times or more. */
export function errorFlag(turn: Pick<Turn, "number" | "steps"> | null | undefined): StuckFlag | null {
  if (!turn) return null;
  const r = repeatedError(turn.steps);
  if (!r || r.count < REPEATS) return null;
  return { kind: "errors", reason: `Same error ${r.count} times: ${clip(shownError(r.text), ERROR_CHARS)}`, mark: `errors:${turn.number}:${r.key}` };
}

// ---- budget ----

/** A session's budget: its Dispatch task's own, else Settings', else $10. */
export function taskBudget(agentId: string, batches: Batch[], pref: number | undefined): number {
  for (const b of batches)
    for (const t of b.tasks) if (t.agentId === agentId && typeof t.budget === "number" && t.budget > 0) return t.budget;
  return pref && pref > 0 ? pref : DEFAULT_TASK_BUDGET;
}

/** What a session has spent toward its budget, and from when (ms): since
 *  your last prompt to it, or since its Dispatch task launched. */
export interface Spend {
  cost: number;
  from: number;
  since: "prompt" | "task";
}
/** By agent id. */
export type Spent = Map<string, Spend>;

/** A timestamp in ms, whether it came in seconds or ms. */
const ms = (t: number) => (t < 1e12 ? t * 1000 : t);

/** Where a session's spend counts from: its Dispatch task's launch, else
 *  your last prompt to it (the newer of nebula's prompt list and its latest
 *  turn's start, which turns.rs dates from the prompt you typed). Null when
 *  neither is known: nothing is counted then. */
export function spendStart(
  agent: { id: string; recent_prompts: PromptEntry[] },
  batches: Batch[],
  turnStarted?: number | null,
): { from: number; since: Spend["since"] } | null {
  for (const b of batches) for (const t of b.tasks) if (t.agentId === agent.id && t.launchedAt) return { from: t.launchedAt, since: "task" };
  let from = turnStarted ? ms(turnStarted) : 0;
  for (const p of agent.recent_prompts) from = Math.max(from, ms(p.submitted_at));
  return from > 0 ? { from, since: "prompt" } : null;
}

/** Priced token rows (usage_since: one per session and model, counted per
 *  response from the start point on), by session id. */
export function priceRows(rows: (Tokens & { session: string; model: string })[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const cost = costOf(r, r.model);
    if (cost !== null) out.set(r.session, (out.get(r.session) ?? 0) + cost);
  }
  return out;
}

/** A session's spend from `from` (ms) in the hourly usage report, for
 *  sources with no per-response times: hours after it in full, and the hour
 *  it falls in for the share of that hour after it. */
export function spendInBuckets(report: UsageReport | null, kind: AgentKind, session: string, from: number): number {
  if (!report) return 0;
  const start = from / 1000;
  let total = 0;
  for (const b of report.buckets) {
    if (b.source !== kind || b.session !== session || b.hour + 3600 <= start) continue;
    const cost = costOf(b, b.model);
    if (cost === null) continue;
    total += b.hour >= start ? cost : (cost * (b.hour + 3600 - start)) / 3600;
  }
  return total;
}

/** "since your last message" / "since the task started", for the board. */
export const sinceText = (s: Spend["since"]) => (s === "task" ? "since the task started" : "since your last message");

/** Whole percent, down, without float dust (8.7 / 10 is 87%). */
const percent = (share: number) => Math.floor(share * 100 + 1e-9);

/** 100 once it's over, 85 from NEAR, else 0. */
export const budgetStep = (share: number) => (share >= 1 ? 100 : share >= NEAR ? 85 : 0);

/** The flag once the spend reaches NEAR of the budget. `from`, where the
 *  spend counts from, is part of its mark: a new prompt starts a new count,
 *  which can flag again at 85%. */
export function budgetFlag(cost: number, budget: number, from = 0): StuckFlag | null {
  if (!(budget > 0)) return null;
  const share = cost / budget;
  const step = budgetStep(share);
  if (!step) return null;
  return { kind: "budget", reason: `Used ${percent(share)}% of its ${dollars(budget)} budget`, mark: `budget:${from}:${step}:${budget}` };
}

const spendFlag = (spend: Spend | undefined, budget: number) => (spend ? budgetFlag(spend.cost, budget, spend.from) : null);

export interface StuckInput {
  /** The session's latest turn, for its steps. */
  turn?: Pick<Turn, "number" | "steps"> | null;
  /** What it's spent since its start point, and its budget, in dollars. */
  cost?: number;
  budget?: number;
}

/** The flag that counts: repeated errors first, then the budget. */
export function stuckFlag(input: StuckInput, cleared: string[] = []): StuckFlag | null {
  const flags = [errorFlag(input.turn), budgetFlag(input.cost ?? 0, input.budget ?? DEFAULT_TASK_BUDGET)];
  return flags.find((f) => f && !cleared.includes(f.mark)) ?? null;
}

/** Why a session is stuck, in the queue's words, or null. */
export function stuckReason(input: StuckInput, cleared: string[] = []): string | null {
  return stuckFlag(input, cleared)?.reason ?? null;
}

// ---- the flag, held ----

/** What's kept per session: its turn's error flag as last read (and the
 *  state it was read in), the flag that's up, and those put down. Never
 *  the steps themselves. */
export interface StuckEntry {
  /** `${status}|${status_changed_at}` when its turn was last read. */
  read?: string;
  /** When that turn started (ms): your last prompt, for spendStart(). */
  turnStarted?: number;
  errors?: StuckFlag | null;
  /** The flag up, since when (ms), and the session's status then. */
  raised?: StuckFlag & { at: number; status: AgentStatus };
  /** Marks put down, latest last. */
  cleared?: string[];
}
export type StuckEntries = Record<string, StuckEntry>;

const KEEP_CLEARED = 8;

type Moment = { status: AgentStatus; status_changed_at: number };

/** Whether the session ran again since its flag went up: it started a turn
 *  after then (a flag raised mid-turn holds through that turn's end). */
export function ranSince(raised: { at: number; status: AgentStatus }, s: Moment): boolean {
  if (s.status_changed_at <= raised.at) return false;
  return s.status === "running" || raised.status !== "running";
}

const putDown = (e: StuckEntry, mark: string): string[] => [...(e.cleared ?? []).filter((m) => m !== mark), mark].slice(-KEEP_CLEARED);

/** The entry once `budget` (this moment's budget flag) is weighed: a flag
 *  that ran again since goes down, and the one that counts now goes up.
 *  Returns the same entry when nothing changed. */
export function settle(e: StuckEntry, s: Moment, budget: StuckFlag | null, now: number): StuckEntry {
  let next = e;
  if (e.raised && ranSince(e.raised, s)) next = { ...next, raised: undefined, cleared: putDown(e, e.raised.mark) };
  const cleared = next.cleared ?? [];
  const flag = [next.errors ?? null, budget].find((f) => f && !cleared.includes(f.mark)) ?? null;
  if (!flag) return next.raised ? { ...next, raised: undefined } : next;
  if (next.raised?.mark === flag.mark)
    return next.raised.reason === flag.reason ? next : { ...next, raised: { ...next.raised, reason: flag.reason } };
  return { ...next, raised: { ...flag, at: now, status: s.status } };
}

/** "Got it" on a stuck row: its flag goes down for good. */
export function gotIt(e: StuckEntry | undefined): StuckEntry | undefined {
  if (!e?.raised) return e;
  return { ...e, raised: undefined, cleared: putDown(e, e.raised.mark) };
}

/** The reason showing for a session, while its flag is up. */
export function stuckNeed(entries: StuckEntries, id: string): string | null {
  return entries[id]?.raised?.reason ?? null;
}

// ---- a check, in the triage pass ----

export interface StuckSession extends Moment {
  id: string;
  kind: AgentKind;
  session_id: string | null;
  archived?: boolean;
  /** Labelled stale (idle past the threshold): not checked. */
  stale: boolean;
}

export interface StuckDeps {
  sessions: StuckSession[];
  entries: () => StuckEntries;
  save: (entries: StuckEntries) => void;
  /** Its latest turn (thread_turn), or null when there's no log to read. */
  turn: (s: StuckSession) => Promise<(Pick<Turn, "number" | "steps"> & { started?: number }) | null>;
  /** Each session's spend since its start point, read once the turns are in. */
  spent: () => Spent;
  budget: (id: string) => number;
  now?: number;
}

const stateOf = (s: Moment) => `${s.status}|${s.status_changed_at}`;

/** One check over every open session that isn't stale: a turn is read when
 *  it's running or changed since its last read, and every flag settled.
 *  Writes only when something changed. Sessions nebula no longer has lose
 *  theirs; archived ones keep them. */
export async function stuckCheck(deps: StuckDeps): Promise<StuckEntries> {
  const open = (s: StuckSession) => !s.archived && s.status !== "fresh" && !s.stale;
  // The turns first; the flags are settled after, against what's stored
  // and spent by then, so a settle in the meantime isn't written over.
  const read = new Map<string, { errors: StuckFlag | null; started?: number }>();
  // A turn that couldn't be read is neither "no errors" nor a turn to settle:
  // its flags stay as they are, and it's read again on the next pass.
  const unread = new Set<string>();
  const was = deps.entries();
  for (const s of deps.sessions)
    if (open(s) && (s.status === "running" || was[s.id]?.read !== stateOf(s))) {
      const turn = await deps.turn(s).then(
        (t) => ({ t }),
        () => null,
      );
      if (!turn) {
        unread.add(s.id);
        continue;
      }
      read.set(s.id, { errors: errorFlag(turn.t), started: turn.t?.started ? ms(turn.t.started) : undefined });
    }
  const now = deps.now ?? Date.now();
  const before = deps.entries();
  const spent = deps.spent();
  const out: StuckEntries = {};
  for (const s of deps.sessions) {
    let e = before[s.id] ?? {};
    if (s.archived || s.status === "fresh") {
      // Left as they were, for when it's back.
    } else if (s.stale) {
      // Folded away: no flag up, but what was put down stays down.
      if (e.raised) e = { ...e, raised: undefined };
    } else if (unread.has(s.id)) {
      // Nothing to read this pass: what it had stands.
    } else {
      const r = read.get(s.id);
      if (r) {
        e = { ...e, read: stateOf(s), errors: r.errors };
        if (r.started) e.turnStarted = r.started;
      }
      e = settle(e, s, spendFlag(spent.get(s.id), deps.budget(s.id)), now);
    }
    if (Object.keys(e).length) out[s.id] = e;
  }
  if (JSON.stringify(out) === JSON.stringify(before)) return before;
  deps.save(out);
  return out;
}

/** Settle every flag against spend and status alone, between checks (a
 *  usage scan landed, a session started): no turn is read. */
export function resettle(entries: StuckEntries, sessions: StuckSession[], spent: Spent, budget: (id: string) => number, now: number): StuckEntries | null {
  let changed = false;
  const out: StuckEntries = { ...entries };
  for (const s of sessions) {
    if (s.archived || s.stale || s.status === "fresh") continue;
    const e = entries[s.id] ?? {};
    const next = settle(e, s, spendFlag(spent.get(s.id), budget(s.id)), now);
    if (next !== e) {
      out[s.id] = next;
      changed = true;
    }
  }
  return changed ? out : null;
}

// ---- banners ----

/** Which sessions just crossed 85% or 100% of their budget, for one banner
 *  each. `sent` holds what already went (`id:from:budget:step`); it's updated in
 *  place. With `seen` null (the first look since launch) nothing fires, and
 *  what's already over is marked sent, so a relaunch doesn't banner old
 *  sessions. Crossing 100% straight from below marks 85% too. */
export function budgetNudges(
  rows: { id: string; cost: number; budget: number; from?: number }[],
  sent: Set<string>,
  seen: boolean,
): { id: string; step: 85 | 100; share: number; budget: number }[] {
  const out: { id: string; step: 85 | 100; share: number; budget: number }[] = [];
  for (const r of rows) {
    if (!(r.budget > 0)) continue;
    const share = r.cost / r.budget;
    const step = budgetStep(share);
    if (!step) continue;
    // A new start point (your next prompt) is a new count, with its own banners.
    const key = (n: number) => `${r.id}:${r.from ?? 0}:${r.budget}:${n}`;
    if (sent.has(key(step))) continue;
    sent.add(key(step));
    if (step === 100) sent.add(key(85));
    if (seen) out.push({ id: r.id, step: step as 85 | 100, share, budget: r.budget });
  }
  return out;
}

/** A banner's title: "Search Facets used 87% of its $10 budget". */
export function nudgeTitle(name: string, n: { step: 85 | 100; share: number; budget: number }): string {
  return n.step === 100
    ? `${name} is over its ${dollars(n.budget)} budget`
    : `${name} used ${percent(n.share)}% of its ${dollars(n.budget)} budget`;
}

// ---- storage ----

const KEY = "observatory.triage.stuck";
const SENT_KEY = "observatory.triage.stuck-sent";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    return raw && typeof raw === "object" ? raw : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the flags last until the app quits.
  }
}

let entries: StuckEntries | null = null;
let sent: Set<string> | null = null;
const listeners = new Set<() => void>();

export function loadStuck(): StuckEntries {
  return (entries ??= read<StuckEntries>(KEY, {}));
}

export function saveStuck(next: StuckEntries) {
  entries = next;
  write(KEY, next);
  listeners.forEach((l) => l());
}

/** "Got it" on a session's row. */
export function putDownStuck(id: string) {
  const all = loadStuck();
  const next = gotIt(all[id]);
  if (next !== all[id] && next) saveStuck({ ...all, [id]: next });
}

/** The banners already sent, by `id:from:budget:step`. */
export function loadSent(): Set<string> {
  return (sent ??= new Set(read<string[]>(SENT_KEY, [])));
}

/** Keep the sent banners of sessions that still exist. */
export function saveSent(keep: (id: string) => boolean) {
  const s = loadSent();
  sent = new Set([...s].filter((k) => keep(k.slice(0, k.indexOf(":")))));
  write(SENT_KEY, [...sent]);
}

/** Drop what's in memory and read from storage again (tests, mostly). */
export function reloadStuck() {
  entries = null;
  sent = null;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStuck(): StuckEntries {
  return useSyncExternalStore(subscribe, loadStuck);
}

