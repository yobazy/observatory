// Holds a Claude thread as finished while its CLI sits at its input box
// after a turn that ended without telling nebula (stall.ts), the way
// limits.ts holds Codex and Cursor at a usage limit. It lets go when the
// screen gets busy again or the daemon reports a status of its own.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { statusChanged, tailOutput } from "./client";
import { getState, setState } from "./store";
import { readScreen } from "./screen";
import { screenIdle, stalled } from "./stall";
import type { Transcript } from "./transcript";
import type { Agent } from "./types";

const POLL_MS = 4_000;
/** Per agent: the output ring position last read, and since when it has sat
 *  at an idle prompt (null while busy). */
const seen = new Map<string, { seq: number; idleSince: number | null }>();
/** Per agent, the status and ring position its log was last read at: it's
 *  read again only once either moves. */
const logRead = new Map<string, string>();
/** Agents with a read still out, so a slow one isn't stacked on. */
const busy = new Set<string>();

function release(a: Agent) {
  if (!getState().stalls[a.id]) return;
  const now = getState().agents[a.id];
  setState((s) => {
    const stalls = { ...s.stalls };
    delete stalls[a.id];
    return now ? { stalls, agents: { ...s.agents, [a.id]: { ...now, status: "running" } } } : { stalls };
  });
  if (now) statusChanged({ ...now, status: "running" }, "finished");
}

async function check(a: Agent) {
  const tail = await tailOutput({ Agent: a.id }, 1, null);
  if (!tail) return;
  let s = seen.get(a.id);
  if (s?.seq !== tail.end_seq) {
    const lines = await readScreen(a);
    if (!lines) return;
    const idle = screenIdle(lines);
    s = { seq: tail.end_seq, idleSince: idle ? Date.now() : null };
    seen.set(a.id, s);
    if (!idle) return release(a);
  }
  const now = getState().agents[a.id];
  if (!now || getState().stalls[a.id] || now.status !== "running" || !now.session_id) return;
  if (!stalled(now, s.idleSince, {})) return;
  const key = `${now.status_changed_at}:${tail.end_seq}`;
  if (logRead.get(a.id) === key) return;
  logRead.set(a.id, key);
  const log = await invoke<Transcript | null>("thread_transcript", { session: now.session_id, from: null, kind: now.kind }).catch(
    () => null,
  );
  // Re-read after the awaits: the daemon may have moved it on meanwhile.
  const latest = getState().agents[a.id];
  if (!latest || seen.get(a.id)?.seq !== tail.end_seq || !stalled(latest, s.idleSince, log)) return;
  const next: Agent = { ...latest, status: "finished" };
  setState((st) => ({
    stalls: { ...st.stalls, [a.id]: { since: latest.status_changed_at } },
    agents: { ...st.agents, [a.id]: next },
  }));
  statusChanged(next, "running");
}

/** Mount once: reads the screens of Claude agents the daemon has running,
 *  and of those held as stopped. */
export function useStallWatch() {
  useEffect(() => {
    const t = setInterval(() => {
      const s = getState();
      const watched = Object.values(s.agents).filter(
        (a) => a.kind === "claude" && a.alive && !a.archived && (a.status === "running" || s.stalls[a.id]),
      );
      for (const id of seen.keys())
        if (!watched.some((a) => a.id === id)) {
          seen.delete(id);
          logRead.delete(id);
        }
      for (const a of watched) {
        if (busy.has(a.id)) continue;
        busy.add(a.id);
        void check(a).finally(() => busy.delete(a.id));
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);
}
