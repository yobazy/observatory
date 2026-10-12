import { useEffect, useMemo, useRef, useState } from "react";
import { useOverlayKeys } from "./Overlay";
import { QuickAnswer } from "./QuickAnswer";
import { selectAgent } from "./Sidebar";
import { openLink } from "./Run";
import { followUp } from "../nebula/actions";
import { request } from "../nebula/client";
import { openReview } from "../nebula/diff";
import { changedFiles } from "../nebula/git";
import { lastRows, readScreen } from "../nebula/screen";
import { relativeTime, statusLabel } from "../nebula/status";
import { flash, setState, useAppState, type State } from "../nebula/store";
import { kickBatches } from "../nebula/batchRunner";
import {
  checkOffTask,
  dismissBatch,
  retryTask,
  updateTask,
  useBatches,
  type Batch,
  type BatchTask,
} from "../nebula/batch";
import {
  PLAN_APPROVED,
  activityLine,
  batchSummary,
  boardRows,
  redirectPrompt,
  type Phase,
  type Row,
} from "../nebula/board";
import type { Agent } from "../nebula/types";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** How often a running row's line is read, and only while it's on screen:
 *  each read replays the terminal's tail into an off-screen xterm. */
const LINE_MS = 5_000;

const PHASE_LABEL: Partial<Record<Phase, string>> = {
  pending: "Waiting for a slot",
  launching: "Starting…",
  blocked: "Blocked",
  failed: "Failed",
  listed: "On your list",
  plan: "Plan ready for your OK",
  archived: "Archived",
  gone: "Session removed",
  cancelled: "Cancelled",
  done: "Checked off",
};

/** Phases a row can be checked off in: nothing more will happen on its own. */
const CHECKABLE = new Set<Phase>(["listed", "finished", "stopped", "archived", "gone", "done"]);

function statusText(r: Row, s: State): string {
  if (r.phase === "working" && r.agent && (s.queue[r.agent.id]?.length ?? 0) > 0) return "Queued";
  if (r.phase === "working" && !r.agent) return "Starting…";
  if (r.agent && (r.phase === "waiting" || r.phase === "working" || r.phase === "finished" || r.phase === "stopped"))
    return statusLabel(r.agent);
  return PHASE_LABEL[r.phase] ?? r.phase;
}

/** Where the task went: project / branch / chat, or Home, or You. */
function targetText(t: BatchTask, agent: Agent | undefined, s: State): string {
  if (t.target === "you") return agent ? "You, booked via Home" : "You";
  if (t.target === "home") return "Home";
  const project = t.projectId ? s.projects[t.projectId]?.name ?? "Project" : "Project";
  const wtId = agent?.worktree_id ?? t.createdWorktreeId ?? t.worktreeId;
  const wt = wtId ? s.worktrees[wtId] : undefined;
  const branch = wt?.branch ?? (t.mode === "new_worktree" ? "new worktree" : "main checkout");
  const parts = [project, branch];
  if (t.mode === "existing_chat") parts.push(agent?.name ?? "chat");
  return parts.join(" / ");
}

/** Every dispatched task in one list, the ones that need you first. */
export function DispatchBoard({ onOpenList }: { onOpenList: () => void }) {
  const state = useAppState();
  const batches = useBatches();
  const controls = useRef<HTMLDivElement>(null);
  useOverlayKeys(controls);
  const live = useMemo(() => batches.filter((b) => !b.dismissed), [batches]);
  const queued = useMemo(() => (id: string) => state.queue[id]?.length ?? 0, [state.queue]);
  const rows = useMemo(() => boardRows(live, state.agents, queued), [live, state.agents, queued]);
  const all = useMemo(
    () => batchSummary(live.flatMap((b) => b.tasks), state.agents, queued),
    [live, state.agents, queued],
  );
  const working = rows.filter((r) => r.phase === "working" || r.phase === "launching" || r.phase === "pending").length;

  return (
    <section className="usage board" aria-labelledby="board-title">
      <header className="usage-head" data-tauri-drag-region>
        <div>
          <h1 id="board-title">Dispatch board</h1>
          <p className="usage-sub">
            {rows.length
              ? [working && `${working} in progress`, all.text].filter(Boolean).join(", ")
              : "Every task you dispatch shows up here until you dismiss its batch."}
          </p>
        </div>
        <div className="usage-controls" ref={controls}>
          <button className="btn btn-sm" onClick={onOpenList}>
            To-do list
          </button>
          <button className="btn btn-sm" onClick={() => setState({ view: "sessions" })} title="Back to sessions (Esc)">
            Done
          </button>
        </div>
      </header>
      <div className="usage-body">
        {rows.length === 0 ? (
          <p className="usage-empty">
            Nothing dispatched yet.{" "}
            <button className="link-btn" onClick={onOpenList}>
              Paste your to-do list
            </button>{" "}
            and route it.
          </p>
        ) : (
          <>
            <ul className="board-rows" aria-label="Dispatched tasks">
              {rows.map((r) => (
                <BoardRow key={r.task.id} row={r} state={state} />
              ))}
            </ul>
            <Batches batches={live} />
          </>
        )}
      </div>
    </section>
  );
}

/** Each batch on the board, with how it stands; a settled one can be dismissed. */
function Batches({ batches }: { batches: Batch[] }) {
  const { agents, queue } = useAppState();
  return (
    <ul className="board-batches" aria-label="Batches">
      {batches.map((b) => {
        const s = batchSummary(b.tasks, agents, (id) => queue[id]?.length ?? 0);
        return (
          <li key={b.id}>
            <span className="board-batch-when">Dispatched {relativeTime(b.at)}</span>
            <span>
              {b.tasks.length} {b.tasks.length === 1 ? "task" : "tasks"}
              {s.text && `: ${s.text}`}
              {!s.settled && ", still going"}
            </span>
            {s.settled && (
              <button className="link-btn" onClick={() => dismissBatch(b.id)} title="Take this batch off the board; its unchecked items can be routed again">
                Dismiss
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BoardRow({ row, state }: { row: Row; state: State }) {
  const { task: t, agent, phase, batchId } = row;
  const open = agent ? () => selectAgent(agent) : undefined;
  const checkable = CHECKABLE.has(phase) || (t.target === "you" && phase === "blocked" && !agent);
  const dot = agent && !agent.archived ? `dot-${agent.status}` : `dot-${phase}`;
  return (
    <li className={`board-row is-${phase}`}>
      <div className="board-line">
        {checkable ? (
          <input
            type="checkbox"
            checked={!!t.done}
            onChange={(e) => checkOffTask(batchId, t.id, e.target.checked)}
            aria-label={`Check off ${t.text}`}
            title="Check off: its items in the to-do list are checked too"
          />
        ) : (
          <span className={`sdot ${phase === "plan" ? "dot-needs_feedback" : dot}`} aria-hidden />
        )}
        {open ? (
          <button className="board-main" onClick={open} title={`Open ${agent!.name}`}>
            <RowHead row={row} state={state} />
          </button>
        ) : (
          <div className="board-main">
            <RowHead row={row} state={state} />
          </div>
        )}
      </div>
      <RowDetail row={row} state={state} />
    </li>
  );
}

function RowHead({ row, state }: { row: Row; state: State }) {
  return (
    <>
      <span className="board-text">{row.task.text}</span>
      <span className="board-target">{targetText(row.task, row.agent, state)}</span>
      <span className={`board-status is-${row.phase}`}>{statusText(row, state)}</span>
    </>
  );
}

function RowDetail({ row, state }: { row: Row; state: State }) {
  const { task: t, agent, phase, batchId } = row;
  if (phase === "blocked" && t.note) return <p className="board-note">{t.note}</p>;
  if (phase === "failed") {
    const unsure = /cut short/i.test(t.note ?? "");
    return (
      <div className="board-note">
        {t.note && <span>{t.note} </span>}
        <button
          className="btn btn-sm"
          onClick={() => {
            if (retryTask(batchId, t.id)) kickBatches();
          }}
          title={unsure ? "It may have started after all: check the project for its session first" : "Launch it again"}
        >
          Retry
        </button>
      </div>
    );
  }
  if (!agent) return null;
  if (phase === "plan") return <PlanCheckpoint batchId={batchId} task={t} agent={agent} />;
  if (phase === "waiting") return <QuickAnswer agent={agent} onOpen={() => selectAgent(agent)} />;
  if (phase === "working" && agent.status === "running") return <LastLine agent={agent} />;
  if (phase === "finished" || phase === "stopped" || phase === "done" || phase === "archived")
    return <Changes agent={agent} state={state} />;
  return null;
}

/** What a running session is doing, read off its screen while the row is
 *  in view. */
function LastLine({ agent }: { agent: Agent }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [line, setLine] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    // Each read waits for the last, and rows don't all read at once.
    const read = async () => {
      if (!document.hidden) {
        const lines = await readScreen(agent).catch(() => null);
        if (!live) return;
        setLine(lines ? activityLine(lines) : null);
      }
      timer = setTimeout(read, LINE_MS + Math.random() * 1_000);
    };
    timer = setTimeout(read, Math.random() * 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The poll only needs the id; restarting it on every update would read more.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, agent.alive, seen]);

  return (
    <p className="board-activity" ref={ref}>
      {line ?? " "}
    </p>
  );
}

/** A finished task's diff stat, and its PR when there is one. */
function Changes({ agent, state }: { agent: Agent; state: State }) {
  const wt = state.worktrees[agent.worktree_id];
  const git = state.git[agent.worktree_id];
  const pr = state.prs[agent.worktree_id];
  if (!wt || !git || "error" in git) return null;
  const files = changedFiles(git);
  const commits = !wt.is_main ? (git.baseAhead ?? 0) : 0;
  const parts: React.ReactNode[] = [];
  if (files > 0)
    parts.push(
      <span>
        {files} {files === 1 ? "file" : "files"} changed{" "}
        <span className="git-add">+{git.insertions}</span> <span className="git-del">−{git.deletions}</span>
      </span>,
    );
  if (commits > 0) parts.push(<span>{commits} {commits === 1 ? "commit" : "commits"} on {wt.branch}</span>);
  if (files > 0 || commits > 0)
    parts.push(
      <button className="link-btn" onClick={() => openReview(wt.id)}>
        Review
      </button>,
    );
  if (pr?.kind === "found")
    parts.push(
      <button className="link-btn" onClick={() => void openLink(pr.pr.url)} title={pr.pr.title}>
        PR #{pr.pr.number} ({pr.pr.state})
      </button>,
    );
  if (!parts.length) parts.push(<span className="git-muted">No changes</span>);
  return (
    <p className="git-line board-changes">
      {parts.map((p, i) => (
        <span key={i} className="git-part">
          {p}
        </span>
      ))}
    </p>
  );
}

/** A session stopped at its plan: the end of its screen, and Approve,
 *  Redirect or Cancel. */
function PlanCheckpoint({ batchId, task, agent }: { batchId: string; task: BatchTask; agent: Agent }) {
  const [screen, setScreen] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void readScreen(agent)
      .then((lines) => live && setScreen(lines ? lastRows(lines, 8) : null))
      .catch(() => {});
    return () => {
      live = false;
    };
    // Read once per stop: the plan doesn't change while it waits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, agent.status_changed_at]);

  const act = async (what: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await what();
    } catch (e) {
      flash(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    act(async () => {
      await followUp(agent, PLAN_APPROVED, { select: false });
      updateTask(batchId, task.id, { planApproved: true });
      flash(`Approved ${agent.name}'s plan`);
    });

  const redirect = () => {
    const prompt = redirectPrompt(text);
    if (!prompt) return;
    return act(async () => {
      // Stamped before it goes, so a quick reply still counts as after it.
      const before = task.planAnsweredAt;
      updateTask(batchId, task.id, { planAnsweredAt: Date.now() });
      try {
        await followUp(agent, prompt, { select: false });
      } catch (e) {
        updateTask(batchId, task.id, { planAnsweredAt: before });
        throw e;
      }
      setText("");
      flash(`Sent ${agent.name} your changes to its plan`);
    });
  };

  const cancel = () =>
    act(async () => {
      await request("ArchiveAgent", { id: agent.id });
      updateTask(batchId, task.id, { cancelled: true });
      flash(`Cancelled ${agent.name}`);
    });

  return (
    <div className="qa board-plan" role="group" aria-label={`${agent.name}'s plan`}>
      {screen && screen.length > 0 && <pre className="qa-tail">{screen.join("\n")}</pre>}
      <div className="board-plan-actions">
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void approve()}>
          Approve
        </button>
        <form
          className="qa-reply"
          onSubmit={(e) => {
            e.preventDefault();
            void redirect();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Redirect: what to do instead…"
            aria-label={`Redirect ${agent.name}`}
            spellCheck={false}
            disabled={busy}
          />
          <button className="btn btn-sm" type="submit" disabled={busy || !redirectPrompt(text)}>
            Redirect
          </button>
        </form>
        <button className="btn btn-sm" disabled={busy} onClick={() => void cancel()} title="Archive the session">
          Cancel
        </button>
      </div>
    </div>
  );
}
