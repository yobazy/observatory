// Which thread left each uncommitted file: a checkout's changed files matched
// against the files each thread's log says it edited (thread_edits.rs). A
// file goes under the thread that changed it last; other threads that also
// changed it are named beside it. Edits from before the last commit don't
// count: that commit took them. What no thread changed is "not from a
// thread": you, another tool, or an agent that edited through the shell.
// Kept free of the app so its tests run under plain Node.

export interface ThreadEdit {
  /** Absolute, as the agent wrote it. */
  path: string;
  /** Unix seconds. */
  at: number;
}

export interface ChangedFile {
  /** Relative to the checkout. */
  path: string;
  insertions: number;
  deletions: number;
}

export interface Placed<F extends ChangedFile> {
  file: F;
  /** Other threads that changed it since the last commit, by agent id. */
  alsoBy: string[];
}

export interface Group<F extends ChangedFile> {
  /** The thread's agent id, or null for files no thread changed. */
  agentId: string | null;
  files: Placed<F>[];
  /** When the thread last changed one of these files (Unix seconds). */
  lastEdit: number | null;
}

/** `path` as one form: no trailing slash, macOS's /private prefix dropped
 *  (an agent in /tmp may write either). */
function norm(path: string): string {
  return path.replace(/\/+$/, "").replace(/^\/private\//, "/");
}

/** Group `files` (changed in the checkout at `root`) by the thread that left
 *  them. `edits` is each thread's edits by agent id; `since` is the last
 *  commit's time (Unix seconds), or null in a repo with none. Threads come
 *  newest first, and files no thread changed come last. */
export function byThread<F extends ChangedFile>(
  files: F[],
  root: string,
  edits: Record<string, ThreadEdit[]>,
  since: number | null,
): Group<F>[] {
  const base = norm(root);
  // Per file: each thread's last edit of it that counts.
  const touched = new Map<string, Map<string, number>>();
  for (const [agentId, list] of Object.entries(edits)) {
    for (const e of list) {
      if (since !== null && e.at < since) continue;
      const key = norm(e.path);
      const by = touched.get(key) ?? new Map<string, number>();
      by.set(agentId, Math.max(by.get(agentId) ?? 0, e.at));
      touched.set(key, by);
    }
  }
  const groups = new Map<string | null, Group<F>>();
  const group = (agentId: string | null) => {
    let g = groups.get(agentId);
    if (!g) groups.set(agentId, (g = { agentId, files: [], lastEdit: null }));
    return g;
  };
  for (const file of files) {
    const by = touched.get(`${base}/${file.path}`);
    if (!by || by.size === 0) {
      group(null).files.push({ file, alsoBy: [] });
      continue;
    }
    const ranked = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [owner, at] = ranked[0];
    const g = group(owner);
    g.files.push({ file, alsoBy: ranked.slice(1).map(([id]) => id) });
    g.lastEdit = Math.max(g.lastEdit ?? 0, at);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.agentId === null) return 1;
    if (b.agentId === null) return -1;
    return (b.lastEdit ?? 0) - (a.lastEdit ?? 0);
  });
}
