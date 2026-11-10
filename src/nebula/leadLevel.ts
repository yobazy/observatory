// How far a project's lead may go on its own: one of four levels, set per
// project in Settings and on its card, and checked by the app wherever a
// lead acts (leadActions.ts's decide(), the observatory:// links in
// handoffLinks.ts, the top lead's PASS), not only stated in its prompt.
// Decided by the user on 2026-11-10 (option 1A). Kept free of the app so
// its tests run under plain Node.

export type LeadLevel = 1 | 2 | 3 | 4;

/** A new lead's level, and a saved one's that never had one. */
export const DEFAULT_LEVEL: LeadLevel = 2;

export interface LevelInfo {
  level: LeadLevel;
  name: string;
  /** What a lead at this level does, for Settings. */
  what: string;
}

export const LEVELS: readonly LevelInfo[] = [
  { level: 1, name: "Watch", what: "Keeps notes and answers questions. Starts and sends nothing." },
  { level: 2, name: "Suggest", what: "Fills in new tasks and follow-ups for you to send, and asks before it merges or archives." },
  {
    level: 3,
    name: "Act on safe things",
    what: "Starts tasks, sends follow-ups, archives threads that said Safe to close, and removes clean worktrees whose PR merged.",
  },
  { level: 4, name: "Merge and release", what: "Also merges green PRs and cuts releases." },
];

export const levelName = (level: LeadLevel) => LEVELS[level - 1].name;

/** A card's lead's level. One saved before levels with S28's actions
 *  switch on stays acting (3); every other one is Suggest. */
export function levelOf(lead: { level?: unknown; acts?: unknown } | undefined | null): LeadLevel {
  const l = lead?.level;
  if (l === 1 || l === 2 || l === 3 || l === 4) return l;
  return lead?.acts === true ? 3 : DEFAULT_LEVEL;
}

/** Everything a lead does that the app lets through or refuses. */
export type LeadPower =
  | "link" // an observatory:// new-task or follow-up link, prefilled for you
  | "ask" // ASK merge / ASK archive, answered by you
  | "start"
  | "nudge"
  | "archive"
  | "remove"
  | "merge"
  | "release";

/** The level each power needs. */
export const NEEDS: Record<LeadPower, LeadLevel> = {
  link: 2,
  ask: 2,
  start: 3,
  nudge: 3,
  archive: 3,
  remove: 3,
  merge: 4,
  release: 4,
};

const DOING: Record<LeadPower, string> = {
  link: "suggesting tasks and follow-ups",
  ask: "asking you to merge or archive",
  start: "starting tasks",
  nudge: "sending follow-ups",
  archive: "archiving threads",
  remove: "removing worktrees",
  merge: "merging PRs",
  release: "cutting releases",
};

/** Why `power` is refused at `level`, or null when it's allowed. */
export function overLevel(power: LeadPower, level: LeadLevel): string | null {
  const need = NEEDS[power];
  if (level >= need) return null;
  return `this lead is at ${levelName(level)} (${level}); ${DOING[power]} needs ${levelName(need)} (${need})`;
}
