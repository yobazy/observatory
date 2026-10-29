// Marked moments: ⇧⌘M when you notice something saves what the app was doing
// (the last minute of the usage log's events, the state on screen, and a
// screenshot) to a folder on this Mac (moments.rs) and copies its path, so
// you can paste it to whoever looks into it instead of describing it.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { flash, getState, type State } from "./store.ts";
import { recentEvents, type UseEvent } from "./uselog.ts";
import { paneMode } from "./pane.ts";
import type { Transcript } from "./transcript.ts";

export interface Moment {
  t: string;
  version?: string;
  note: string | null;
  state: ReturnType<typeof snapshot>;
  events: UseEvent[];
}

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** What was on screen: enough to find your way back to it, no file contents. */
export function snapshot(s: State) {
  const sel = s.selectedSession;
  const agent = sel && "Agent" in sel ? s.agents[sel.Agent] : undefined;
  const terminal = sel && "Terminal" in sel ? s.terminals[sel.Terminal] : undefined;
  const wt = agent ? s.worktrees[agent.worktree_id] : undefined;
  const statuses: Record<string, number> = {};
  for (const a of Object.values(s.agents)) if (!a.archived) statuses[a.status] = (statuses[a.status] ?? 0) + 1;
  return {
    view: s.view,
    link: s.link.state === "disconnected" ? { state: s.link.state, reason: s.link.reason } : { state: s.link.state },
    loaded: s.loaded,
    project: s.selectedProject ? (s.projects[s.selectedProject]?.name ?? s.selectedProject) : null,
    session: agent
      ? { kind: "agent", id: agent.id, name: agent.name, harness: agent.kind, status: agent.status, branch: wt?.branch ?? null }
      : terminal
        ? { kind: "terminal", id: terminal.id }
        : null,
    pane: paneMode(),
    preview: s.preview ? s.preview.files.map((f) => base(f.path)) : null,
    notice: s.notice,
    agents: statuses,
    mode: s.mode,
  };
}

export type MarkState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; dir: string; noScreenshot: string | null }
  | { kind: "error"; message: string };

let mark: MarkState = { kind: "idle" };
const listeners = new Set<() => void>();
function setMark(next: MarkState) {
  mark = next;
  listeners.forEach((l) => l());
}

export function useMark(): MarkState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mark,
  );
}

let version: string | undefined;

/** The browser preview has no app behind it: saving is pretended. */
const inApp = () => "__TAURI_INTERNALS__" in globalThis;

/** How many of the open thread's last entries a moment keeps. */
const THREAD_ENTRIES = 12;

/** The open thread's last few entries, for a replay to show again. None
 *  when no thread with a log is open. */
async function openThread(s: State): Promise<Transcript | null> {
  const sel = s.selectedSession;
  const agent = sel && "Agent" in sel ? s.agents[sel.Agent] : undefined;
  if (!agent?.session_id || (agent.kind !== "claude" && agent.kind !== "codex")) return null;
  const t = await invoke<Transcript | null>("thread_transcript", { session: agent.session_id, from: null, kind: agent.kind }).catch(() => null);
  return t && t.entries.length ? { entries: t.entries.slice(-THREAD_ENTRIES), dropped: 0 } : null;
}

/** Save what's on screen now, screenshot included, without asking for a
 *  note: the reader's "Point at this" uses it for the reply you mean. */
export async function saveMoment(): Promise<{ dir: string; noScreenshot: string | null }> {
  const now = new Date();
  version ??= await import("@tauri-apps/api/app").then((m) => m.getVersion()).catch(() => undefined);
  const s = getState();
  const moment: Moment = { t: now.toISOString(), version, note: null, state: snapshot(s), events: recentEvents(now.getTime()) };
  return inApp()
    ? await invoke<{ dir: string; noScreenshot: string | null }>("save_moment", { stamp: moment.t, moment, thread: await openThread(s) })
    : { dir: `~/Library/Application Support/dev.bazil.observatory/moments/${moment.t}`, noScreenshot: null };
}

/** Save this moment, before anything else shows, so the screenshot is of
 *  what you saw. */
export async function markMoment() {
  if (mark.kind === "saving") return;
  setMark({ kind: "saving" });
  try {
    const saved = await saveMoment();
    setMark({ kind: "saved", dir: saved.dir, noScreenshot: saved.noScreenshot });
  } catch (e) {
    setMark({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

/** Add what you noticed to the moment just saved, then put it away. */
export async function noteMoment(note: string) {
  const m = mark;
  setMark({ kind: "idle" });
  if (m.kind !== "saved" || !note.trim() || !inApp()) return;
  await invoke("annotate_moment", { dir: m.dir, note: note.trim() });
}

/** The branch a moment's task works on, named after the moment's folder so
 *  two moments started at once never share a worktree. */
export function momentBranch(dir: string): string {
  const stamp = (dir.split("/").filter(Boolean).pop() ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `moment-${stamp || Date.now()}`;
}

/** The prompt for a task started from a moment: what you noticed, where the
 *  moment is so the agent can see it too, and how far to take it: its own
 *  worktree, a PR, and a second agent that reviews and merges that PR. Other
 *  moments' tasks may be running beside it, so it checks for a PR already
 *  covering the same thing, and the reviewer brings the PR up to date with
 *  whatever merged first. */
export function momentPrompt(dir: string, note: string): string {
  const branch = momentBranch(dir);
  return [
    note.trim() || "Look into what I marked in Observatory.",
    `I marked this moment in Observatory: ${dir}\nRead its moment.json (the last minute of what I did, what was on screen, and my note) and look at screenshot.png before you start.`,
    "Other agents may be working on other moments at the same time, in this project. If it needs a change, take it all the way:\n" +
      "1. Check `gh pr list` first. If an open PR already covers this, add what you found to it as a comment and stop there.\n" +
      `2. Before you edit anything, run \`git fetch origin\` and then \`nebula worktree ${branch} --base origin/<default branch>\` to move into your own worktree. Use that exact name, since it's unique to this moment. Other sessions share this checkout, so don't switch its branch.\n` +
      `3. If the project has \`scripts/drive\` (Observatory does), see it yourself rather than asking me: \`scripts/drive replay ${dir}\` puts this moment back on screen in the sandbox app, and \`scripts/drive shot\` takes a screenshot. Use the always-on PC when \`ssh pc\` answers: push your branch, then \`scripts/pc up\` and \`scripts/pc drive …\`. Use the Mac (\`scripts/sandbox.sh up\`, then \`scripts/drive …\`) for video or anything only macOS does. Reproduce it before you change anything, check the fix the same way, and put the before and after screenshots in the PR.\n` +
      "4. Make the change, run the checks this project's CLAUDE.md or README asks for, and commit.\n" +
      "5. Push the branch and open a PR.\n" +
      '6. Hand the review to a separate agent: `nebula spawn "Review PR #<number> (<url>) as a fresh reviewer: read the diff, look for correctness bugs and breaks in this project\'s rules. Other PRs may have merged since it was opened: if it is behind or conflicts, rebase it on the default branch, resolve the conflicts and push. Then run its checks. If it holds up, merge it with gh pr merge. If not, or the conflicts are not clear-cut, leave a PR comment saying what is wrong and don\'t merge."`\n' +
      "If it turns out no change is needed, say what you found instead.",
  ].join("\n\n");
}

const PROJECT_KEY = "observatory.momentProject";

/** The project a moment's task goes to: the one you sent the last one to,
 *  since moments are mostly about one app, else the one you're in. */
export function momentProject(s: State): string | null {
  let last: string | null = null;
  try {
    last = localStorage.getItem(PROJECT_KEY);
  } catch {
    // No storage: fall back to where you are.
  }
  if (last && s.projects[last]) return last;
  return s.selectedProject && s.projects[s.selectedProject] ? s.selectedProject : null;
}

/** Start a task on the moment just saved, in `projectId`'s main checkout,
 *  without leaving what you're looking at: the notice says it started. */
export async function taskMoment(projectId: string, note: string) {
  const m = mark;
  if (m.kind !== "saved") return;
  setMark({ kind: "idle" });
  try {
    localStorage.setItem(PROJECT_KEY, projectId);
  } catch {
    // Not remembered next time; that's all.
  }
  const s = getState();
  const project = s.projects[projectId];
  const main = Object.values(s.worktrees).find((w) => w.project_id === projectId && w.is_main);
  if (!project || !main) {
    flash("Couldn't start a task: that project has no main checkout", 6000);
    return;
  }
  try {
    if (note.trim() && inApp()) await invoke("annotate_moment", { dir: m.dir, note: note.trim() });
    // Imported here so the tests, which load this file in node, don't need the daemon client.
    const { createAgent, defaultKind } = await import("./actions.ts");
    const { readSettings } = await import("./client.ts");
    const settings = await readSettings();
    const id = await createAgent({ worktree: main.id, kind: defaultKind(settings), settings, prompt: momentPrompt(m.dir, note), select: false });
    if (!id) throw new Error("the daemon didn't start it");
    flash(`Started a task in ${project.name}`, 3000);
  } catch (e) {
    flash(`Couldn't start a task: ${e instanceof Error ? e.message : String(e)}`, 6000);
  }
}

export function dismissMoment() {
  setMark({ kind: "idle" });
}

export function momentsDir(): Promise<string> {
  return invoke<string>("moments_dir");
}

/** True for ⇧⌘M. */
export const isMarkKey = (e: Pick<KeyboardEvent, "code" | "metaKey" | "shiftKey" | "altKey" | "ctrlKey">) =>
  e.code === "KeyM" && e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey;

/** ⇧⌘M from anywhere in the window, terminals included; returns the unsubscribe. */
export function startMoments(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!isMarkKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    void markMoment();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
