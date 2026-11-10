// Budget holds: once spend is over the daily or weekly budget (or one
// project is over its card's own daily budget), Dispatch's pending tasks
// wait instead of launching. Nothing running is stopped, and replies go as
// usual: only `nextLaunchable()`'s pick is held. Pure, so the tests load it
// in Node; budget.ts and batchRunner.ts wire it to the store.
// Value imports name their .ts files: the tests load this module in Node.
import { nextLaunchable, type BatchTask, type Limits } from "./batch.ts";
import { costOf, sessionKey, summarize, type UsageReport } from "./usageData.ts";
import type { Cards } from "./cards.ts";
import type { State } from "./store";
import type { Agent } from "./types";

/** Which projects the money went to, biggest first. */
export interface ProjectSpend {
  label: string;
  cost: number;
}

export interface BudgetState {
  kind: "daily" | "weekly";
  label: string;
  spent: number;
  budget: number;
  /** spent / budget. */
  share: number;
  /** The projects that spent the most in the budget's window. */
  top: ProjectSpend[];
}

/** A project over its card's own daily budget. */
export interface ProjectHold {
  projectId: string;
  name: string;
  spent: number;
  budget: number;
}

export interface Holds {
  /** The daily or weekly budget that's over, holding every pending task. */
  budget: BudgetState | null;
  /** Projects over their own daily budget, by project id. */
  projects: Record<string, ProjectHold>;
}

export type Hold = { kind: "budget"; budget: BudgetState } | { kind: "project"; project: ProjectHold };

export const NO_HOLDS: Holds = { budget: null, projects: {} };

/** How many projects a budget names as where its money went. */
const TOP = 2;

type UsageState = Pick<State, "usage" | "prefs" | "projects" | "worktrees" | "agents">;

const topOf = (rows: { label: string; cost: number }[]): ProjectSpend[] =>
  rows
    .filter((r) => r.cost > 0)
    .slice(0, TOP)
    .map((r) => ({ label: r.label, cost: r.cost }));

const daySummary = (report: UsageReport, s: UsageState, now: number) => summarize(report, s as State, { days: 1, now });

/** Where spend stands against each budget that's set, with the projects it
 *  went to. `now` is in seconds. */
export function budgets(s: UsageState, now = Date.now() / 1000): BudgetState[] {
  const { dailyBudget, weeklyBudget } = s.prefs;
  if (!s.usage || (!dailyBudget && !weeklyBudget)) return [];
  const out: BudgetState[] = [];
  if (dailyBudget && dailyBudget > 0) {
    const sum = daySummary(s.usage, s, now);
    const spent = sum.today.cost;
    out.push({ kind: "daily", label: "today", spent, budget: dailyBudget, share: spent / dailyBudget, top: topOf(sum.projects) });
  }
  if (weeklyBudget && weeklyBudget > 0) {
    const sum = summarize(s.usage, s as State, { days: 7, now });
    const spent = sum.range.cost;
    out.push({
      kind: "weekly",
      label: "the last 7 days",
      spent,
      budget: weeklyBudget,
      share: spent / weeklyBudget,
      top: topOf(sum.projects),
    });
  }
  return out;
}

/** The worst of the budgets: "over", "near" (80%+), or null. */
export function budgetLevel(list: BudgetState[]): "over" | "near" | null {
  if (list.some((b) => b.share >= 1)) return "over";
  if (list.some((b) => b.share >= 0.8)) return "near";
  return null;
}

/** The budget that's over (the furthest over when both are), or null. */
export function budgetHold(list: BudgetState[]): BudgetState | null {
  let worst: BudgetState | null = null;
  for (const b of list) if (b.share >= 1 && (!worst || b.share > worst.share)) worst = b;
  return worst;
}

/** Projects whose card sets a daily budget that today's spend has reached. */
export function projectHolds(s: UsageState, cards: Cards, now = Date.now() / 1000): Record<string, ProjectHold> {
  const out: Record<string, ProjectHold> = {};
  const capped = Object.entries(cards).filter(([, c]) => (c.dailyBudget ?? 0) > 0);
  if (!s.usage || !capped.length) return out;
  const rows = new Map(daySummary(s.usage, s, now).projects.map((r) => [r.key, r]));
  for (const [id, c] of capped) {
    const spent = rows.get(id)?.cost ?? 0;
    if (spent >= c.dailyBudget!) {
      out[id] = { projectId: id, name: s.projects[id]?.name ?? rows.get(id)?.label ?? "This project", spent, budget: c.dailyBudget! };
    }
  }
  return out;
}

/** Everything holding launches right now. */
export function holds(s: UsageState, cards: Cards, now = Date.now() / 1000): Holds {
  return { budget: budgetHold(budgets(s, now)), projects: projectHolds(s, cards, now) };
}

/** What holds a task back, or null when it may launch. Only pending tasks
 *  are held, and "Start anyway" lets one through. */
export function holdOn(t: BatchTask, h: Holds): Hold | null {
  if (t.state !== "pending" || t.budgetOverride) return null;
  if (h.budget) return { kind: "budget", budget: h.budget };
  const p = t.target === "project" && t.projectId ? h.projects[t.projectId] : undefined;
  return p ? { kind: "project", project: p } : null;
}

/** The pending tasks to launch this pass: `nextLaunchable()`'s pick, less
 *  any a budget holds. Held tasks stay `pending`; nothing else changes. */
export function launchPick(
  tasks: BatchTask[],
  agents: Record<string, Agent>,
  limits: Limits,
  h: Holds,
  now = Date.now(),
): BatchTask[] {
  return nextLaunchable(tasks, agents, { ...limits, held: (t) => !!holdOn(t, h) }, now);
}

/** Known cost per agent session over the report's range (30 days). */
export function costBySession(report: UsageReport | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!report) return out;
  for (const b of report.buckets) {
    const cost = costOf(b, b.model);
    const key = sessionKey(b.source, b.session);
    if (cost !== null) out.set(key, (out.get(key) ?? 0) + cost);
  }
  return out;
}

/** Whole dollars from $10 up, cents below: "$52", "$4.50". */
export function dollars(n: number): string {
  if (n >= 10) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
}

const windowText = (b: BudgetState) => (b.kind === "daily" ? "today" : "in the last 7 days");

/** A held row's line: "Held: $52 of $50 today". */
export function holdText(hold: Hold): string {
  if (hold.kind === "project") {
    const p = hold.project;
    return `Held: ${p.name} is at ${dollars(p.spent)} of ${dollars(p.budget)} today`;
  }
  const b = hold.budget;
  return `Held: ${dollars(b.spent)} of ${dollars(b.budget)} ${windowText(b)}`;
}

/** Where a budget's money went: "nebula-desktop $30, general $12". */
export function topLine(b: BudgetState): string {
  return b.top.map((p) => `${p.label} ${dollars(p.cost)}`).join(", ");
}

/** The board's count: "3 held by budget", or null when none are. */
export function holdSummary(tasks: BatchTask[], h: Holds): string | null {
  const n = tasks.filter((t) => holdOn(t, h)).length;
  return n ? `${n} held by budget` : null;
}
