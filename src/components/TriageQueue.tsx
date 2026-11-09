import { useMemo, useState } from "react";
import { selectAgent } from "./Sidebar";
import { request } from "../nebula/client";
import { relativeTime } from "../nebula/status";
import { flash, getState, projectOfWorktree, setState, useAppState } from "../nebula/store";
import { LABEL_TEXT, ackState, acknowledge, useTriage, type QueueRow } from "../nebula/triage";
import { queueOf, triageNow, useTriageStatus } from "../nebula/triageRunner";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Open a queued session, noting for the usage log that the queue opened it. */
export function openQueued(row: QueueRow) {
  const agent = getState().agents[row.id];
  if (!agent) return;
  setState({ queueOpened: { agent: row.id, label: row.label, at: Date.now() } });
  selectAgent(agent);
}

/** The triage queue, at the top of the Dispatch board: every open session
 *  with what it needs from you, the ones that need you most first. */
export function TriageQueue() {
  const state = useAppState();
  const { records, acks } = useTriage();
  const status = useTriageStatus();
  const { agents, limits } = state;
  const queue = useMemo(() => queueOf({ agents, limits }, records, acks), [agents, limits, records, acks]);
  const on = state.prefs.triageOn === true;
  const error = status.result?.errors[0];

  const sub = !on
    ? "Triage is off, so only threads waiting on you show here."
    : status.running
      ? "Reading the threads that changed…"
      : status.at
        ? `Read ${relativeTime(status.at) === "now" ? "just now" : `${relativeTime(status.at)} ago`}${status.result?.calls ? `, ${status.result.sent} thread${status.result.sent === 1 ? "" : "s"} in ${status.result.calls} call${status.result.calls === 1 ? "" : "s"}` : ""}`
        : "Waiting for the first read";

  return (
    <section className="triage" aria-labelledby="triage-title">
      <div className="triage-head">
        <h2 id="triage-title">What needs you</h2>
        <span className="triage-sub">{sub}</span>
        {on ? (
          <button className="link-btn" disabled={status.running} onClick={() => void triageNow()} title="Read the threads that changed since their last read now">
            Triage now
          </button>
        ) : (
          <button className="link-btn" onClick={() => setState({ view: "settings" })} title="Settings › Dispatch › Triage queue">
            Turn on in Settings
          </button>
        )}
      </div>
      {error && <p className="triage-error">Couldn't triage: {error}</p>}
      {queue.rows.length === 0 ? (
        <p className="triage-empty">Nothing needs you right now.</p>
      ) : (
        <ul className="board-rows" aria-label="Triage queue">
          {queue.rows.map((r) => (
            <TriageRow key={r.id} row={r} />
          ))}
        </ul>
      )}
      {queue.stale.length > 0 && (
        <details className="triage-stale">
          <summary>
            {queue.stale.length} stale thread{queue.stale.length === 1 ? "" : "s"}
          </summary>
          <ul className="board-rows">
            {queue.stale.map((r) => (
              <TriageRow key={r.id} row={r} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TriageRow({ row }: { row: QueueRow }) {
  const state = useAppState();
  const [busy, setBusy] = useState(false);
  const agent = state.agents[row.id];
  if (!agent) return null;
  const project = projectOfWorktree(state, agent.worktree_id)?.name ?? "";
  const branch = state.worktrees[agent.worktree_id]?.branch;
  const gotIt = () => acknowledge(agent.id, ackState(agent));
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
    <li className={`board-row triage-row is-${row.label}`}>
      <div className="board-line">
        <span className={`triage-label is-${row.label}`}>{LABEL_TEXT[row.label]}</span>
        <button className="board-main" onClick={() => openQueued(row)} title={`Open ${agent.name}`}>
          <span className="board-text">{agent.name}</span>
          <span className="board-target">{[project, branch].filter(Boolean).join(" / ")}</span>
          <span className="board-status" title="How long it's waited">
            {relativeTime(row.since)}
          </span>
        </button>
        <div className="triage-actions">
          {row.label === "checked" && (
            <button className="btn btn-sm" disabled={busy} onClick={() => void archive()} title="Archive this thread">
              Archive
            </button>
          )}
          <button className="btn btn-sm" onClick={gotIt} title="Take it out of the queue until it changes again">
            Got it
          </button>
        </div>
      </div>
      {row.need && <p className="board-note">{row.need}</p>}
    </li>
  );
}
