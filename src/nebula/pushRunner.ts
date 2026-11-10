// Pushes a thread's branch when its turn ends, for projects whose card has
// "Push the branch after every turn" on (autopush.ts decides; git.rs's
// git_push_ff pushes), and keeps each worktree's last result for its row.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview, onAgentStatus } from "./client";
import { cardFor } from "./cards";
import { fetchStatus, mainBranch, refreshGit } from "./git";
import { getState } from "./store";
import { PUSHED_NOTE_MS, pushAfterTurn, showsNote, type PushDeps, type PushResult } from "./autopush";
import type { Agent, AgentStatus } from "./types";

let results: Record<string, PushResult> = {};
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function record(id: string, r: PushResult) {
  results = { ...results, [id]: r };
  listeners.forEach((l) => l());
  clearTimeout(timers.get(id));
  // "Pushed …" is for a moment; a refusal stays until a push works.
  if (r.ok)
    timers.set(
      id,
      setTimeout(() => {
        if (results[id] !== r) return;
        const { [id]: _done, ...rest } = results;
        results = rest;
        listeners.forEach((l) => l());
      }, PUSHED_NOTE_MS),
    );
}

/** What the worktree's row says about its last push, if anything. */
export function usePushResult(worktreeId: string): PushResult | null {
  const r = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => results[worktreeId],
  );
  return showsNote(r, Date.now()) ? r : null;
}

const deps: PushDeps = {
  worktree: (id) => getState().worktrees[id],
  card: (wt) => cardFor(wt.project_id),
  mainBranch,
  status: async (wt) => {
    const g = await fetchStatus(wt);
    if ("error" in g) throw new Error(g.error);
    return g;
  },
  push: (wt, main) => invoke("git_push_ff", { path: wt.path, main }),
  record,
  now: Date.now,
};

/** One push per worktree at a time; a turn that ends meanwhile pushes after. */
const inFlight = new Set<string>();
const again = new Map<string, { agent: Agent; from: AgentStatus }>();

async function run(agent: Agent, from: AgentStatus) {
  const id = agent.worktree_id;
  if (inFlight.has(id)) {
    again.set(id, { agent, from });
    return;
  }
  inFlight.add(id);
  try {
    if (await pushAfterTurn(agent, from, deps)) void refreshGit([id]);
  } finally {
    inFlight.delete(id);
    const next = again.get(id);
    again.delete(id);
    if (next) void run(next.agent, next.from);
  }
}

/** Mount once. */
export function usePushAfterTurn() {
  useEffect(() => {
    // The browser preview has no git to push with.
    if (isPreview()) return;
    return onAgentStatus((agent, from) => void run(agent, from));
  }, []);
}
