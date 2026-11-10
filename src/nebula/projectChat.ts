// Chat with a project (S29): each project's lead is a chat with its pet,
// not a thread. This file is the pure part: the lead's transcript as chat
// items (your messages, the app's [observatory] lines as small event lines
// in plain words, the lead's replies without their action lines, and under
// each reply the tasks it started and the asks it made), a task's place on
// the card's four steps, the chat row's one-line preview, and today's cost.
// ProjectChat.tsx draws it. Kept free of the app so its tests run under
// plain Node; value imports name their .ts files for that.
import { LINE_PREFIX, RULES_END } from "./lead.ts";
import { actionName, askKey, withoutActions, type AskAction, type Outcome, type StartedState } from "./leadActions.ts";
import { plainLine } from "./leadChat.ts";
import type { Entry } from "./transcript";
import type { UsageReport } from "./usageData";

/** A task a lead started, as the chat shows it under its reply. */
export interface ChatTask {
  taskId: string;
  branch: string;
  /** When it was started (ms). */
  at: number;
  /** The reply whose START it was, when known. */
  n?: number;
  label: StartedState;
  /** Its PR's checks, while it has one open. */
  checks?: { state: string; failing: string[] } | null;
}

export type ChatItem =
  | { kind: "me"; key: string; text: string; at: number }
  | { kind: "event"; key: string; text: string; at: number }
  | { kind: "pet"; key: string; n: number; text: string; at: number }
  | { kind: "task"; key: string; task: ChatTask }
  /** `done` says why an ask can't be answered any more, or null while it
   *  can: answered, asked again later, or overtaken (the PR merged). */
  | { kind: "ask"; key: string; n: number; ask: AskAction; done: string | null };

export interface ChatInput {
  leadId: string;
  /** The lead's started tasks (S28's records, with where each is now). */
  tasks?: readonly ChatTask[];
  /** What each reply made happen (S28): its asks. */
  outcomes?: readonly Outcome[];
  /** Whether an ask was answered, by askKey(). */
  answered?: (key: string) => boolean;
  /** A thread's title, for "Nudged Fix login". */
  name?: (agentId: string) => string | undefined;
  /** Why an ask is overtaken by what's happened since ("#12 is merged",
   *  "That thread is archived"), or null while it still stands. */
  settled?: (ask: AskAction) => string | null;
}

type ChatEntry = Pick<Entry, "n" | "kind" | "text" | "at">;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const upper = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// `<thread title> on <branch> (agent <id>)`, then a PR link, then `: <need>`.
const ABOUT = /^(.*) on (\S+) \(agent ([\w-]+)\)(?: (https?:\/\/\S+))?(?:: ([\s\S]*))?$/;

/** An [observatory] line in plain words: "CI failed on #193: lint",
 *  "Started fix-bottom-clip", "You merged #12". */
export function eventText(line: string, name: (agentId: string) => string | undefined = () => undefined): string {
  const body = oneLine(line.startsWith(LINE_PREFIX) ? line.slice(LINE_PREFIX.length) : line);
  const thread = (id: string) => name(id) ?? id;
  let m: RegExpMatchArray | null;
  // A thread's event (S17, S28): `<kind>[ #n]: <title> on <branch> (agent id)…`.
  if ((m = body.match(/^(finished|failed|needs you|PR opened|CI failed|CI passed|PR merged|safe to close)(?: #(\d+))?: ([\s\S]*)$/))) {
    const [, kind, pr, rest] = m;
    const about = rest.match(ABOUT);
    const title = oneLine(about?.[1] ?? rest);
    const need = oneLine(about?.[5] ?? "").replace(/…$/, "");
    switch (kind) {
      case "finished":
        return `${title} finished`;
      case "failed":
        return need ? `${title} failed: ${need}` : `${title} failed`;
      case "needs you":
        return `${title} needs you`;
      case "PR opened":
        return pr ? `${title} opened #${pr}` : `${title} opened a PR`;
      case "CI failed":
        return `CI failed on #${pr}${need ? `: ${need}` : ""}`;
      case "CI passed":
        return `CI passed on #${pr}`;
      case "PR merged":
        return `#${pr} merged`;
      default:
        return `${title} is safe to close`;
    }
  }
  // What the app did with the lead's action lines (S28).
  if ((m = body.match(/^started (\S+) \(agent [\w-]+\)$/))) return `Started ${m[1]}`;
  if ((m = body.match(/^queued (\S+): (.*)$/))) return `Queued ${m[1]}: ${m[2]}`;
  if ((m = body.match(/^nudged ([\w-]+)$/))) return `Nudged ${thread(m[1])}`;
  if ((m = body.match(/^refused (START|NUDGE|PASS|ASK merge|ASK archive) (.+?): (.*)$/))) {
    const [, what, target, why] = m;
    const verb = { START: "start", NUDGE: "nudge", PASS: "pass work to", "ASK merge": "ask to merge", "ASK archive": "ask to archive" }[what];
    const on = what === "NUDGE" || what === "ASK archive" ? thread(target) : target;
    return `Didn't ${verb} ${on}: ${why}`;
  }
  if ((m = body.match(/^passed to (Lead .+)$/))) return `Passed to ${m[1]}`;
  if ((m = body.match(/^the user (merged|archived) (\S+) \(your ASK\)$/))) return `You ${m[1]} ${m[1] === "archived" ? thread(m[2]) : m[2]}`;
  if ((m = body.match(/^the user said no to (merging|archiving) (\S+)$/))) return `You said no to ${m[1]} ${m[1] === "archiving" ? thread(m[2]) : m[2]}`;
  if ((m = body.match(/^couldn't (merge|archive) (\S+): (.*)$/))) return `Couldn't ${m[1]} ${m[1] === "archive" ? thread(m[2]) : m[2]}: ${m[3]}`;
  if (/^actions are on\b/.test(body)) return "Starting and nudging threads is on";
  if (body === "actions are off") return "Starting and nudging threads is off";
  if ((m = body.match(/^from the top lead: (.*)$/))) return `From the top lead: ${m[1]}`;
  // The top lead's roster (S26): the leads by name, without their paths.
  if ((m = body.match(/^leads: (.*)$/))) {
    const names = m[1] === "none running" ? [] : [...m[1].matchAll(/(Lead[^(,]*?)\s*\(/g)].map((x) => x[1].trim());
    return names.length ? `Leads running: ${names.join(", ")}` : m[1] === "none running" ? "No project leads running" : `Leads: ${m[1]}`;
  }
  return upper(body);
}

/** Where a started task is on the card's four steps (Queued, Running, PR,
 *  Merged), and what its state line says. */
export function taskStep(t: Pick<ChatTask, "label" | "checks">): { step: 0 | 1 | 2 | 3; text: string; tone: "running" | "done" | "bad" | "quiet" } {
  const l = t.label;
  if (l === "queued") return { step: 0, text: "Queued", tone: "running" };
  if (l === "failed") return { step: 0, text: "Didn't start", tone: "bad" };
  if (l === "running") return { step: 1, text: "Running", tone: "running" };
  if (l === "finished") return { step: 1, text: "Finished, no PR yet", tone: "running" };
  if (l === "closed") return { step: 1, text: "Closed", tone: "quiet" };
  if (l === "merged") return { step: 3, text: "Merged", tone: "done" };
  const c = t.checks;
  if (c?.state === "failing") return { step: 2, text: `${l} · checks failing${c.failing.length ? `: ${c.failing.join(", ")}` : ""}`, tone: "bad" };
  if (c?.state === "passing") return { step: 2, text: `${l} · checks passed`, tone: "running" };
  if (c?.state === "pending") return { step: 2, text: `${l} · checks running`, tone: "running" };
  return { step: 2, text: `${l} open`, tone: "running" };
}

/** The lead's transcript as the chat shows it. The starting prompt (the
 *  thread's first entry) is hidden; a message from the app (its lines all
 *  start `[observatory] `) is one event line per line, not your bubble; a
 *  reply loses its action lines (START, NUDGE, ASK, PASS), and one left
 *  empty shows no bubble; under the reply whose START it was, each task it
 *  started, and its asks with whether they're answered. A task from before
 *  S29 (no reply number) goes under the last reply before it started.
 *  "Started"/"Queued" lines for a task with a card are left out: the card
 *  says so. */
export function chatItems(entries: readonly ChatEntry[], input: ChatInput): ChatItem[] {
  const { leadId, tasks = [], outcomes = [], answered = () => false, name, settled = () => null } = input;
  const sorted = [...entries].sort((a, b) => a.n - b.n);
  const carded = new Set(tasks.map((t) => t.branch));
  // Which reply each task goes under: its own, else the last before it.
  const replies = sorted.filter((e) => e.kind === "claude");
  const under = new Map<number, ChatTask[]>();
  const loose: ChatTask[] = [];
  for (const t of [...tasks].sort((a, b) => a.at - b.at)) {
    const n = t.n !== undefined && replies.some((r) => r.n === t.n) ? t.n : [...replies].reverse().find((r) => r.at * 1000 <= t.at)?.n;
    if (n === undefined) loose.push(t);
    else under.set(n, [...(under.get(n) ?? []), t]);
  }
  const asksOf = new Map(outcomes.map((o) => [o.n, o.asks]));
  // An ask is one question however often it's asked: answered once, every
  // row asking it is; asked again, only the latest row stands.
  const answeredNames = new Set<string>();
  const lastAsked = new Map<string, number>();
  for (const o of outcomes)
    for (const a of o.asks) {
      if (answered(askKey(leadId, o.n, a))) answeredNames.add(actionName(a));
      lastAsked.set(actionName(a), Math.max(lastAsked.get(actionName(a)) ?? -1, o.n));
    }
  const doneWhy = (n: number, a: AskAction): string | null => {
    if (answeredNames.has(actionName(a))) return "Answered";
    const over = settled(a);
    if (over) return over;
    return (lastAsked.get(actionName(a)) ?? n) > n ? "Asked again below" : null;
  };

  const out: ChatItem[] = [];
  for (const e of sorted) {
    if (e.kind === "you") {
      // The lead's starting prompt.
      if (e.n === 0) continue;
      const text = e.text.trim();
      if (!text) continue;
      if (text.startsWith(LINE_PREFIX)) {
        // The rules sent when actions are turned on are hidden, like the
        // starting prompt: their example lines aren't events.
        let rules = false;
        text.split("\n").forEach((line, i) => {
          if (rules) {
            if (line.trim().endsWith(RULES_END)) rules = false;
            return;
          }
          if (line.startsWith(`${LINE_PREFIX}actions are on.`)) {
            rules = !line.trim().endsWith(RULES_END);
            return;
          }
          if (!line.startsWith(LINE_PREFIX)) return;
          const said = eventText(line, name);
          const started = /^(?:Started|Queued) (\S+?):?(?: |$)/.exec(said);
          if (started && carded.has(started[1])) return;
          out.push({ kind: "event", key: `e${e.n}.${i}`, text: said, at: e.at });
        });
      } else out.push({ kind: "me", key: `m${e.n}`, text, at: e.at });
    } else if (e.kind === "claude") {
      const text = withoutActions(e.text);
      if (text) out.push({ kind: "pet", key: `p${e.n}`, n: e.n, text, at: e.at });
      for (const t of under.get(e.n) ?? []) out.push({ kind: "task", key: `t${t.taskId}`, task: t });
      for (const a of asksOf.get(e.n) ?? []) {
        const key = askKey(leadId, e.n, a);
        out.push({ kind: "ask", key: `a${key}`, n: e.n, ask: a, done: doneWhy(e.n, a) });
      }
    } else if (e.kind === "stopped") out.push({ kind: "event", key: `s${e.n}`, text: "Stopped", at: e.at });
  }
  // A task with no reply before it (the lead's session was restarted
  // since) goes where its time puts it.
  for (const t of loose) {
    const at = out.findIndex((it) => "at" in it && it.at * 1000 > t.at);
    out.splice(at < 0 ? out.length : at, 0, { kind: "task", key: `t${t.taskId}`, task: t });
  }
  return out;
}

/** The chat row's one line: the lead's latest reply, its action lines and
 *  Markdown marks taken off, at most `max` characters. */
export function chatPreview(reply: string | null | undefined, max = 120): string {
  if (!reply) return "";
  const first = withoutActions(reply)
    .split("\n")
    .map(plainLine)
    .find((l) => l && !/^(```|~~~)/.test(l));
  if (!first) return "";
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

/** A usage report cut to today (local time), for "$0.42 today". */
export function sinceToday(report: UsageReport | null, now = new Date()): UsageReport | null {
  if (!report) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  return { ...report, buckets: report.buckets.filter((b) => b.hour >= start) };
}

/** What the lead is doing, for the foot of its chat: waiting on a prompt
 *  in its terminal (a permission, a choice), which only the terminal can
 *  answer; working on a turn (or with your message on its way); or at rest. */
export function leadActivity(o: { status: string; queued: number; sending: number }): "prompt" | "working" | "idle" {
  if (o.status === "needs_feedback") return "prompt";
  if (o.status === "running" || o.queued > 0 || o.sending > 0) return "working";
  return "idle";
}
