// The desktop app's own arranging of the tree: projects dragged into order,
// tasks pinned to the top of their branch, task colors, and tasks marked to
// come back to. All of it lives in the desktop prefs beside the project
// icons; the daemon (and so the TUI) keeps its own order.
import { useEffect } from "react";
import { onAgentStatus } from "./client";
import { afterStatus, settled } from "./followupRules";
import { isWatching } from "./notify";
import { flash, getState, projectWorktrees, sortedProjects, subscribe, worktreeAgents, type State } from "./store";
import { moveWithin, placeIn, type ProjectFolder } from "./folders";
import { pruned } from "./prune";
import { addTag, deleteTag, renameTag, setThreadTags } from "./threadtags";
import { savePrefs, type DesktopPrefs } from "./theme";
import type { Agent } from "./types";

/** `ids` with `id` taken out and put back at `to`. */
function moved(ids: string[], id: string, to: number): string[] {
  const rest = ids.filter((k) => k !== id);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
  return rest;
}

/** Apply `change` to the prefs and write them; a failed write is said in
 *  the notice line, and resolves false. */
async function save(change: (prefs: DesktopPrefs) => DesktopPrefs): Promise<boolean> {
  const s = getState();
  try {
    await savePrefs(pruned(s, change(s.prefs)));
    return true;
  } catch (e) {
    flash(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/** Put a project at `to` in the sidebar: among `group` (the projects in
 *  none of the folders, as shown) when given, else in the whole list. */
export function moveProject(repo: string, to: number, group?: string[]) {
  const order = sortedProjects(getState()).map((p) => p.repo_path);
  return save((prefs) => ({ ...prefs, projectOrder: group ? moveWithin(order, group, repo, to) : moved(order, repo, to) }));
}

// ---- folders, aliases and tags (folders.ts) ----

const folders = (prefs: DesktopPrefs) => prefs.projectFolders ?? [];

/** A new folder, at the end, with `repo` in it when given. */
export function createFolder(name: string, repo?: string) {
  const folder: ProjectFolder = { id: `f${Date.now().toString(36)}`, name, projects: [] };
  return save((prefs) => {
    const all = [...folders(prefs), folder];
    return { ...prefs, projectFolders: repo ? placeIn(all, repo, folder.id) : all };
  });
}

export function renameFolder(id: string, name: string) {
  return save((prefs) => ({ ...prefs, projectFolders: folders(prefs).map((f) => (f.id === id ? { ...f, name } : f)) }));
}

/** The folder goes; its projects go back to the list. */
export function deleteFolder(id: string) {
  return save((prefs) => ({ ...prefs, projectFolders: folders(prefs).filter((f) => f.id !== id) }));
}

export function toggleFolder(id: string) {
  return save((prefs) => ({ ...prefs, projectFolders: folders(prefs).map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)) }));
}

/** Move a folder one place up (-1) or down (1). */
export function shiftFolder(id: string, by: -1 | 1) {
  return save((prefs) => {
    const all = [...folders(prefs)];
    const i = all.findIndex((f) => f.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= all.length) return prefs;
    [all[i], all[j]] = [all[j], all[i]];
    return { ...prefs, projectFolders: all };
  });
}

/** Put `repo` in a folder, or (null) back in the list. */
export function moveToFolder(repo: string, folderId: string | null) {
  return save((prefs) => ({ ...prefs, projectFolders: placeIn(folders(prefs), repo, folderId) }));
}

/** Put `repo` at `to` among its folder's projects. */
export function moveInFolder(folderId: string, repo: string, to: number) {
  return save((prefs) => ({
    ...prefs,
    projectFolders: folders(prefs).map((f) => (f.id === folderId ? { ...f, projects: moveWithin(f.projects, f.projects, repo, to) } : f)),
  }));
}

/** A name for `repo` here in place of the daemon's; empty goes back to it. */
export function setProjectAlias(repo: string, alias: string) {
  return save((prefs) => {
    const projectAliases = { ...prefs.projectAliases };
    if (alias.trim()) projectAliases[repo] = alias.trim();
    else delete projectAliases[repo];
    return { ...prefs, projectAliases };
  });
}

export function setProjectTags(repo: string, tags: string[]) {
  return save((prefs) => {
    const projectTags = { ...prefs.projectTags };
    if (tags.length) projectTags[repo] = tags;
    else delete projectTags[repo];
    return { ...prefs, projectTags };
  });
}

/** Put a task at `to` in its branch. Everything above where it lands is
 *  pinned there with it (so the list stays as it was left), and pinned
 *  tasks below stay pinned; the rest keep sorting themselves under them.
 *  `seen` is the order `to` counts in, when it may have re-sorted since. */
export function moveTask(agent: Agent, to: number, seen?: string[]) {
  const s = getState();
  const wt = agent.worktree_id;
  const pinned = new Set(s.prefs.pinnedTasks?.[wt]);
  pinned.add(agent.id);
  const now = worktreeAgents(s, wt).map((a) => a.id);
  const shown = seen ? [...seen.filter((id) => now.includes(id)), ...now.filter((id) => !seen.includes(id))] : now;
  const order = moved(shown, agent.id, to);
  const last = order.reduce((at, id, i) => (pinned.has(id) ? i : at), -1);
  // Pinned tasks now archived keep their pins, for if they come back.
  const away = [...pinned].filter((id) => !order.includes(id));
  return save((prefs) => ({
    ...prefs,
    pinnedTasks: { ...prefs.pinnedTasks, [wt]: [...order.slice(0, last + 1), ...away] },
  }));
}

/** Let every live task on a branch go back to sorting itself (archived
 *  ones keep their pins, for if they come back). */
export function unpinAll(worktreeId: string) {
  const { agents } = getState();
  return save((prefs) => ({
    ...prefs,
    pinnedTasks: {
      ...prefs.pinnedTasks,
      [worktreeId]: (prefs.pinnedTasks?.[worktreeId] ?? []).filter((id) => agents[id]?.archived),
    },
  }));
}

/** Back to the daemon's order for projects. */
export function resetProjectOrder() {
  return save((prefs) => ({ ...prefs, projectOrder: undefined }));
}

export function isPinned(s: State, agent: Agent): boolean {
  return s.prefs.pinnedTasks?.[agent.worktree_id]?.includes(agent.id) ?? false;
}

/** Let a pinned task go back to sorting itself. */
export function unpinTask(agent: Agent) {
  const wt = agent.worktree_id;
  return save((prefs) => ({
    ...prefs,
    pinnedTasks: { ...prefs.pinnedTasks, [wt]: (prefs.pinnedTasks?.[wt] ?? []).filter((id) => id !== agent.id) },
  }));
}

export function setTaskColor(agentId: string, name: string | null) {
  return save((prefs) => {
    const taskColors = { ...prefs.taskColors };
    if (name) taskColors[agentId] = name;
    else delete taskColors[agentId];
    return { ...prefs, taskColors };
  });
}

// ---- tags on threads (threadtags.ts) ----

/** The ids of every thread in the project at `repo`, archived ones too. */
function threadIds(s: State, repo: string): string[] {
  const project = Object.values(s.projects).find((p) => p.repo_path === repo);
  if (!project) return [];
  const wts = new Set(projectWorktrees(s, project.id).map((w) => w.id));
  return Object.values(s.agents)
    .filter((a) => wts.has(a.worktree_id))
    .map((a) => a.id);
}

/** A tag at the end of the project's list; false, said in the notice
 *  line, when nothing is left of the name once cleaned. */
export function addThreadTag(repo: string, name: string) {
  if (!addTag(getState().prefs, repo, name)) {
    flash("A tag needs a letter or number in it");
    return Promise.resolve(false);
  }
  return save((prefs) => addTag(prefs, repo, name) ?? prefs);
}

export function renameThreadTag(repo: string, from: string, to: string) {
  if (!renameTag(getState().prefs, repo, from, to)) {
    flash("A tag needs a letter or number in it");
    return Promise.resolve(false);
  }
  const ids = threadIds(getState(), repo);
  return save((prefs) => renameTag(prefs, repo, from, to, ids) ?? prefs);
}

export function deleteThreadTag(repo: string, tag: string) {
  const ids = threadIds(getState(), repo);
  return save((prefs) => deleteTag(prefs, repo, tag, ids));
}

/** A change worked out by the tagging prompt (tagging.ts), against the
 *  prefs as they are when it's written. */
export function saveTagging(change: (prefs: DesktopPrefs) => DesktopPrefs) {
  return save(change);
}

/** A thread's tags, as you set them from its menu. */
export function tagThread(agentId: string, tags: string[]) {
  return save((prefs) => setThreadTags(prefs, agentId, tags));
}

export function isFollowUp(s: State, agentId: string): boolean {
  return s.prefs.followUps?.[agentId] !== undefined;
}

/** Mark a task to come back to, or clear the mark. */
export function toggleFollowUp(agentId: string) {
  return save((prefs) => {
    const followUps = { ...prefs.followUps };
    const autoFollowUps = { ...prefs.autoFollowUps };
    // Either way the flag is yours now, so it won't clear on its own.
    delete autoFollowUps[agentId];
    if (followUps[agentId] !== undefined) delete followUps[agentId];
    else followUps[agentId] = Date.now();
    return { ...prefs, followUps, autoFollowUps };
  });
}

/** Flag a task for follow-up, or clear its flag, and say which. */
export async function toggleFlag(agent: Agent) {
  const on = !isFollowUp(getState(), agent.id);
  if (!(await toggleFollowUp(agent.id))) return;
  flash(on ? `Flagged ${agent.name} for follow-up` : `Cleared the flag on ${agent.name}`);
}

/** Every marked task still around, the longest-waiting first. */
export function followUpAgents(s: State): { agent: Agent; at: number }[] {
  return Object.entries(s.prefs.followUps ?? {})
    .flatMap(([id, at]) => (s.agents[id] ? [{ agent: s.agents[id], at }] : []))
    .sort((a, b) => a.at - b.at);
}

/** Whether the app flagged this task itself, when a turn ended unseen. */
export function isAutoFollowUp(s: State, agentId: string): boolean {
  return !!s.prefs.autoFollowUps?.[agentId];
}

/** Mount once: flags a task for follow-up when its turn ends while you
 *  aren't looking, and drops those flags once you've acted on the task. */
export function useAutoFollowUps() {
  useEffect(() => {
    // One write at a time, each worked out again from the prefs as they are
    // by then, so two turns ending together both get flagged.
    let chain = Promise.resolve();
    const write = (change: (prefs: DesktopPrefs) => DesktopPrefs | null) => {
      if (!change(getState().prefs)) return;
      chain = chain.then(async () => {
        const next = change(getState().prefs);
        if (next) await save(() => next);
      });
    };
    const off = onAgentStatus((agent, from) => {
      const watching = isWatching(agent);
      const at = Date.now();
      write((prefs) => afterStatus(prefs, agent, from, watching, at));
    });
    const unsub = subscribe(() => {
      if (getState().loaded) write((prefs) => settled(prefs, getState().agents));
    });
    return () => {
      off();
      unsub();
    };
  }, []);
}

