// The desktop prefs with what belongs to gone tasks and projects dropped,
// so deleted ones don't pile up in the prefs file. Pure, so its tests run
// under Node; organize.ts runs it on every write.
import type { State } from "./store";
import type { DesktopPrefs } from "./theme";

/** What `pruned` reads of the app's state. */
export type PruneState = Pick<State, "loaded" | "agents" | "worktrees" | "projects">;

/** Per-task and per-project prefs whose task or project is gone, dropped.
 *  Left alone before the first snapshot. */
export function pruned(s: PruneState, prefs: DesktopPrefs): DesktopPrefs {
  if (!s.loaded) return prefs;
  const keep = <V>(rec: Record<string, V> | undefined) =>
    rec && Object.fromEntries(Object.entries(rec).filter(([id]) => id in s.agents));
  const pinnedTasks =
    prefs.pinnedTasks &&
    Object.fromEntries(
      Object.entries(prefs.pinnedTasks)
        .filter(([wt]) => wt in s.worktrees)
        .map(([wt, ids]) => [wt, ids.filter((id) => id in s.agents)] as const)
        .filter(([, ids]) => ids.length > 0),
    );
  const repos = new Set(Object.values(s.projects).map((p) => p.repo_path));
  const ofRepo = <V>(rec: Record<string, V> | undefined) => rec && Object.fromEntries(Object.entries(rec).filter(([r]) => repos.has(r)));
  return {
    ...prefs,
    projectOrder: prefs.projectOrder?.filter((r) => repos.has(r)),
    // Folders stay, emptied or not: a project removed and added again
    // goes back to the list, not into a folder it left.
    projectFolders: prefs.projectFolders?.map((f) => ({ ...f, projects: f.projects.filter((r) => repos.has(r)) })),
    projectAliases: ofRepo(prefs.projectAliases),
    projectTags: ofRepo(prefs.projectTags),
    projectPriorities: ofRepo(prefs.projectPriorities),
    threadTagLists: ofRepo(prefs.threadTagLists),
    threadTagColors: ofRepo(prefs.threadTagColors),
    pinnedTasks,
    taskColors: keep(prefs.taskColors),
    taskPriorities: keep(prefs.taskPriorities),
    threadTags: keep(prefs.threadTags),
    followUps: keep(prefs.followUps),
    autoFollowUps: keep(prefs.autoFollowUps),
  };
}
