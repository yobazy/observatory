// Launches Dispatch's batches (batch.ts) as slots free: watches the agents in
// the store and starts the next pending task whenever one finishes, within
// the global cap and each Shared project's own. Sent only while the app is
// open; pending tasks wait in localStorage across launches.
import { useEffect } from "react";
import { createAgent, defaultKind, followUp } from "./actions";
import { readSettings, request } from "./client";
import { allCards, homeCard, saveCard } from "./cards";
import { takenBranches } from "./fanout";
import { enqueue, isIdle } from "./queue";
import { loadPrefs, type DesktopPrefs } from "./theme";
import { flash, getState, subscribe } from "./store";
import {
  allBatches,
  batchCounts,
  globalCap,
  homeSignature,
  laneCapper,
  launchTask,
  nextLaunchable,
  reconcile,
  shouldRetry,
  updateTask,
  type BatchTask,
  type LaunchDeps,
  type Outcome,
} from "./batch";

/** Tasks whose launch request is out from this run of the app. A task left
 *  `launching` and not in here was cut short by a quit: `reconcile` settles it. */
const inflight = new Set<string>();
/** Branch names picked by launches still in flight, so two tasks in one
 *  project don't both pick the same one before either worktree exists. */
const reserved = new Set<string>();

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function deps(batchId: string, taskId: string): Promise<LaunchDeps> {
  const settings = await readSettings().catch(() => ({}) as Record<string, unknown>);
  const base = settings.worktree_base_branch;
  return {
    world: () => {
      const s = getState();
      return { projects: s.projects, worktrees: s.worktrees, agents: s.agents, cards: allCards() };
    },
    kind: defaultKind(settings),
    isIdle: (a) => isIdle(a),
    queuedFor: (id) => getState().queue[id]?.length ?? 0,
    followUp: (a, text) => followUp(a, text, { select: false }),
    enqueue: (a, text) => enqueue(a, text),
    createAgent: (worktree, prompt) =>
      createAgent({ worktree, kind: defaultKind(settings), settings, prompt, select: false }),
    createWorktree: async (project, branch) => {
      reserved.add(`${project}/${branch}`);
      const created = await request("CreateWorktree", {
        project,
        branch,
        base: typeof base === "string" && base ? base : null,
      });
      if (!created || !("Worktree" in created)) throw new Error("The daemon didn't return the new worktree.");
      return created.Worktree;
    },
    takenBranches: async (project) => {
      const taken = await takenBranches(project);
      for (const r of reserved) if (r.startsWith(`${project}/`)) taken.add(r.slice(project.length + 1));
      return taken;
    },
    addProject: async (path) => {
      const created = await request("AddProject", { path, name: null, create_missing: false });
      if (!created || !("Project" in created)) throw new Error("The daemon didn't return the project.");
      return created.Project;
    },
    adoptHome: (projectId) => {
      const home = homeCard();
      // saveCard drops the folder's card: it was a card only for being Home.
      if (home) saveCard(projectId, { ...home.card, isHome: true });
    },
    progress: (patch) => updateTask(batchId, taskId, patch),
  };
}

function settle(batchId: string, t: BatchTask, outcome: Outcome) {
  const now = Date.now();
  if (outcome.state === "launched") {
    updateTask(batchId, t.id, { state: "launched", agentId: outcome.agentId, launchedAt: now, note: outcome.note });
  } else if (outcome.state === "pending") {
    updateTask(batchId, t.id, { state: "pending", launchingAt: undefined });
  } else if (outcome.state === "blocked") {
    updateTask(batchId, t.id, { state: "blocked", note: outcome.note, blockedOnHome: outcome.blockedOnHome, blockedAt: now });
  } else {
    updateTask(batchId, t.id, { state: "failed", note: outcome.note });
  }
  if (outcome.state === "blocked" || outcome.state === "failed") {
    flash(`Dispatch couldn't start “${clip(t.text)}”: ${outcome.note}`, 6000);
  } else if (outcome.state === "launched") {
    const c = batchCounts(allBatches().flatMap((b) => b.tasks), getState().agents);
    const how = outcome.note === "queued" ? "Queued" : "Started";
    flash(`${how} “${clip(t.text)}”. Dispatch: ${c.working} working, ${c.waiting} waiting for a slot`);
  }
}

async function launch(batchId: string, t: BatchTask) {
  // Saved before anything goes out: the next tick, or the next launch of
  // the app, sees it taken.
  updateTask(batchId, t.id, { state: "launching", launchingAt: Date.now(), note: undefined });
  inflight.add(t.id);
  let outcome: Outcome;
  try {
    outcome = await launchTask(t, await deps(batchId, t.id));
  } catch (e) {
    outcome = { state: "failed", note: errText(e) };
  } finally {
    inflight.delete(t.id);
  }
  // Whatever the branch name reservations were for exist now, or never will.
  if (!inflight.size) reserved.clear();
  settle(batchId, t, outcome);
}

let prefsLoaded: DesktopPrefs | null = null;

/** One pass: settle launches cut short, retry what Home blocked, and start
 *  what the caps have room for. */
function tick() {
  const s = getState();
  if (!s.loaded || s.link.state !== "connected" || !prefsLoaded) return;
  const now = Date.now();
  const cards = allCards();
  const sig = homeSignature(cards);

  const claimed = new Set(allBatches().flatMap((b) => b.tasks.map((t) => t.agentId).filter((x): x is string => !!x)));
  for (const b of allBatches()) {
    for (const t of b.tasks) {
      if (t.state === "launching" && !inflight.has(t.id)) {
        const patch = reconcile(t, s.agents, claimed, now);
        if (patch?.agentId) claimed.add(patch.agentId);
        if (patch) updateTask(b.id, t.id, patch);
      } else if (shouldRetry(t, sig, now)) {
        updateTask(b.id, t.id, { state: "pending", note: undefined });
      }
    }
  }

  const all = allBatches().flatMap((b) => b.tasks.map((t) => ({ batchId: b.id, t })));
  const cap = globalCap(s.prefs.dispatchCap ?? prefsLoaded.dispatchCap);
  const next = nextLaunchable(
    all.map((x) => x.t),
    s.agents,
    { globalCap: cap, laneCap: laneCapper(cards) },
    now,
  );
  for (const t of next) {
    const batchId = all.find((x) => x.t === t)!.batchId;
    void launch(batchId, t);
  }
}

/** Mount once: launches pending tasks as slots free, including those left
 *  pending when the app last quit. */
export function useBatchRunner() {
  useEffect(() => {
    let queued = false;
    const soon = () => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        tick();
      }, 0);
    };
    // The cap is a pref: wait for it rather than launch past a lower one.
    void loadPrefs().then((p) => {
      prefsLoaded = p;
      soon();
    });
    let agents = getState().agents;
    const off = subscribe(() => {
      const s = getState();
      if (s.agents === agents) return;
      agents = s.agents;
      soon();
    });
    // For what the store can't signal: a new batch, Home changing, and the
    // clock (a launch cut short, a blocked task's retry).
    const sweep = setInterval(soon, 3_000);
    return () => {
      off();
      clearInterval(sweep);
    };
  }, []);
}

/** Start launching right away, e.g. just after Dispatch was pressed. */
export function kickBatches() {
  setTimeout(tick, 0);
}
