// Projects whose folder moved: renamed in Finder, `mv`'d, or deleted. The
// daemon keeps a project at the path it was added from, so a moved repo
// leaves it pointing at nothing. The app notices (a folder check on a timer
// and on focus), says so on the row, and Locate… points the project at the
// new folder: the daemon's SetProjectPath moves its rows and repairs git's
// links, then what's keyed by the old path outside the daemon follows —
// this app's prefs, the project's nebula settings, Claude Code's history.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inspectFolder, isPreview, pickFolder, request } from "./client";
import { flash, getState, setState, subscribe } from "./store";
import { savePrefs } from "./theme";
import type { Project } from "./types";

const CHECK_EVERY_MS = 20_000;

/** Mount once: keeps `state.missingProjects` current. */
export function useFolderWatch() {
  useEffect(() => {
    if (isPreview()) {
      // `?folder=missing` in the preview: the selected project's folder is gone.
      if (new URLSearchParams(location.search).get("folder") !== "missing") return;
      return subscribe(() => {
        const s = getState();
        const id = s.selectedProject;
        if (id && s.loaded && !s.missingProjects[id]) setState({ missingProjects: { [id]: true } });
      });
    }
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const projects = Object.values(getState().projects);
        const gone = new Set(await invoke<string[]>("missing_dirs", { paths: projects.map((p) => p.repo_path) }));
        const missing = Object.fromEntries(
          projects.filter((p) => gone.has(p.repo_path)).map((p) => [p.id, true] as const),
        );
        const was = getState().missingProjects;
        if (JSON.stringify(Object.keys(missing).sort()) !== JSON.stringify(Object.keys(was).sort())) {
          setState({ missingProjects: missing });
        }
      } catch {
        // A failed check says nothing; the next one tries again.
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    window.addEventListener("focus", check);
    // A project added or re-pointed is checked at once, not on the next tick.
    let paths = "";
    const off = subscribe(() => {
      const now = Object.values(getState().projects)
        .map((p) => p.repo_path)
        .sort()
        .join("\n");
      if (now !== paths) {
        paths = now;
        void check();
      }
    });
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      off();
    };
  }, []);
}

const tilde = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");

function parentOf(path: string): string | undefined {
  const cut = path.replace(/\/+$/, "").lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : undefined;
}

/** Resolves once `test` holds for the store, or after `ms` regardless. */
function settle(test: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (test()) return resolve();
    const timer = setTimeout(done, ms);
    const off = subscribe(() => test() && done());
    function done() {
      clearTimeout(timer);
      off();
      resolve();
    }
  });
}

/** Pick the folder `project` now lives in and point it there. */
export async function locateProject(project: Project): Promise<void> {
  const old = project.repo_path;
  const picked = await pickFolder(parentOf(old));
  if (!picked) return;
  const info = await inspectFolder(picked);
  if (!info.exists) return flash(`${tilde(picked)} doesn't exist.`);
  if (!info.inGitRepo) return flash(`${tilde(info.path)} isn't a git repository, so it can't be ${project.name}.`);
  const owner = Object.values(getState().projects).find((p) => p.repo_path === info.path && p.id !== project.id);
  if (owner) {
    return flash(
      `${tilde(info.path)} is already the project “${owner.name}”. Remove that one from the list in nebula first.`,
      8000,
    );
  }

  // The project's checkouts, by worktree id, where they were: the ones that
  // move are those the daemon reports at a new path afterwards.
  const before = Object.values(getState().worktrees)
    .filter((w) => w.project_id === project.id)
    .map((w) => [w.id, w.path] as const);

  try {
    await request("SetProjectPath", { id: project.id, path: info.path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The protocol this app speaks has no such request yet: nebula's own
    // types refuse it before it leaves the app.
    if (/Malformed request|unknown variant/i.test(msg)) {
      return flash(
        `This version of nebula can't follow a moved folder yet. Move it back to ${tilde(old)} for now; ` +
          `an update will add this (AgentSystemLabs/nebula#129).`,
        10_000,
      );
    }
    return flash(`Couldn't move ${project.name}: ${msg}`, 8000);
  }

  await settle(() => getState().projects[project.id]?.repo_path !== old);
  const now = getState();
  const repo = now.projects[project.id]?.repo_path ?? info.path;
  const moves = before
    .map(([id, path]) => [path, now.worktrees[id]?.path] as const)
    .filter((m): m is readonly [string, string] => !!m[1] && m[1] !== m[0]);

  await carryPrefs(old, repo);
  const problems: string[] = [];
  try {
    await invoke("carry_project_state", { repo: [old, repo], moves });
  } catch (e) {
    problems.push(String(e));
  }
  setState((s) => {
    const missingProjects = { ...s.missingProjects };
    delete missingProjects[project.id];
    const logos = { ...s.logos };
    delete logos[old];
    return { missingProjects, logos };
  });
  flash(
    problems.length
      ? `Moved ${project.name} to ${tilde(repo)}, but ${problems.join("; ")}`
      : `${project.name} now lives at ${tilde(repo)}.`,
    problems.length ? 8000 : 3500,
  );
}

/** This app's prefs keyed by the repo's path, moved to the new one. */
async function carryPrefs(old: string, now: string) {
  const prefs = getState().prefs;
  const rekey = <V>(rec: Record<string, V> | undefined) => {
    if (!rec || !(old in rec)) return rec;
    const { [old]: value, ...rest } = rec;
    return { ...rest, [now]: value };
  };
  try {
    await savePrefs({
      ...prefs,
      projectOrder: prefs.projectOrder?.map((p) => (p === old ? now : p)),
      projectColors: rekey(prefs.projectColors),
      projectIcons: rekey(prefs.projectIcons),
    });
  } catch (e) {
    flash(`Couldn't save the project's icon and place: ${e instanceof Error ? e.message : e}`);
  }
}
