// Comments on a previewed mockup or doc: click what should change, say how,
// and send them all to the agent that made the file as one prompt (queued
// if it's mid-turn). Pins stay on the file, greyed once sent, until cleared,
// so you can check each one was handled when the preview reloads.
import { enqueue } from "./queue";
import { flash, getState, setState } from "./store";
import type { Agent } from "./types";

export interface Target {
  /** Finds the element again in a page (HTML); empty for a doc. */
  selector: string;
  /** The element's tag: "button", "h2", "li". */
  tag: string;
  /** What it says, shortened. */
  text: string;
}

export interface MockComment {
  id: string;
  target: Target;
  note: string;
  sent: boolean;
}

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

const NOUN: Record<string, string> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "paragraph",
  li: "list item",
  tr: "table row",
  td: "table cell",
  th: "table heading",
  blockquote: "quote",
  pre: "code block",
  a: "link",
  img: "image",
};

/** How a prompt names the thing commented on. */
function describeTarget(t: Target, doc: boolean): string {
  const quoted = t.text ? ` "${t.text}"` : "";
  if (doc) return `The ${NOUN[t.tag] ?? t.tag}${quoted}`;
  return `The <${t.tag}>${quoted}${t.selector ? ` (${t.selector})` : ""}`;
}

/** The prompt for the unsent comments on `path`. */
export function commentPrompt(path: string, doc: boolean, comments: MockComment[]): string {
  const what = doc ? "the doc" : "the mockup";
  const lines = comments.map((c, i) => `${i + 1}. ${describeTarget(c.target, doc)}: ${c.note}`);
  return `Feedback on ${what} at ${path}. Please make these changes in that file:\n\n${lines.join("\n")}`;
}

/** Send the unsent comments on `path` to `agent`, now if it's idle, else
 *  when its turn ends. They stay pinned, marked sent. */
export async function sendComments(path: string, doc: boolean, agent: Agent): Promise<void> {
  const unsent = commentsOf(path).filter((c) => !c.sent);
  if (!unsent.length) return;
  const how = await enqueue(agent, commentPrompt(path, doc, unsent));
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
