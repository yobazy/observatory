// Runs the tagging prompt (tagging.ts) for untagged threads: once when the
// app connects, every 10 minutes after, and for one project when its chips
// row's "Tag untagged" is pressed. Off while `tagCommand` is unset. One
// pass at a time; a pass's error shows in the notice line.
import { useEffect } from "react";
import { runTagger } from "./client";
import { saveTagging } from "./organize";
import { flash, getState, projectWorktrees, subscribe } from "./store";
import { editsByAgent } from "./uncommitted";
import { previewTagReply, tagPass, type PassResult, type TagProject } from "./tagging";
import type { DesktopPrefs } from "./theme";

const EVERY = 10 * 60_000;
/** The store's prefs before desktop.json has been read: a pass waits for
 *  the real ones, or every thread would look untagged. */
const unloaded = getState().prefs;

let running: Promise<PassResult> | null = null;

/** Each project's threads, archived ones too, with their checkouts; only
 *  the project at `repo` when given. */
function projects(repo?: string): TagProject[] {
  const s = getState();
  return Object.values(s.projects)
    .filter((p) => !repo || p.repo_path === repo)
    .map((p) => {
      const wts = new Map(projectWorktrees(s, p.id).map((w) => [w.id, w.path]));
      const threads = Object.values(s.agents)
        .filter((a) => wts.has(a.worktree_id))
        .map((a) => ({ id: a.id, name: a.name, recent_prompts: a.recent_prompts, root: wts.get(a.worktree_id)! }));
      return { repo: p.repo_path, threads };
    });
}

function pass(repo?: string): Promise<PassResult> {
  if (running) return running;
  const s = getState();
  running = tagPass({
    command: s.prefs.tagCommand,
    prefs: () => getState().prefs,
    projects: projects(repo),
    edits: async (threads) => {
      const st = getState();
      return editsByAgent(
        st,
        threads.flatMap((t) => {
          const a = st.agents[t.id];
          return a && a.kind === "claude" && a.session_id ? [a] : [];
        }),
      );
    },
    run: (prompt, tags, threads) => runTagger(prompt, () => previewTagReply(tags, threads)),
    save: (change) => saveTagging((prefs) => change(prefs) as DesktopPrefs),
  }).finally(() => {
    running = null;
  });
  return running;
}

const said = (r: PassResult) => (r.errors.length ? `Couldn't tag threads: ${r.errors[0]}` : null);

/** "Tag untagged": a pass for one project now, with what came of it in the
 *  notice line. */
export async function tagProjectNow(repo: string) {
  if (!getState().prefs.tagCommand?.trim()) {
    flash("Set a thread tagging command in Settings first");
    return;
  }
  const r = await pass(repo);
  const error = said(r);
  if (error) flash(error, 6000);
  else if (!r.sent) flash("No untagged threads here");
  else flash(`Tagged ${r.tagged} of ${r.sent} untagged thread${r.sent === 1 ? "" : "s"}`);
}

/** Mount once: a pass when the app connects (again), and every 10 minutes. */
export function useTaggingRunner() {
  useEffect(() => {
    const quiet = () => {
      const s = getState();
      if (!s.loaded || s.link.state !== "connected" || s.prefs === unloaded) return;
      void pass().then((r) => {
        const error = said(r);
        if (error) flash(error, 6000);
      });
    };
    let connected = false;
    const off = subscribe(() => {
      const s = getState();
      const now = s.loaded && s.link.state === "connected" && s.prefs !== unloaded;
      if (now && !connected) quiet();
      connected = now;
    });
    const timer = setInterval(quiet, EVERY);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
}
