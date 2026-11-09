// Wires the stuck checks (stuck.ts) to the app. The full check, which reads
// each open session's latest turn, runs inside the triage pass
// (triageRunner.ts). Between passes, a usage scan landing, a status change,
// a new budget in Settings or on a Dispatch task settles the flags against
// spend alone, and sends the 85% and 100% banners. All of it only while
// triage is on, like the queue it feeds.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { allBatches } from "./batch";
import { isPreview } from "./client";
import { notify } from "./notify";
import { getState, subscribe, type State } from "./store";
import {
  budgetNudges,
  costBySession,
  loadSent,
  loadStuck,
  nudgeTitle,
  resettle,
  saveSent,
  saveStuck,
  sessionCost,
  stuckCheck,
  taskBudget,
  type StuckSession,
} from "./stuck";
import type { Turn } from "./turnsummary";
import type { Agent } from "./types";

const readable = (a: Agent | undefined): a is Agent => !!a && !!a.session_id && (a.kind === "claude" || a.kind === "codex");

async function latestTurn(id: string): Promise<Turn | null> {
  const st = getState();
  const a = st.agents[id];
  if (!readable(a)) return null;
  if (isPreview()) return (await import("./mock")).mockTurn(st, a.id);
  return invoke<Turn | null>("thread_turn", { session: a.session_id, kind: a.kind });
}

function sessions(s: State, stale: (a: Agent) => boolean): StuckSession[] {
  return Object.values(s.agents).map((a) => ({
    id: a.id,
    kind: a.kind,
    session_id: a.session_id,
    status: a.status,
    status_changed_at: a.status_changed_at,
    archived: a.archived,
    stale: stale(a),
  }));
}

const budgetOf = (s: State) => {
  const batches = allBatches();
  return (id: string) => taskBudget(id, batches, s.prefs.taskBudget);
};

/** Which sessions the last pass found stale, so settling between passes
 *  leaves them be. */
let staleIds = new Set<string>();

/** The full check, from the triage pass: `stale` says which it labels stale. */
export async function runStuckCheck(stale: (a: Agent) => boolean): Promise<void> {
  const s = getState();
  const list = sessions(s, stale);
  staleIds = new Set(list.filter((x) => x.stale).map((x) => x.id));
  await stuckCheck({
    sessions: list,
    entries: loadStuck,
    save: saveStuck,
    turn: (x) => latestTurn(x.id),
    costs: () => costBySession(getState().usage),
    budget: (id) => budgetOf(getState())(id),
  });
}

/** Settle the flags against spend now: after a budget changes. */
export function resettleStuck() {
  const s = getState();
  if (s.prefs.triageOn !== true) return;
  const next = resettle(loadStuck(), sessions(s, (a) => staleIds.has(a.id)), costBySession(s.usage), budgetOf(s), Date.now());
  if (next) saveStuck(next);
}

/** Mount once: flags settled and banners sent as spend and statuses move. */
export function useStuckWatch() {
  useEffect(() => {
    let usage: State["usage"] | undefined;
    let prefs: State["prefs"] | undefined;
    let agents: State["agents"] | undefined;
    // Null until the first look at spend, which only marks what's over.
    let looked = false;
    return subscribe(() => {
      const s = getState();
      if (s.usage === usage && s.prefs === prefs && s.agents === agents) return;
      const spent = s.usage !== usage || s.prefs !== prefs;
      usage = s.usage;
      prefs = s.prefs;
      agents = s.agents;
      if (!s.loaded || s.prefs.triageOn !== true || !s.usage) return;
      resettleStuck();
      if (!spent) return;
      const costs = costBySession(s.usage);
      const budget = budgetOf(s);
      const open = Object.values(s.agents).filter((a) => !a.archived && a.session_id);
      const sent = loadSent();
      const fire = budgetNudges(
        open.map((a) => ({ id: a.id, cost: sessionCost(costs, a), budget: budget(a.id) })),
        sent,
        looked,
      );
      looked = true;
      saveSent((id) => !!s.agents[id]);
      for (const n of fire) {
        const a = s.agents[n.id];
        if (a) void notify(nudgeTitle(a.name, n), "Open the Dispatch board to step in: Open, Stop or Redirect.");
      }
    });
  }, []);
}
