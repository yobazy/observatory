// Where observatory:// links come in: at launch, and while the app runs.
// Each becomes a filled-in New task dialog, once the projects have loaded;
// a lead's follow-up link opens its thread with the prompt in the reply box.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { flash, getState, projectOfWorktree, setState, subscribe } from "./store";
import { fromLabel, linkAction, matchProject, parseFollowUp, parseHandoff } from "./handoff";
import { allCards } from "./cards";
import { addToDraft } from "./drafts";
import { checkFollowUp, checkNewTask, runningLeads } from "./lead";
import { levelOf, type LeadLevel } from "./leadLevel";
import { setPaneMode } from "./pane";

export interface Handoff {
  projectId: string | null;
  /** The project as the link named it. */
  named: string | null;
  prompt: string;
  /** "From <task> in <project>", or "From a link". */
  from: string;
}

/** The project lead a thread is, with its project and level, or null. */
function leadOf(agentId: string): { projectId: string; name: string; level: LeadLevel } | null {
  const s = getState();
  for (const [projectId, card] of Object.entries(allCards()))
    if (card.lead?.agentId === agentId && s.projects[projectId]) return { projectId, name: s.projects[projectId].name, level: levelOf(card.lead) };
  return null;
}

/** Each project's lead's level, by project. */
function levels(): Record<string, LeadLevel> {
  const out: Record<string, LeadLevel> = {};
  for (const [projectId, card] of Object.entries(allCards())) if (card.lead) out[projectId] = levelOf(card.lead);
  return out;
}

function toHandoff(url: string): Handoff | null {
  const parsed = parseHandoff(url);
  if ("error" in parsed) {
    flash(parsed.error, 6000);
    return null;
  }
  const s = getState();
  const project = matchProject(Object.values(s.projects), parsed.project);
  // A lead's link opens only within its level, in its own project.
  const checked = checkNewTask({ projectId: project?.id ?? null, named: parsed.project, from: parsed.from }, leadOf);
  if ("error" in checked) {
    flash(checked.error, 6000);
    return null;
  }
  return {
    projectId: checked.projectId,
    named: parsed.project,
    prompt: parsed.prompt,
    from: fromLabel(parsed.from, s.agents, (w) => projectOfWorktree(s, w)),
  };
}

/** A follow-up from a project's lead: its thread opens in the Read view with
 *  the prompt in the reply box, for you to send. Refused with a flash when
 *  the thread isn't in that lead's project. */
export function openFollowUp(url: string): boolean {
  const parsed = parseFollowUp(url);
  if ("error" in parsed) {
    flash(parsed.error, 6000);
    return false;
  }
  const s = getState();
  const projectOf = (id: string) => {
    const a = s.agents[id];
    return (a && projectOfWorktree(s, a.worktree_id)?.id) || null;
  };
  const ok = checkFollowUp(parsed, s.agents, projectOf, runningLeads(allCards(), s.agents, s.projects), levels());
  if ("error" in ok) {
    flash(ok.error, 6000);
    return false;
  }
  const agent = s.agents[ok.agentId];
  addToDraft(agent.id, parsed.prompt);
  setPaneMode("read");
  setState({ view: "sessions", selectedProject: projectOf(agent.id) ?? s.selectedProject, selectedSession: { Agent: agent.id } });
  flash(`A follow-up for ${agent.name} from its lead is in the reply box`);
  return true;
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
      if (linkAction(url) === "follow-up") {
        if (openFollowUp(url)) void invoke("show_main_window").catch(() => {});
        return;
      }
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
