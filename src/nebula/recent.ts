// The projects you've been in lately, most recent first, for the Recent panel
// under the sidebar's projects. Kept by repo path, like folders and tags, and
// remembered per Mac: which project you looked at is known only to this app.
import { useEffect, useState } from "react";
import { getState, subscribe } from "./store";
import { RECENT_COUNTS, visit, type RecentCount, type Visit } from "./recentList";

const KEY = "observatory.recentProjects";
const COUNT_KEY = "observatory.sidebar.recentCount";

function load(): Visit[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v) => typeof v?.repo === "string" && typeof v?.at === "number") : [];
  } catch {
    return [];
  }
}

let visits: Visit[] = load();
const listeners = new Set<() => void>();

/** Mount once: notes each project you arrive in. */
export function useRecentTracking() {
  useEffect(() => {
    let last: string | null = null;
    const check = () => {
      const s = getState();
      const repo = s.selectedProject ? s.projects[s.selectedProject]?.repo_path : undefined;
      if (!repo || repo === last) return;
      last = repo;
      visits = visit(visits, repo, Date.now());
      try {
        localStorage.setItem(KEY, JSON.stringify(visits));
      } catch {
        // A convenience: without storage it lasts until the app quits.
      }
      listeners.forEach((l) => l());
    };
    check();
    return subscribe(check);
  }, []);
}

/** The visits so far, kept current. */
export function useVisits(): Visit[] {
  const [now, setNow] = useState(visits);
  useEffect(() => {
    const update = () => setNow(visits);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return now;
}

/** How many the panel shows: 3, 5 or 7, remembered per Mac. */
export function useRecentCount(): [RecentCount, (n: RecentCount) => void] {
  const [count, setCount] = useState<RecentCount>(() => {
    try {
      const n = Number(localStorage.getItem(COUNT_KEY));
      return (RECENT_COUNTS as readonly number[]).includes(n) ? (n as RecentCount) : RECENT_COUNTS[0];
    } catch {
      return RECENT_COUNTS[0];
    }
  });
  return [
    count,
    (n) => {
      setCount(n);
      try {
        localStorage.setItem(COUNT_KEY, String(n));
      } catch {
        // Remembering it is a nicety.
      }
    },
  ];
}
