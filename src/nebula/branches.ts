// Branch names the app makes up for new worktrees. Pure, so Dispatch's
// launcher can be tested without the app.

/** A branch name from the task's first words: "Fix login redirect" → fix-login-redirect. */
export function suggestBranch(task: string): string {
  return task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-");
}

/** `name`, or `name-2`, `name-3`… — the first one not taken. */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name}-${n}`)) return `${name}-${n}`;
}
