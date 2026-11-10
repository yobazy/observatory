// The Dock icon shows the plate of whichever thread needs you most: the
// one that has waited on you longest (coral), else the latest one working
// (blue), else plain sand when all is quiet. The red count stays the
// window's badge (notify.ts). macOS only; dock.rs does nothing elsewhere.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "../nebula/client";
import { getState, subscribe, threadAgents, waitingAgents, type State } from "../nebula/store";
import { plateIcon, type PlateTone } from "./Plate";

/** The plate the Dock shows: a seed, its work, its tone. */
export function dockPlate(s: State): { seed: string; work: number; tone: PlateTone } {
  const waiting = waitingAgents(s)[0];
  if (waiting) return { seed: waiting.id, work: waiting.recent_prompts.length, tone: "needs_feedback" };
  const running = threadAgents(s)
    .filter((a) => !a.archived && a.status === "running")
    .sort((a, b) => b.status_changed_at - a.status_changed_at)[0];
  if (running) return { seed: running.id, work: running.recent_prompts.length, tone: "running" };
  return { seed: "observatory", work: 0, tone: "sand" };
}

export function useDockIcon() {
  useEffect(() => {
    if (isPreview() || !navigator.userAgent.includes("Mac")) return;
    let shown = "";
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      // A burst of status changes draws once.
      timer = window.setTimeout(() => {
        const s = getState();
        if (!s.loaded) return;
        const p = dockPlate(s);
        const key = `${p.seed}:${p.work}:${p.tone}:${s.mode}`;
        if (key === shown) return;
        shown = key;
        const png = plateIcon(p.seed, p.work, p.tone).toDataURL("image/png").split(",")[1];
        void invoke("set_dock_icon", { png }).catch(() => {});
      }, 400);
    };
    update();
    const off = subscribe(update);
    return () => {
      off();
      window.clearTimeout(timer);
      void invoke("set_dock_icon", { png: null }).catch(() => {});
    };
  }, []);
}
