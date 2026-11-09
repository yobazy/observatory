// Budgets: spend you'd like to stay under, today and over the last seven
// days, in the same API-equivalent dollars the usage view shows. Crossing
// 80% and 100% gets one nudge each (a banner and a flash); the sidebar's
// usage chip turns amber, then red. Also what each task and branch has
// cost, for the rows that show it. Over a budget, Dispatch holds its
// pending tasks (budgetHold.ts).
import { useEffect, useMemo } from "react";
import { costOf, sessionKey, type UsageReport } from "./usage";
import { budgets, holds, type Holds } from "./budgetHold";
import { useCards } from "./cards";
import { flash, getState, subscribe, useAppState } from "./store";
import { notify } from "./notify";
import { money } from "./usage";

export { budgets, budgetLevel } from "./budgetHold";
export type { BudgetState } from "./budgetHold";

/** What's holding Dispatch's pending tasks, recomputed when spend, the
 *  budgets or the cards change (and each minute, so a new day lifts it). */
export function useHolds(): Holds {
  const s = useAppState();
  const cards = useCards();
  return useMemo(
    () => holds(s, cards),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.usage, s.prefs, s.projects, cards, s.minute],
  );
}

const ALERTS_KEY = "observatory.budget-alerts";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Which nudges already went out today, so each fires once a day. */
function sent(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ALERTS_KEY) ?? "{}");
    return new Set(raw.day === today() ? raw.keys : []);
  } catch {
    return new Set();
  }
}

function remember(keys: Set<string>) {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify({ day: today(), keys: [...keys] }));
  } catch {
    // Without storage a nudge may repeat after a relaunch.
  }
}

/** Mount once: nudges when spend crosses 80% or 100% of a budget. */
export function useBudgetWatch() {
  useEffect(() => {
    let usage = getState().usage;
    let prefs = getState().prefs;
    return subscribe(() => {
      const s = getState();
      if (s.usage === usage && s.prefs === prefs) return;
      usage = s.usage;
      prefs = s.prefs;
      const done = sent();
      let changed = false;
      for (const b of budgets(s)) {
        const level = b.share >= 1 ? 100 : b.share >= 0.8 ? 80 : 0;
        // The amount is part of it: raising a budget you went over re-arms
        // its nudges.
        const key = `${b.kind}:${b.budget}:${level}`;
        if (!level || done.has(key)) continue;
        done.add(key);
        changed = true;
        const title = level === 100 ? `Over your ${b.kind} budget` : `${Math.round(b.share * 100)}% of your ${b.kind} budget`;
        const body = `${money(b.spent)} of ${money(b.budget)} spent ${b.label}.`;
        flash(`${title}: ${body}`);
        void notify(title, body);
      }
      if (changed) remember(done);
    });
  }, []);
}

/** Known cost per agent session over the report's range (30 days). */
export function costBySession(report: UsageReport | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!report) return out;
  for (const b of report.buckets) {
    const cost = costOf(b, b.model);
    const key = sessionKey(b.source, b.session);
    if (cost !== null) out.set(key, (out.get(key) ?? 0) + cost);
  }
  return out;
}

/** The session cost map, recomputed only when a new usage scan lands. */
export function useSessionCosts(): Map<string, number> {
  const usage = useAppState().usage;
  return useMemo(() => costBySession(usage), [usage]);
}
