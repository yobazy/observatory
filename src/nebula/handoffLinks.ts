// Where observatory:// links come in: at launch, and while the app runs.
// Each becomes a filled-in New task dialog, once the projects have loaded.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { flash, getState, projectOfWorktree, subscribe } from "./store";
import { fromLabel, matchProject, parseHandoff } from "./handoff";

export interface Handoff {
  projectId: string | null;
  /** The project as the link named it. */
  named: string | null;
  prompt: string;
  /** "From <task> in <project>", or "From a link". */
  from: string;
}

function toHandoff(url: string): Handoff | null {
  const parsed = parseHandoff(url);
  if ("error" in parsed) {
    flash(parsed.error, 6000);
    return null;
  }
  const s = getState();
  const project = matchProject(Object.values(s.projects), parsed.project);
  return {
    projectId: project?.id ?? null,
    named: parsed.project,
    prompt: parsed.prompt,
    from: fromLabel(parsed.from, s.agents, (w) => projectOfWorktree(s, w)),
  };
}

export function useHandoffLinks(open: (h: Handoff) => void) {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (isPreview()) return;
    const pending: string[] = [];
    let off: (() => void) | undefined;
    let unlisten: (() => void) | undefined;
    let live = true;
    // Links that arrive before the projects do wait for them.
    const drain = () => {
      if (!getState().loaded || !pending.length) return;
      const url = pending.pop()!;
      pending.length = 0;
      const h = toHandoff(url);
      if (!h) return;
      void invoke("show_main_window").catch(() => {});
      openRef.current(h);
    };
    const take = (urls: string[] | null | undefined) => {
      const ours = (urls ?? []).filter((u) => u.startsWith("observatory:"));
      if (!ours.length) return;
      pending.push(...ours);
      drain();
    };
    off = subscribe(drain);
    void import("@tauri-apps/plugin-deep-link").then(async ({ getCurrent, onOpenUrl }) => {
      const stop = await onOpenUrl(take);
      if (!live) return stop();
      unlisten = stop;
      take(await getCurrent());
    });
    return () => {
      live = false;
      off?.();
      unlisten?.();
    };
  }, []);
}
