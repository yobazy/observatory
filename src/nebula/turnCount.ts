// How many turns each thread has taken, for how much sand its plate holds
// (plate.ts sandFill). The daemon keeps only a thread's last few prompts,
// so the count comes from its log, whenever something else reads its
// latest turn (verdicts, the turn strip, banners); until then, its prompts.
import { useSyncExternalStore } from "react";
import type { Agent } from "./types";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

/** A turn read from the thread's log: its number is how many there have been. */
export function noteTurnNumber(agentId: string, number: number | undefined) {
  if (!number || counts.get(agentId) === number) return;
  counts.set(agentId, number);
  version++;
  listeners.forEach((l) => l());
}

export function turnsOf(agent: Agent): number {
  return Math.max(counts.get(agent.id) ?? 0, agent.recent_prompts.length);
}

export function useTurns(agent: Agent): number {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return turnsOf(agent);
}
