// Folders, aliases and tags for projects: the desktop app's own way of
// sorting a long list, kept in the desktop prefs by repo path (the daemon,
// and so the TUI, knows none of it). Pure, so its tests run under Node.

import { byPriority, type PriorityPrefs } from "./priority.ts";

export interface ProjectFolder {
  id: string;
  name: string;
  /** Repo paths, in the order they show in the folder. */
  projects: string[];
  collapsed?: boolean;
}

export interface FolderPrefs {
  projectFolders?: ProjectFolder[];
  projectTags?: Record<string, string[]>;
  projectAliases?: Record<string, string>;
}

interface Named {
  repo_path: string;
  name: string;
}

/** The sidebar's layout: each folder with its projects, then the projects
 *  in none. `projects` is already in the sidebar's order; a folder keeps its
 *  own, under their priorities. A project in two folders (a hand-edited prefs file) shows in the
 *  first; a folder's repos that aren't projects any more are left out. */
export function layout<P extends Named>(projects: P[], prefs: FolderPrefs & PriorityPrefs): { folders: { folder: ProjectFolder; projects: P[] }[]; loose: P[] } {
  const byRepo = new Map(projects.map((p) => [p.repo_path, p]));
  const placed = new Set<string>();
  const folders = (prefs.projectFolders ?? []).map((folder) => ({
    folder,
    projects: byPriority(
      folder.projects.flatMap((repo) => {
        const p = byRepo.get(repo);
        if (!p || placed.has(repo)) return [];
        placed.add(repo);
        return [p];
      }),
      (p) => prefs.projectPriorities?.[p.repo_path],
    ),
  }));
  return { folders, loose: projects.filter((p) => !placed.has(p.repo_path)) };
}

/** A tag as it's kept: trimmed, without a leading #, spaces as dashes. */
export function cleanTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();
}

/** Tags typed as "work, client  #urgent": each once, in the order typed. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,\s]+/).map(cleanTag).filter(Boolean))];
}

/** Every tag in use, the most used first, then by name. */
export function allTags(prefs: FolderPrefs, repos: string[]): string[] {
  const count = new Map<string, number>();
  for (const repo of repos) for (const t of prefs.projectTags?.[repo] ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b));
}

/** Whether `project` answers the filter `query`: its name (an alias, when it
 *  has one, is its name), the daemon's name for it, its folder, or a tag.
 *  "#tag" asks for that tag alone. */
export function matches(project: Named, daemonName: string, prefs: FolderPrefs, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const tags = prefs.projectTags?.[project.repo_path] ?? [];
  if (q.startsWith("#")) {
    const want = cleanTag(q);
    return !want || tags.some((t) => t.startsWith(want));
  }
  const folder = prefs.projectFolders?.find((f) => f.projects.includes(project.repo_path))?.name ?? "";
  return [project.name, daemonName, project.repo_path, folder, ...tags].some((s) => s.toLowerCase().includes(q));
}

/** `order` with the members of `group` rearranged so `id` sits at `to`
 *  among them, everything else where it was. A drag inside a folder, or
 *  among the projects in none, moves only within that group. */
export function moveWithin(order: string[], group: string[], id: string, to: number): string[] {
  const inGroup = new Set(group);
  const members = order.filter((k) => inGroup.has(k));
  const rest = members.filter((k) => k !== id);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
  let i = 0;
  return order.map((k) => (inGroup.has(k) ? rest[i++] : k));
}

/** The folders with `repo` in `folderId` (at its end) and in no other;
 *  `null` takes it out of them all. */
export function placeIn(folders: ProjectFolder[], repo: string, folderId: string | null): ProjectFolder[] {
  return folders.map((f) => {
    const without = f.projects.filter((r) => r !== repo);
    return f.id === folderId ? { ...f, projects: [...without, repo] } : without.length === f.projects.length ? f : { ...f, projects: without };
  });
}
