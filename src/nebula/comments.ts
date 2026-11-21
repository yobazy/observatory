// Comments on a previewed mockup, doc or picture: click what should change
// (or a spot on the picture), say how,
// and send them all to the agent that made the file as one prompt (queued
// if it's mid-turn). Pins stay on the file, greyed once sent, until cleared,
// so you can check each one was handled when the preview reloads.
import { enqueue } from "./queue";
import { flash, getState, setState } from "./store";
import type { Agent } from "./types";
import { commentPrompt, type CommentKind, type MockComment, type Target } from "./commentText";

export { spotText, type CommentKind, type MockComment, type Target } from "./commentText";

export function commentsOf(path: string): MockComment[] {
  return getState().comments[path] ?? [];
}

function write(path: string, list: MockComment[]) {
  setState((s) => {
    const comments = { ...s.comments };
    if (list.length) comments[path] = list;
    else delete comments[path];
    return { comments };
  });
}

export function addComment(path: string, target: Target, note: string) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  write(path, [...commentsOf(path), { id, target, note: note.trim(), sent: false }]);
}

export function removeComment(path: string, id: string) {
  write(
    path,
    commentsOf(path).filter((c) => c.id !== id),
  );
}

export function clearComments(path: string) {
  write(path, []);
}

/** Send the unsent comments on `path` to `agent`, now if it's idle, else
 *  when its turn ends. They stay pinned, marked sent. */
export async function sendComments(path: string, kind: CommentKind, agent: Agent): Promise<void> {
  const unsent = commentsOf(path).filter((c) => !c.sent);
  if (!unsent.length) return;
  const how = await enqueue(agent, commentPrompt(path, kind, unsent));
  write(
    path,
    commentsOf(path).map((c) => (unsent.some((u) => u.id === c.id) ? { ...c, sent: true } : c)),
  );
  const n = unsent.length;
  flash(
    how === "sent"
      ? `Sent ${n} ${n === 1 ? "comment" : "comments"} to ${agent.name}`
      : `${agent.name} is mid-turn: ${n === 1 ? "the comment goes" : `the ${n} comments go`} when it ends`,
  );
}

/** Who comments on a file can go to: the agent that showed it first, then
 *  the other live tasks in its project (or the open one's, if it came from
 *  nowhere in particular). */
export function recipients(from: string | undefined): Agent[] {
  const s = getState();
  const source = from ? s.agents[from] : undefined;
  const sel = s.selectedSession;
  const anchor = source ?? (sel && "Agent" in sel ? s.agents[sel.Agent] : undefined);
  const project = anchor ? s.worktrees[anchor.worktree_id]?.project_id : s.selectedProject;
  const inProject = Object.values(s.agents).filter(
    (a) => !a.archived && s.worktrees[a.worktree_id]?.project_id === project,
  );
  const live = source && !source.archived ? [source] : [];
  return [...live, ...inProject.filter((a) => a.id !== source?.id)];
}
