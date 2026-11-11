import { useMemo, useState } from "react";
import { selectAgent } from "./Sidebar";
import { followUp } from "../nebula/actions";
import { request, sendInput } from "../nebula/client";
import { relativeTime } from "../nebula/status";
import { flash, getState, projectOfWorktree, setState, useAppState } from "../nebula/store";
import { LABEL_TEXT, ackState, acknowledge, useTriage, type QueueRow } from "../nebula/triage";
import { useReviews } from "../nebula/review";
import { queueOf, triageNow, useTriageStatus } from "../nebula/triageRunner";
import { putDownStuck, useStuck } from "../nebula/stuck";
import type { Agent } from "../nebula/types";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Open a queued session, noting for the usage log that the queue opened it. */
export function openQueued(row: QueueRow) {
  const agent = getState().agents[row.id];
  if (!agent) return;
  setState({ queueOpened: { agent: row.id, label: row.label, at: Date.now() } });
  selectAgent(agent);
}

/** The triage queue: every open session with what it needs from you, the
 *  ones that need you most first, and the stale ones. */
export function useTriageQueue(): { rows: QueueRow[]; stale: QueueRow[] } {
  const { agents, limits, git } = useAppState();
  const { records, acks } = useTriage();
  const stuck = useStuck();
  const reviews = useReviews();
  return useMemo(
    () => queueOf({ agents, limits, git }, records, acks, reviews.records, stuck),
    [agents, limits, git, records, acks, reviews.records, stuck],
  );
}

/** Where triage stands, and its one control: Triage now, or Turn on. */
function useTriageHint() {
  const state = useAppState();
  const status = useTriageStatus();
  const on = state.prefs.triageOn === true;
  const sub = !on
    ? "Triage is off, so only threads waiting on you show up."
    : status.running
      ? "Reading the threads that changed…"
      : status.at
        ? `Read ${relativeTime(status.at) === "now" ? "just now" : `${relativeTime(status.at)} ago`}${status.result?.calls ? `, ${status.result.sent} thread${status.result.sent === 1 ? "" : "s"} in ${status.result.calls} call${status.result.calls === 1 ? "" : "s"}` : ""}`
        : "Waiting for the first read";
  const control = on ? (
    <button className="link-btn" disabled={status.running} onClick={() => void triageNow()} title="Read the threads that changed since their last read now">
      Triage now
    </button>
  ) : (
    <button className="link-btn" onClick={() => setState({ view: "settings" })} title="Settings › Dispatch › Triage queue">
      Turn on in Settings
    </button>
  );
  return { sub, control, error: status.result?.errors[0] };
}

/** Triage's state as a quiet line, for when its section isn't shown. */
export function TriageHint() {
  const { sub, control, error } = useTriageHint();
  return (
    <p className="board-hint">
      <span>{error ? `Couldn't triage: ${error}` : sub}</span> {control}
    </p>
  );
}

/** The triage queue's section on the Dispatch board: the threads it lists
 *  that the board doesn't already show under a task. */
export function TriageQueue({ title, rows, stale }: { title: string; rows: QueueRow[]; stale: QueueRow[] }) {
  const { sub, control, error } = useTriageHint();
  return (
    <section className="board-group triage" aria-labelledby="triage-title">
      <div className="board-group-head">
        <h2 id="triage-title">
          {title}
          {rows.length > 0 && <span className="board-group-count">{rows.length}</span>}
        </h2>
        <span className="triage-sub">{sub}</span>
        {control}
      </div>
      {error && <p className="triage-error">Couldn't triage: {error}</p>}
      {rows.length === 0 ? (
        <p className="triage-empty">Nothing needs you right now.</p>
      ) : (
        <ul className="board-rows" aria-label="Triage queue">
          {rows.map((r) => (
            <TriageRow key={r.id} row={r} />
          ))}
        </ul>
      )}
      {stale.length > 0 && (
        <details className="triage-stale">
          <summary>
            {stale.length} stale thread{stale.length === 1 ? "" : "s"}
          </summary>
          <ul className="board-rows">
            {stale.map((r) => (
              <TriageRow key={r.id} row={r} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Each label's dot and chip tone, in the board rows' colours. */
const LABEL_DOT: Record<QueueRow["label"], string> = {
  decision: "dot-needs_feedback",
  stuck: "dot-failed",
  review: "dot-review",
  checked: "dot-finished",
  stale: "dot-pending",
};
export const LABEL_TONE: Record<QueueRow["label"], string> = {
  decision: "wait",
  stuck: "error",
  review: "review",
  checked: "ok",
  stale: "quiet",
};

/** A triage label as a chip. */
export function TriageChip({ row }: { row: QueueRow }) {
  return (
    <span className={`board-chip is-${LABEL_TONE[row.label]}`} title={row.need || undefined}>
      {LABEL_TEXT[row.label]}
    </span>
  );
}

/** What a triage row offers: a stuck session's Open and Stop, a checked
 *  one's Archive, and Got it. */
export function TriageActions({ row, agent }: { row: QueueRow; agent: Agent }) {
  const [busy, setBusy] = useState(false);
  const gotIt = () => {
    if (row.label === "stuck") putDownStuck(agent.id);
    acknowledge(agent.id, ackState(agent));
  };
  const archive = async () => {
    setBusy(true);
    try {
      await request("ArchiveAgent", { id: agent.id });
      flash(`Archived ${agent.name}`);
    } catch (e) {
      flash(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="triage-actions">
      {row.label === "stuck" && <StuckActions agent={agent} onOpen={() => openQueued(row)} />}
      {row.label === "checked" && (
        <button className="btn btn-sm" disabled={busy} onClick={() => void archive()} title="Archive this thread">
          Archive
        </button>
      )}
      <button className="btn btn-sm" onClick={gotIt} title="Take it out of the queue until it changes again">
        Got it
      </button>
    </div>
  );
}

/** What triage says the thread needs, and a stuck one's Redirect. */
export function TriageNeed({ row, agent }: { row: QueueRow; agent: Agent }) {
  return (
    <>
      {row.need && <p className="board-note">{row.need}</p>}
      {row.label === "stuck" && <Redirect agent={agent} />}
    </>
  );
}

function TriageRow({ row }: { row: QueueRow }) {
  const state = useAppState();
  const agent = state.agents[row.id];
  if (!agent) return null;
  const project = projectOfWorktree(state, agent.worktree_id)?.name ?? "";
  const branch = state.worktrees[agent.worktree_id]?.branch;
  return (
    <li className={`board-row triage-row is-${row.label}`}>
      <div className="board-line">
        <span className={`sdot ${LABEL_DOT[row.label]}`} aria-hidden />
        <button className="board-main" onClick={() => openQueued(row)} title={`Open ${agent.name}`}>
          <span className="board-title">{agent.name}</span>
        </button>
        <span className="board-target">{[project, branch].filter(Boolean).join(" / ")}</span>
        <span className="board-since" title="How long it's waited">
          {relativeTime(row.since)}
        </span>
        <TriageChip row={row} />
        <TriageActions row={row} agent={agent} />
      </div>
      <TriageNeed row={row} agent={agent} />
    </li>
  );
}

/** Esc, as a key press: Claude Code and Codex both stop the turn under way. */
const interrupt = (agent: Agent) => sendInput({ Agent: agent.id }, "\x1b");

/** A stuck row's way in: open it, or stop the turn while it's still going.
 *  Nothing is stopped on its own. */
function StuckActions({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const stop = async () => {
    try {
      await interrupt(agent);
      flash(`Stopped ${agent.name}'s turn`);
    } catch (e) {
      flash(errText(e));
    }
  };
  return (
    <>
      <button className="btn btn-sm" onClick={onOpen} title={`Open ${agent.name}`}>
        Open
      </button>
      {agent.status === "running" && (
        <button className="btn btn-sm" onClick={() => void stop()} title="Stop the turn under way, as Esc in its terminal">
          Stop
        </button>
      )}
    </>
  );
}

/** Tell a stuck session to do something else: a turn under way is stopped
 *  first. Once it runs again, its flag goes down. */
function Redirect({ agent }: { agent: Agent }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    try {
      if (agent.status === "running") {
        await interrupt(agent);
        await new Promise((r) => setTimeout(r, 800));
      }
      await followUp(getState().agents[agent.id] ?? agent, prompt, { select: false });
      setText("");
      flash(`Sent ${agent.name} where to go instead`);
    } catch (e) {
      flash(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="qa-reply triage-redirect"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
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
      <button className="btn btn-sm" type="submit" disabled={busy || !text.trim()}>
        Redirect
      </button>
    </form>
  );
}
