// Wires the stuck checks (stuck.ts) to the app. The full check, which reads
// each open session's latest turn, runs inside the triage pass
// (triageRunner.ts). Between passes, a usage scan landing, a status change,
// a new prompt, a new budget in Settings or on a Dispatch task settles the
// flags against spend alone, and sends the 85% and 100% banners. All of it
// only while triage is on, like the queue it feeds.
//
// Spend counts from each session's start point (spendStart: its Dispatch
// task's launch, else your last prompt). Claude Code sessions are priced
// from the usage scan's own responses since then (usage_since, usage.rs);
// other sources only have hourly buckets, so their start hour counts in
// proportion (spendInBuckets).
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { allBatches } from "./batch";
import { isPreview } from "./client";
import { notify } from "./notify";
import { getState, subscribe, type State } from "./store";
import {
  budgetNudges,
  loadSent,
  loadStuck,
  nudgeTitle,
  priceRows,
  resettle,
  saveSent,
  saveStuck,
  spendInBuckets,
  spendStart,
  stuckCheck,
  taskBudget,
  type Spent,
  type StuckSession,
} from "./stuck";
import type { Tokens } from "./usageData";
import type { Turn } from "./turnsummary";
import { allCards } from "./cards";
import { leadIds } from "./lead";
import type { Agent } from "./types";

const readable = (a: Agent | undefined): a is Agent => !!a && !!a.session_id && (a.kind === "claude" || a.kind === "codex");

async function latestTurn(id: string): Promise<Turn | null> {
  const st = getState();
  const a = st.agents[id];
  if (!readable(a)) return null;
  if (isPreview()) return (await import("./mock")).mockTurn(st, a.id);
  return invoke<Turn | null>("thread_turn", { session: a.session_id, kind: a.kind });
}

/** Every session the checks read; a project's lead isn't checked. */
function sessions(s: State, stale: (a: Agent) => boolean): StuckSession[] {
  const leads = leadIds(allCards());
  return Object.values(s.agents).filter((a) => !leads.has(a.id)).map((a) => ({
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

// ---- spend since each start point ----

let spent: Spent = new Map();
let spentFor: { usage: State["usage"]; starts: string } | null = null;
let asked = 0;
const spendListeners = new Set<() => void>();

/** Work out each open session's spend since its start point again, when
 *  spend or a start point moved since the last time. */
export async function refreshSpend(): Promise<Spent> {
  const s = getState();
  const batches = allBatches();
  const entries = loadStuck();
  const starts = Object.values(s.agents).flatMap((a) => {
    if (a.archived || !a.session_id) return [];
    const st = spendStart(a, batches, entries[a.id]?.turnStarted);
    return st ? [{ a, session: a.session_id, ...st }] : [];
  });
  const key = JSON.stringify(starts.map((x) => [x.a.id, x.from]));
  if (spentFor && spentFor.usage === s.usage && spentFor.starts === key) return spent;
  const n = ++asked;
  const claude = starts.filter((x) => x.a.kind === "claude");
  let exact: Map<string, number> | null = null;
  if (claude.length && !isPreview()) {
    const rows = await invoke<(Tokens & { session: string; model: string })[]>("usage_since", {
      from: claude.map((x) => ({ session: x.session, since: Math.floor(x.from / 1000) })),
    }).catch(() => null);
    if (rows) exact = priceRows(rows);
  }
  // A later ask overtook this one: its answer stands.
  if (n !== asked) return spent;
  const usage = getState().usage;
  spent = new Map(
    starts.map((x) => [
      x.a.id,
      {
        cost: exact && x.a.kind === "claude" ? (exact.get(x.session) ?? 0) : spendInBuckets(usage, x.a.kind, x.session, x.from),
        from: x.from,
        since: x.since,
      },
    ]),
  );
  spentFor = { usage: s.usage, starts: key };
  spendListeners.forEach((l) => l());
  return spent;
}

/** Each session's spend since its start point, as last worked out. */
export function useSpent(): Spent {
  return useSyncExternalStore(
    (l) => {
      spendListeners.add(l);
      return () => spendListeners.delete(l);
    },
    () => spent,
  );
}

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
    spent: () => spent,
    budget: (id) => budgetOf(getState())(id),
  });
  // The pass may have read a newer turn start: count from it.
  await refreshSpend();
  resettleStuck();
}

/** Settle the flags against spend now: after a budget changes. */
export function resettleStuck() {
  const s = getState();
  if (s.prefs.triageOn !== true) return;
  const next = resettle(loadStuck(), sessions(s, (a) => staleIds.has(a.id)), spent, budgetOf(s), Date.now());
  if (next) saveStuck(next);
}

/** Mount once: flags settled and banners sent as spend and statuses move. */
export function useStuckWatch() {
  useEffect(() => {
    let usage: State["usage"] | undefined;
    let prefs: State["prefs"] | undefined;
    let agents: State["agents"] | undefined;
    // False until the first look at spend, which only marks what's over.
    let looked = false;
    let last: Spent | null = null;
    return subscribe(() => {
      const s = getState();
      if (s.usage === usage && s.prefs === prefs && s.agents === agents) return;
      usage = s.usage;
      prefs = s.prefs;
      agents = s.agents;
      if (!s.loaded || s.prefs.triageOn !== true || !s.usage) return;
      void refreshSpend().then((now) => {
        resettleStuck();
        if (now === last) return;
        last = now;
        const st = getState();
        const budget = budgetOf(st);
        const leads = leadIds(allCards());
        const sent = loadSent();
        const fire = budgetNudges(
          [...now].filter(([id]) => !leads.has(id)).map(([id, sp]) => ({ id, cost: sp.cost, budget: budget(id), from: sp.from })),
          sent,
          looked,
        );
        looked = true;
        saveSent((id) => !!st.agents[id]);
        for (const n of fire) {
          const a = st.agents[n.id];
          if (a) void notify(nudgeTitle(a.name, n), "Open the Dispatch board to step in: Open, Stop or Redirect.");
        }
      });
    });
  }, []);
}
