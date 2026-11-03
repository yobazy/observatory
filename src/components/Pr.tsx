import { useState } from "react";
import { flash, useAppState } from "../nebula/store";
import { changedFiles, type GitStatus } from "../nebula/git";
import { needsForce, takerFor } from "../nebula/actions";
import { handToBranch } from "../nebula/queue";
import { cleanUp, createPr, fixCiPrompt, mergePr, readyPr, refreshPrs, type PullRequest } from "../nebula/prs";
import { openLink } from "./Run";
import { ConfirmDialog, type ConfirmDialogSpec } from "./Dialogs";
import type { Worktree } from "../nebula/types";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STATE_LABEL: Record<PullRequest["state"], string> = {
  open: "open",
  draft: "draft",
  merged: "merged",
  closed: "closed",
};

/** Whether the branch is pushed and has work main lacks: what a PR needs. */
function canOpenPr(git: GitStatus): boolean {
  return !!git.upstream && !git.upstreamGone && (git.baseAhead ?? 0) > 0;
}

/** A band's pull request: where it stands, and the one next step it needs —
 *  opening it, fixing its CI, or cleaning up once it's merged. */
export function PrLine({ worktree, git }: { worktree: Worktree; git: GitStatus }) {
  const state = useAppState();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialogSpec | null>(null);
  if (worktree.is_main) return null;
  const pr = state.prs[worktree.id];
  const branch = git.branch ?? worktree.branch;
  const dirty = changedFiles(git) > 0;

  const run = async (what: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await what();
    } catch (e) {
      flash(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // How Clean up treats this branch: "landed" when the PR merged at the
  // commit that's checked out, so nothing here can be lost; otherwise the
  // branch is only deleted if git agrees its commits are merged.
  type Kind = "landed" | "merged-newer" | "closed" | "gone";
  const confirmCleanUp = (force: boolean, kind: Kind) =>
    setDialog({
      kind: "confirm",
      title: `Clean up ${branch}?`,
      message: force
        ? "The checkout has changes git won't drop on its own. Cleaning up anyway loses them."
        : {
            landed: `Its pull request is merged. This deletes the worktree at ${worktree.path}, its sessions, and the local ${branch} branch. The remote is left as it is.`,
            "merged-newer": `Its pull request is merged, but this branch has commits made after it. This deletes the worktree and its sessions; the local branch is kept if git says those commits aren't merged anywhere.`,
            closed: `Its pull request was closed without merging. This deletes the worktree and its sessions; the local ${branch} branch is kept unless git says its commits are merged.`,
            gone: `The remote branch is gone, which usually means it was merged. This deletes the worktree and its sessions; the local ${branch} branch is kept unless git says its commits are merged.`,
          }[kind],
      confirm: force ? "Clean up anyway" : "Clean up",
      onConfirm: async () => {
        try {
          await cleanUp(worktree, force, kind === "landed");
        } catch (e) {
          // Only a dirty checkout earns the offer to force; anything else
          // (a lost connection, a locked worktree) is just the error.
          if (!force && needsForce(e)) {
            confirmCleanUp(true, kind);
            return false;
          }
          throw e;
        }
      },
    });

  // Merging is the last step on GitHub; cleaning up the checkout is the
  // next one here, so it's offered straight after when nothing would be lost.
  const confirmMerge = (p: PullRequest) =>
    setDialog({
      kind: "confirm",
      title: `Merge #${p.number}?`,
      message: `“${p.title}” merges into its base on GitHub, as a squash where the repository allows one. It won't merge if the branch has moved on GitHub since this app last checked.`,
      confirm: "Merge",
      safe: true,
      onConfirm: async () => {
        const how = await mergePr(worktree, p);
        flash(`Merged #${p.number} (${how})`);
        if (!dirty && git.head === p.headOid) {
          confirmCleanUp(false, "landed");
          return false;
        }
      },
    });

  const cleanUpButton = (kind: Kind) => (
    <button
      className="btn btn-sm"
      disabled={busy}
      onClick={() => confirmCleanUp(false, kind)}
      title={dirty ? "There are uncommitted changes here" : "Delete this worktree, and its local branch if it's merged"}
    >
      Clean up
    </button>
  );

  let body: React.ReactNode = null;
  if (!pr || pr.kind === "unavailable") {
    // No word from GitHub; a deleted upstream still says the work landed.
    if (git.upstreamGone) body = <>{cleanUpButton("gone")}</>;
  } else if (pr.kind === "none") {
    if (canOpenPr(git))
      body = (
        <>
          <span className="git-muted">No pull request yet</span>
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const url = await createPr(worktree);
                flash(`Opened a pull request for ${branch}`);
                void openLink(url);
              })
            }
            title="Open a pull request from this branch's commits (gh pr create --fill)"
          >
            {busy ? "Opening…" : "Open PR"}
          </button>
        </>
      );
    else if (git.upstreamGone) body = cleanUpButton("gone");
  } else {
    const p = pr.pr;
    const done = p.state === "merged" || p.state === "closed";
    const landed = p.state === "merged" && !!git.head && git.head === p.headOid && !dirty;
    const taker = takerFor(state, worktree.id);
    // One quiet sentence; only the part that needs you takes color, and when
    // there's a fix to hand (failing checks), that part is the button for it.
    const loud = done ? null : p.checks === "failing" ? "checks" : p.conflicts ? "conflicts" : p.review === "changes" ? "changes" : null;
    const fixCi = () => void run(async () => flash(await handToBranch(worktree.id, fixCiPrompt(p, branch), `fix CI on ${branch}`)));
    const parts: React.ReactNode[] = [];
    if (!done && p.checks === "failing")
      parts.push(
        <button
          key="checks"
          className="link-btn pr-loud"
          disabled={busy}
          onClick={fixCi}
          title={`Failing: ${p.failing.join(", ")}\n${
            taker.kind === "busy"
              ? `${taker.agent.name} is mid-turn: fixing them is queued until it finishes`
              : taker.kind === "agent"
                ? `Click to ask ${taker.agent.name} to fix them`
                : "Click to start an agent to fix them"
          }`}
        >
          {p.failing.length === 1 ? "1 check failing" : `${p.failing.length} checks failing`}
        </button>,
      );
    else if (!done && p.checks === "pending") parts.push(<span key="checks">checks running</span>);
    else if (!done && p.checks === "passing") parts.push(<span key="checks">checks pass</span>);
    if (!done && p.conflicts) parts.push(<span key="conflicts" className={loud === "conflicts" ? "pr-loud" : undefined}>conflicts with base</span>);
    if (!done && p.review === "changes") parts.push(<span key="changes" className={loud === "changes" ? "pr-loud" : undefined}>changes requested</span>);
    if (!done && p.review === "approved") parts.push(<span key="approved">approved</span>);
    body = (
      <>
        <span className="pr-sentence">
          <button className="link-btn pr-link" onClick={() => void openLink(p.url)} title={`${p.title}\n${p.url}`}>
            #{p.number}
          </button>{" "}
          <span className={`pr-state pr-${p.state}`}>{STATE_LABEL[p.state]}</span>
          {parts.map((part, i) => (
            <span key={i}>
              <span className="pr-sep" aria-hidden>
                {" · "}
              </span>
              {part}
            </span>
          ))}
        </span>
        {p.state === "draft" && (
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await readyPr(worktree, p);
                flash(`Marked #${p.number} ready for review`);
              })
            }
            title={`Take #${p.number} out of draft so it can be reviewed and merged (gh pr ready)`}
          >
            {busy ? "Marking…" : "Mark ready"}
          </button>
        )}
        {p.state === "open" && p.checks !== "failing" && p.checks !== "pending" && !p.conflicts && p.review !== "changes" && (
          <button
            className="btn btn-sm btn-ship"
            disabled={busy || p.review === "required"}
            onClick={() => confirmMerge(p)}
            title={p.review === "required" ? "It needs an approving review first" : `Merge #${p.number} on GitHub`}
          >
            Merge
          </button>
        )}
        {p.state === "merged" && !!git.head && !!p.headOid && git.head !== p.headOid && (
          <span className="git-muted">new commits since</span>
        )}
        {done && cleanUpButton(p.state === "closed" ? "closed" : landed ? "landed" : "merged-newer")}
      </>
    );
  }
  if (!body) return null;

  return (
    <>
      <p className="pr-line">
        <PrGlyph />
        {body}
        {pr && pr.kind !== "unavailable" && (
          <button
            className="icon-btn pr-refresh"
            onClick={() => void refreshPrs([worktree.id])}
            title="Check GitHub again"
            aria-label="Check the pull request again"
          >
            ↻
          </button>
        )}
      </p>
      {dialog && <ConfirmDialog d={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function PrGlyph() {
  return (
    <svg className="pr-glyph" width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M4 3.5a1.5 1.5 0 1 1 0 .01M4 5v6m0 1.5a1.5 1.5 0 1 1 0-.01M12 12.5a1.5 1.5 0 1 1 0-.01M12 11V6.5a2 2 0 0 0-2-2H7.5m1.5-2-2 2 2 2"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
