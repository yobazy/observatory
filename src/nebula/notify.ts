import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { getState, projectOfWorktree, waitingAgents } from "./store";
import { isQuietNow } from "./quiet";
import { allBatches } from "./batch";
import { suppressTaskNotification } from "./board";
import { findQuestion, readScreen } from "./screen";
import { isPreview } from "./client";
import { summarize, type Turn } from "./turnsummary";
import type { Agent, AgentStatus } from "./types";

let permitted: boolean | null = null;

async function canNotify(): Promise<boolean> {
  if (permitted === null) {
    permitted = await isPermissionGranted();
    if (!permitted) permitted = (await requestPermission()) === "granted";
  }
  return permitted;
}

/** Whether the user is already looking at this agent's terminal. */
export function isWatching(agent: Agent): boolean {
  const sel = getState().selectedSession;
  return document.hasFocus() && !!sel && "Agent" in sel && sel.Agent === agent.id;
}

function where(agent: Agent): string {
  const s = getState();
  const project = projectOfWorktree(s, agent.worktree_id);
  const wt = s.worktrees[agent.worktree_id];
  if (!project) return "";
  return wt && !wt.is_main ? `${project.name} on ${wt.branch}` : project.name;
}

const clip = (s: string, n = 140) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** What the agent wants, or what its turn did, in a line: the menu on its
 *  screen, else its log's latest turn (Claude Code or Codex). Null when neither
 *  says anything, or reading takes too long to be worth the wait. */
export async function what(agent: Agent): Promise<string | null> {
  const read = async () => {
    if (agent.status === "needs_feedback") {
      const q = findQuestion((await readScreen(agent).catch(() => null)) ?? []);
      if (q?.prompt) return clip(q.prompt);
    }
    if ((agent.kind !== "claude" && agent.kind !== "codex") || !agent.session_id) return null;
    const turn = isPreview()
      ? (await import("./mock")).mockTurn(getState(), agent.id)
      : await invoke<Turn | null>("thread_turn", { session: agent.session_id, kind: agent.kind });
    if (!turn) return null;
    const sum = summarize(turn, getState().worktrees[agent.worktree_id]?.path ?? "", agent.status === "needs_feedback");
    if (agent.status === "needs_feedback") return sum.asking ? clip(sum.asking) : null;
    return sum.headline.length ? sum.headline.map((p) => p.text).join(" · ") : null;
  };
  const late = new Promise<null>((r) => setTimeout(() => r(null), 1500));
  return Promise.race([read().catch(() => null), late]);
}

export async function onStatusChanged(agent: Agent, from: AgentStatus) {
  updateBadge();
  if (agent.archived || isWatching(agent) || isQuietNow()) return;
  // A Dispatch batch's sessions report once, as a batch (batchRunner.ts),
  // except when one is waiting on you.
  if (suppressTaskNotification(agent.id, agent.status, allBatches())) return;

  let title: string | null = null;
  if (agent.status === "needs_feedback")
    title = getState().limits[agent.id] ? `${agent.name} hit its usage limit` : `${agent.name} is waiting on you`;
  // A finished turn only earns a banner when the app is in the background.
  else if (agent.status === "finished" && from === "running" && !document.hasFocus())
    title = `${agent.name} finished`;
  else if (agent.status === "terminated") title = `${agent.name} stopped with an error`;
  if (!title || !(await canNotify())) return;

  const said = await what(agent);
  const place = where(agent);
  sendNotification({ title, body: said ? (place ? `${said}\n${place}` : said) : place });
}

/** A banner of the app's own (a budget crossed), hushed in quiet hours. */
export async function notify(title: string, body: string) {
  if (isQuietNow() || !(await canNotify())) return;
  sendNotification({ title, body });
}

export function updateBadge() {
  const count = waitingAgents(getState()).length;
  try {
    getCurrentWindow()
      .setBadgeCount(count > 0 ? count : undefined)
      .catch(() => {});
  } catch {
    // Badges are best-effort: some platforms (and the browser preview) have none.
  }
}
