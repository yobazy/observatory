// The Ideas inbox (ideaList.ts has its rules): kept in the desktop prefs,
// beside the folders and tags, so they survive launches and nothing on the
// daemon's side knows of them. Nothing here drops an idea on its own; only
// Delete does.
import { useSyncExternalStore } from "react";
import { flash, getState, setState } from "./store";
import { savePrefs } from "./theme";
import type { Idea } from "./ideaList";

async function save(change: (ideas: Idea[]) => Idea[]): Promise<boolean> {
  const prefs = getState().prefs;
  try {
    await savePrefs({ ...prefs, ideas: change(prefs.ideas ?? []) });
    return true;
  } catch (e) {
    flash(`Couldn't save the idea: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Write an idea down; it goes first in its project. */
export async function addIdea(text: string, project: string | null, source: Idea["source"], more: Partial<Idea> = {}) {
  const idea: Idea = { id: newId(), text: text.trim(), project, createdAt: Date.now(), source, ...more };
  if (!idea.text) return null;
  return (await save((all) => [idea, ...all])) ? idea : null;
}

export function updateIdea(id: string, patch: Partial<Idea>) {
  return save((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

export function deleteIdeas(ids: string[]) {
  return save((all) => all.filter((i) => !ids.includes(i.id)));
}

/** Done by hand, or back to open. */
export function setDone(ids: string[], done: boolean) {
  const at = done ? Date.now() : null;
  return save((all) => all.map((i) => (ids.includes(i.id) ? { ...i, doneAt: at, ...(done ? {} : { startedAs: null }) } : i)));
}

/** Started as a task (the agent's id), or sent to Dispatch. */
export function markStarted(ids: string[], as: string) {
  return save((all) => all.map((i) => (ids.includes(i.id) ? { ...i, startedAs: as } : i)));
}

// ---- which project the view opens on ----

let focus: string | undefined;
const listeners = new Set<() => void>();

/** The project the Ideas view is narrowed to: a repo path, "unsorted", or every one. */
export function useIdeasFocus(): string | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => focus,
  );
}

export function setIdeasFocus(next: string | undefined) {
  focus = next;
  listeners.forEach((l) => l());
}

/** Open the Ideas view, on one project or all of them. */
export function openIdeas(project?: string) {
  setIdeasFocus(project);
  setState({ view: "ideas" });
}
