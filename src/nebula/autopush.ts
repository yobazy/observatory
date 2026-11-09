// Push a thread's branch each time its turn ends, when its project's card
// says so, so other machines (like `pc`) have the latest work. The app
// pushes, not the agent: no prompt is sent and no model is used. The push
// itself is git.rs's `git_push_ff`, fast-forward only and never forced; this
// module decides when, and what the worktree's row says after. It has no
// value imports, so the tests load it in Node; pushRunner.ts wires it up.
import type { GitStatus } from "./git";
import type { ProjectCard } from "./cards";
import type { Agent, AgentStatus, Worktree } from "./types";

/** What git_push_ff fails with when the remote has commits the branch lacks. */
export const NOT_FAST_FORWARD = "not a fast-forward";

const MAIN_NAMES = ["main", "master"];

/** Whether the upstream is the remote branch of the same name. One of
 *  another name (a branch made from `origin/main` tracks main) doesn't count:
 *  the push always goes to `<remote>/<branch>` and re-points the upstream
 *  there, so its ahead and behind say nothing about this push. */
export function ownUpstream(git: GitStatus): boolean {
  if (!git.upstream || !git.branch) return false;
  const slash = git.upstream.indexOf("/");
  return (slash < 0 ? git.upstream : git.upstream.slice(slash + 1)) === git.branch;
}

/** Whether to push this checkout now: the card has it on, there are commits
 *  to push (ahead of the upstream, or no upstream yet), nothing to pull
 *  first, the upstream isn't gone (a merged PR's branch would only come
 *  back), and it's a branch other than the project's main one. An upstream
 *  of another name counts as none (ownUpstream). Uncommitted changes don't
 *  count: only commits are pushed. */
export function shouldPush(
  git: GitStatus,
  wt: Worktree,
  card: Pick<ProjectCard, "pushAfterTurn"> | null | undefined,
  mainBranch: string | null = null,
): boolean {
  if (!card?.pushAfterTurn) return false;
  if (!git.branch || !git.head) return false;
  // Main is pushed by merging PRs.
  if (wt.is_main || git.branch === mainBranch || MAIN_NAMES.includes(git.branch)) return false;
  if (!ownUpstream(git)) return (git.baseAhead ?? 1) > 0;
  if (git.upstreamGone || git.behind > 0) return false;
  return git.ahead > 0;
}

/** How many commits a push sends, from the status read before it. */
export function commitsToPush(git: GitStatus): number {
  return ownUpstream(git) ? git.ahead : (git.baseAhead ?? 0);
}

/** The worktree to push when an agent's status changes: its own, when it
 *  just left `running` (its turn ended: finished, waiting on you, stopped). */
export function pushTrigger(agent: Pick<Agent, "worktree_id" | "status" | "archived">, from: AgentStatus): string | null {
  if (from !== "running" || agent.status === "running" || agent.archived) return null;
  return agent.worktree_id;
}

export type PushResult = { ok: true; commits: number; at: number } | { ok: false; error: string; at: number };

const plural = (n: number) => `${n} ${n === 1 ? "commit" : "commits"}`;

/** What the worktree's row says about its last push. */
export function pushNote(r: PushResult): string {
  if (r.ok) return r.commits > 0 ? `Pushed ${plural(r.commits)}` : "Pushed";
  if (r.error === NOT_FAST_FORWARD) return "Not pushed: the remote has newer commits";
  return `Not pushed: ${r.error.split("\n")[0]}`;
}

/** How long "Pushed …" stays on the row. A failure stays until a push works. */
export const PUSHED_NOTE_MS = 8_000;

/** Whether the row still shows this result. */
export function showsNote(r: PushResult | undefined, now: number): r is PushResult {
  return !!r && (!r.ok || now - r.at < PUSHED_NOTE_MS);
}

export interface PushDeps {
  worktree(id: string): Worktree | undefined;
  card(wt: Worktree): Pick<ProjectCard, "pushAfterTurn"> | null | undefined;
  mainBranch(wt: Worktree): string | null;
  /** A fresh status read: the agent may have committed a moment ago. */
  status(wt: Worktree): Promise<GitStatus>;
  /** git_push_ff; rejects with its error text. */
  push(wt: Worktree, mainBranch: string | null): Promise<void>;
  record(worktreeId: string, r: PushResult): void;
  now(): number;
}

/** After a status change: push the agent's branch if its turn just ended and
 *  the card wants it. Returns whether a push was tried. A refused push is
 *  only recorded for the row; nothing is sent to the agent, and it isn't
 *  retried until the next turn ends. */
export async function pushAfterTurn(
  agent: Pick<Agent, "worktree_id" | "status" | "archived">,
  from: AgentStatus,
  deps: PushDeps,
): Promise<boolean> {
  const id = pushTrigger(agent, from);
  const wt = id ? deps.worktree(id) : undefined;
  if (!wt) return false;
  const card = deps.card(wt);
  if (!card?.pushAfterTurn) return false;
  const main = deps.mainBranch(wt);
  let git: GitStatus;
  try {
    git = await deps.status(wt);
  } catch {
    return false;
  }
  if (!shouldPush(git, wt, card, main)) return false;
  const commits = commitsToPush(git);
  try {
    await deps.push(wt, main);
    deps.record(wt.id, { ok: true, commits, at: deps.now() });
  } catch (e) {
    deps.record(wt.id, { ok: false, error: e instanceof Error ? e.message : String(e), at: deps.now() });
  }
  return true;
}
