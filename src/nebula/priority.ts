// Priorities for tasks and projects: the desktop app's own, kept in the
// desktop prefs beside colors and flags (the daemon, and so the TUI, knows
// none of it). Urgent and high float to the top of their list and low sinks;
// those without one sit between, in the order they had. Pure, so its tests
// run under Node.

export type Priority = "urgent" | "high" | "low";

export const PRIORITIES: { id: Priority; label: string }[] = [
  { id: "urgent", label: "Urgent" },
  { id: "high", label: "High" },
  { id: "low", label: "Low" },
];

export interface PriorityPrefs {
  /** By agent id. */
  taskPriorities?: Record<string, Priority>;
  /** By repo path. */
  projectPriorities?: Record<string, Priority>;
}

const RANK = new Map<string | undefined, number>([
  ["urgent", 0],
  ["high", 1],
  ["low", 3],
]);

/** Where a priority sorts: lower first. None (or one this build doesn't
 *  know, from a hand-edited prefs file) sits between high and low. */
export function rank(p: string | undefined): number {
  return RANK.get(p) ?? 2;
}

export function priorityLabel(p: string | undefined): string | undefined {
  return PRIORITIES.find((x) => x.id === p)?.label;
}

/** The one after `p`, as P steps through them: urgent, high, low, none. */
export function nextPriority(p: string | undefined): Priority | null {
  const i = PRIORITIES.findIndex((x) => x.id === p);
  return i === PRIORITIES.length - 1 ? null : PRIORITIES[i + 1].id;
}

/** `items` by priority, each band keeping the order it had. */
export function byPriority<T>(items: T[], of: (t: T) => string | undefined): T[] {
  return [...items].sort((a, b) => rank(of(a)) - rank(of(b)));
}
