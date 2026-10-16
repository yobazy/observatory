// Ideas: things to do that you don't want to start yet, kept by project (or
// Unsorted) with a priority and a deadline. The list's rules — order, what's
// due, grouping, filtering — live here, free of the app, so their tests run
// under plain Node; ideas.ts keeps them in the desktop prefs.

export type Priority = "high" | "medium" | "low";

export interface Idea {
  id: string;
  text: string;
  /** The project's repo path; null is Unsorted. */
  project: string | null;
  tags?: string[];
  priority?: Priority | null;
  /** YYYY-MM-DD, local. */
  deadline?: string | null;
  /** When it was written down, ms. */
  createdAt: number;
  /** Where it came from: quick capture, a thread (its agent id), Dispatch, the Ideas view. */
  source?: { kind: "capture" | "thread" | "dispatch" | "ideas"; agent?: string };
  /** Done by hand, ms. */
  doneAt?: number | null;
  /** Started as a task: the agent's id, or "dispatch" when sent there. */
  startedAs?: string | null;
}

export const PRIORITIES: Priority[] = ["high", "medium", "low"];
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Days counted as "soon" before a deadline. */
export const SOON_DAYS = 2;

/** Today, YYYY-MM-DD in local time. */
export function localDay(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Whole days from `today` to `day` (both YYYY-MM-DD); negative is past. */
export function daysUntil(day: string, today: string): number {
  const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(day) - ms(today)) / 86_400_000);
}

export function isOpen(i: Idea): boolean {
  return !i.doneAt && !i.startedAs;
}

/** Whether an open idea's deadline has passed, is near, or neither. */
export function due(i: Idea, today: string): "overdue" | "soon" | null {
  if (!i.deadline || !isOpen(i)) return null;
  const d = daysUntil(i.deadline, today);
  return d < 0 ? "overdue" : d <= SOON_DAYS ? "soon" : null;
}

/** How a deadline reads: "today", "tomorrow", "in 5 days", "2 days late", or the date. */
export function dueLabel(deadline: string, today: string): string {
  const d = daysUntil(deadline, today);
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  if (d === -1) return "a day late";
  if (d < 0) return `${-d} days late`;
  if (d <= 14) return `due in ${d} days`;
  return `due ${deadline}`;
}

export type SortBy = "priority" | "deadline" | "newest";

/** Ideas in order: by priority (deadline breaks ties), by deadline (no
 *  deadline last, priority breaks ties), or newest first. Overdue ones lead
 *  either way but newest, so what's late isn't buried. */
export function sortIdeas(ideas: Idea[], by: SortBy, today: string): Idea[] {
  const prio = (i: Idea) => (i.priority ? RANK[i.priority] : 3);
  const dl = (i: Idea) => (i.deadline ? daysUntil(i.deadline, today) : Number.POSITIVE_INFINITY);
  const late = (i: Idea) => (due(i, today) === "overdue" ? 0 : 1);
  return [...ideas].sort((a, b) => {
    if (by === "newest") return b.createdAt - a.createdAt;
    const head = late(a) - late(b);
    if (head) return head;
    const first = by === "priority" ? prio(a) - prio(b) : dl(a) - dl(b);
    if (first) return first;
    const second = by === "priority" ? dl(a) - dl(b) : prio(a) - prio(b);
    return second || b.createdAt - a.createdAt;
  });
}

export interface IdeaFilter {
  query?: string;
  /** A repo path, "unsorted", or undefined for every project. */
  project?: string;
  /** Open (not done or started), done (either), or all. */
  show?: "open" | "done" | "all";
  priority?: Priority | null;
  /** Only overdue or due soon. */
  dueOnly?: boolean;
}

export function filterIdeas(ideas: Idea[], f: IdeaFilter, today: string): Idea[] {
  const q = f.query?.trim().toLowerCase() ?? "";
  const tagQ = q.startsWith("#") ? q.slice(1) : null;
  return ideas.filter((i) => {
    const show = f.show ?? "open";
    if (show === "open" && !isOpen(i)) return false;
    if (show === "done" && isOpen(i)) return false;
    if (f.project === "unsorted" ? i.project !== null : f.project && i.project !== f.project) return false;
    if (f.priority && i.priority !== f.priority) return false;
    if (f.dueOnly && !due(i, today)) return false;
    if (tagQ !== null) return !tagQ || (i.tags ?? []).some((t) => t.startsWith(tagQ));
    return !q || i.text.toLowerCase().includes(q) || (i.tags ?? []).some((t) => t.includes(q));
  });
}

/** Ideas by project: Unsorted first, then projects in `order` (repo paths,
 *  as the sidebar shows them), then any project not in it. Each group keeps
 *  the order it was given. */
export function groupIdeas(ideas: Idea[], order: string[]): { project: string | null; ideas: Idea[] }[] {
  const groups = new Map<string | null, Idea[]>();
  for (const i of ideas) groups.set(i.project, [...(groups.get(i.project) ?? []), i]);
  const rank = (p: string | null) => (p === null ? -1 : order.includes(p) ? order.indexOf(p) : order.length);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([project, list]) => ({ project, ideas: list }));
}

/** Open ideas per project repo path (null is Unsorted), for "Ideas (N)". */
export function openCounts(ideas: Idea[]): Map<string | null, number> {
  const n = new Map<string | null, number>();
  for (const i of ideas) if (isOpen(i)) n.set(i.project, (n.get(i.project) ?? 0) + 1);
  return n;
}
