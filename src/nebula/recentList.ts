// Which recent projects the sidebar's Recent panel shows: the pure part of
// recent.ts, kept apart so tests can load it without the store.
import type { Project } from "./types";

/** How many the panel can show; the first is the default. */
export const RECENT_COUNTS = [3, 5, 7] as const;
export type RecentCount = (typeof RECENT_COUNTS)[number];

/** Kept past the largest count, so a removed project doesn't leave a gap. */
const KEEP = 20;

export type Visit = { repo: string; at: number };

/** `visits` with `repo` moved to the front, at `at`. */
export function visit(visits: Visit[], repo: string, at: number): Visit[] {
  return [{ repo, at }, ...visits.filter((v) => v.repo !== repo)].slice(0, KEEP);
}

/** Up to `count` recent projects that still exist, the one you're in
 *  included and marked, so you can see where you are among them. */
export function recentProjects(visits: Visit[], projects: Project[], current: Project | undefined, count: number) {
  const byRepo = new Map(projects.map((p) => [p.repo_path, p]));
  const out: { project: Project; at: number; here: boolean }[] = [];
  for (const v of visits) {
    const project = byRepo.get(v.repo);
    if (!project) continue;
    out.push({ project, at: v.at, here: project.repo_path === current?.repo_path });
    if (out.length === count) break;
  }
  return out;
}
