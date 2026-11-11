import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useOverlayKeys } from "./Overlay";
import { QuickAnswer } from "./QuickAnswer";
import { TriageQueue } from "./TriageQueue";
import { TaskBudget } from "./TaskBudget";
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
import { useHolds } from "../nebula/budget";
import { holdOn, holdSummary, holdText, type Holds } from "../nebula/budgetHold";
import {
  checkOffTask,
  dismissBatch,
  retryTask,
  startAnyway,
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
  clearableBatches,
  groupRows,
  redirectPrompt,
  taskTitle,
  type Group,
  type Phase,
  type Row,
} from "../nebula/board";
import type { Agent } from "../nebula/types";
import { reviewNote, useReviews } from "../nebula/review";

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

function statusText(r: Row, s: State, h: Holds): string {
  if (holdOn(r.task, h)) return "Held by budget";
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

/** Phases a row's status chip is coloured for: waiting on you, gone wrong,
 *  under way; the rest are quiet. */
function tone(p: Phase, held: boolean): "wait" | "error" | "run" | "quiet" {
  if (held || p === "plan" || p === "waiting") return "wait";
  if (p === "failed" || p === "blocked" || p === "stopped") return "error";
  if (p === "working" || p === "launching") return "run";
  return "quiet";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every dispatched task, in sections: what needs you, what's running,
 *  what's up next and what's done. */
export function DispatchBoard({ onOpenList }: { onOpenList: () => void }) {
  const state = useAppState();
  const batches = useBatches();
  const controls = useRef<HTMLDivElement>(null);
  useOverlayKeys(controls);
  const live = useMemo(() => batches.filter((b) => !b.dismissed), [batches]);
  const queued = useMemo(() => (id: string) => state.queue[id]?.length ?? 0, [state.queue]);
  const rows = useMemo(() => boardRows(live, state.agents, queued), [live, state.agents, queued]);
  const holds = useHolds();
  const groups = useMemo(() => groupRows(rows, (r) => !!holdOn(r.task, holds)), [rows, holds]);
  const clearable = useMemo(() => clearableBatches(rows), [rows]);
  const heldLine = useMemo(() => holdSummary(live.flatMap((b) => b.tasks), holds), [live, holds]);
  // Sessions already on the board aren't listed again under other threads.
  const onBoard = useMemo(() => new Set(rows.map((r) => r.agent?.id).filter((x): x is string => !!x)), [rows]);
  const count = (g: Group) => groups.find((x) => x.key === g)?.rows.length ?? 0;
  const summary = [
    count("needs") && `${count("needs")} ${count("needs") === 1 ? "needs" : "need"} you`,
    count("running") && `${count("running")} running`,
    count("next") && `${count("next")} up next`,
    count("done") && `${count("done")} done`,
    heldLine,
  ]
    .filter(Boolean)
    .join(", ");
  const settledLeft = live.filter(
    (b) => !clearable.includes(b.id) && batchSummary(b.tasks, state.agents, queued).settled,
  );
  const triage = <TriageQueue title={rows.length ? "Other threads" : "What needs you"} exclude={onBoard} />;

  return (
    <section className="usage board" aria-labelledby="board-title">
      <header className="usage-head" data-tauri-drag-region>
        <div>
          <h1 id="board-title">Dispatch board</h1>
          <p className="usage-sub">{rows.length ? summary : "Every task you dispatch shows up here until you clear it."}</p>
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
      <div className="usage-body board-body">
        {groups[0]?.key !== "needs" && triage}
        {rows.length === 0 ? (
          <p className="usage-empty">
            Nothing dispatched yet.{" "}
            <button className="link-btn" onClick={onOpenList}>
              Paste your to-do list
            </button>{" "}
            and route it.
          </p>
        ) : (
          groups.map((g) => (
            <Fragment key={g.key}>
              <section className={`board-group is-${g.key}`} aria-labelledby={`board-group-${g.key}`}>
                <div className="board-group-head">
                  <h2 id={`board-group-${g.key}`}>
                    {g.label}
                    <span className="board-group-count">{g.rows.length}</span>
                  </h2>
                  {g.key === "done" && clearable.length > 0 && (
                    <button
                      className="link-btn"
                      onClick={() => clearable.forEach(dismissBatch)}
                      title={`Take the ${plural(clearable.length, "batch", "batches")} whose every task is done off the board`}
                    >
                      Clear done
                    </button>
                  )}
                </div>
                <ul className="board-rows" aria-label={g.label}>
                  {g.rows.map((r) => (
                    <BoardRow key={r.task.id} row={r} state={state} holds={holds} compact={g.key === "done"} />
                  ))}
                </ul>
                {g.key === "done" && <Batches batches={settledLeft} />}
              </section>
              {g.key === "needs" && triage}
            </Fragment>
          ))
        )}
        {rows.length > 0 && count("done") === 0 && <Batches batches={settledLeft} />}
      </div>
    </section>
  );
}

/** Settled batches with something besides done tasks left in them, which
 *  Clear done leaves: each can still be dismissed as a whole. */
function Batches({ batches }: { batches: Batch[] }) {
  const { agents, queue } = useAppState();
  if (!batches.length) return null;
  return (
    <ul className="board-batches" aria-label="Settled batches">
      {batches.map((b) => {
        const s = batchSummary(b.tasks, agents, (id) => queue[id]?.length ?? 0);
        return (
          <li key={b.id}>
            <span>
              Batch from {relativeTime(b.at) === "now" ? "just now" : `${relativeTime(b.at)} ago`}:{" "}
              {plural(b.tasks.length, "task")}
              {s.text && `, ${s.text}`}
            </span>
            <button
              className="link-btn"
              onClick={() => dismissBatch(b.id)}
              title="Take all of this batch's tasks off the board; its unchecked items can be routed again"
            >
              Dismiss batch
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function BoardRow({ row, state, holds, compact }: { row: Row; state: State; holds: Holds; compact: boolean }) {
  const { task: t, agent, phase, batchId } = row;
  const open = agent ? () => selectAgent(agent) : undefined;
  const checkable = CHECKABLE.has(phase) || (t.target === "you" && phase === "blocked" && !agent);
  const held = !!holdOn(t, holds);
  const dot = agent && !agent.archived ? `dot-${agent.status}` : `dot-${phase}`;
  const title = taskTitle(t.text, agent?.name);
  const body = !compact && t.text.trim() !== title ? t.text.trim() : null;
  return (
    <li className={`board-row is-${phase}${compact ? " is-compact" : ""}`}>
      <div className="board-line">
        <span className={`sdot ${phase === "plan" ? "dot-needs_feedback" : dot}`} aria-hidden />
        {open ? (
          <button className="board-main" onClick={open} title={`Open ${agent!.name}`}>
            <span className="board-title">{title}</span>
          </button>
        ) : (
          <span className="board-main" title={title}>
            <span className="board-title">{title}</span>
          </span>
        )}
        {compact && agent && <Changes agent={agent} state={state} compact />}
        <span className="board-target">{targetText(t, agent, state)}</span>
        <span className={`board-chip is-${tone(phase, held)}`}>{statusText(row, state, holds)}</span>
        {checkable &&
          (t.done ? (
            <button
              className="link-btn board-check"
              onClick={() => checkOffTask(batchId, t.id, false)}
              aria-label={`Uncheck ${title}`}
              title="Put it back: its items in the to-do list are unchecked too"
            >
              Uncheck
            </button>
          ) : (
            <button
              className="link-btn board-check"
              onClick={() => checkOffTask(batchId, t.id, true)}
              aria-label={`Check off ${title}`}
              title="Mark it done: its items in the to-do list are checked too"
            >
              Check off
            </button>
          ))}
      </div>
      {body && <Prompt text={body} />}
      {!compact && (
        <>
          {t.state === "launched" && t.past && t.note && t.note !== "queued" && <p className="board-note">{t.note}</p>}
          <RowDetail row={row} holds={holds} />
          {agent && (
            <div className="board-foot">
              {phase === "working" && agent.status === "running" && <LastLine agent={agent} />}
              {(phase === "finished" || phase === "stopped") && <Changes agent={agent} state={state} />}
              <ReviewLine agentId={agent.id} />
              {!agent.archived && <TaskBudget batchId={batchId} task={t} agent={agent} />}
            </div>
          )}
        </>
      )}
      {compact && agent && <ReviewLine agentId={agent.id} />}
    </li>
  );
}

/** A task's whole text under its title, two lines until opened. */
function Prompt({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const id = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <div className="board-prompt-wrap">
      <p id={id} ref={ref} className={`board-prompt${open ? " is-open" : ""}`}>
        {text}
      </p>
      {(clipped || open) && (
        <button className="link-btn board-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/** The check before "done", on a launched task's row (review.ts). */
function ReviewLine({ agentId }: { agentId: string }) {
  const { records, checking } = useReviews();
  const note = reviewNote(records[agentId], checking.has(agentId));
  return note ? <p className="board-note board-review">{note}</p> : null;
}

function RowDetail({ row, holds }: { row: Row; holds: Holds }) {
  const { task: t, agent, phase, batchId } = row;
  const hold = holdOn(t, holds);
  if (hold)
    return (
      <div className="board-note">
        <span>{holdText(hold)} </span>
        <button
          className="btn btn-sm"
          onClick={() => {
            if (startAnyway(batchId, t.id)) kickBatches();
          }}
          title="Launch this task despite the budget; the others stay held"
        >
          Start anyway
        </button>
      </div>
    );
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
  // A running line and a diff stat go in the row's foot, beside its budget.
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
function Changes({ agent, state, compact }: { agent: Agent; state: State; compact?: boolean }) {
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
        {files} {files === 1 ? "file" : "files"}
        {!compact && " changed"}{" "}
        <span className="git-add">+{git.insertions}</span> <span className="git-del">−{git.deletions}</span>
      </span>,
    );
  if (commits > 0 && !compact) parts.push(<span>{commits} {commits === 1 ? "commit" : "commits"} on {wt.branch}</span>);
  if (files > 0 || commits > 0)
    parts.push(
      <button className="link-btn" onClick={() => openReview(wt.id)}>
        Review
      </button>,
    );
  if (pr?.kind === "found")
    parts.push(
      <button className="link-btn" onClick={() => void openLink(pr.pr.url)} title={pr.pr.title}>
        PR #{pr.pr.number} ({pr.pr.state.toLowerCase()})
      </button>,
    );
  if (!parts.length) parts.push(<span className="git-muted">No changes</span>);
  const Tag = compact ? "span" : "p";
  return (
    <Tag className={`git-line board-changes${compact ? " is-compact" : ""}`}>
      {parts.map((p, i) => (
        <span key={i} className="git-part">
          {p}
        </span>
      ))}
    </Tag>
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
