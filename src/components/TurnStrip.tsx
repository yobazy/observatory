import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "../nebula/client";
import { openReview } from "../nebula/diff";
import { getState, useAppState } from "../nebula/store";
import { changedFiles } from "../nebula/git";
import { relativeTime } from "../nebula/status";
import { duration, summarize, type Turn } from "../nebula/turnsummary";
import { noteTurn } from "../nebula/verdicts";
import { Resizer, TURN_STRIP, useColumnWidth } from "./Resizer";
import type { Agent, Worktree } from "../nebula/types";

const OPEN_KEY = "observatory.turnStrip.open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Remembering it is a nicety.
  }
}

// Hidden altogether, for every thread, until the header's Summary button
// brings it back; remembered on this Mac.
const HIDDEN_KEY = "observatory.turnStrip.hidden";
let hidden = (() => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
})();
const hiddenListeners = new Set<() => void>();

export function useTurnLineHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      hiddenListeners.add(l);
      return () => hiddenListeners.delete(l);
    },
    () => hidden,
  );
}

export function setTurnLineHidden(next: boolean) {
  hidden = next;
  try {
    localStorage.setItem(HIDDEN_KEY, next ? "1" : "0");
  } catch {
    // Remembering it is a nicety.
  }
  hiddenListeners.forEach((l) => l());
}

/** Whether the thread keeps a log this app reads: Claude Code's, or Codex's
 *  (both in turns.rs). */
export function hasLog(agent: Agent): boolean {
  return (agent.kind === "claude" || agent.kind === "codex") && !!agent.session_id;
}

/** The thread's latest turn, read again as it moves. */
export function useTurn(agent: Agent): Turn | null {
  const [turn, setTurn] = useState<Turn | null>(null);
  const session = hasLog(agent) ? agent.session_id : null;
  const running = agent.status === "running";
  useEffect(() => {
    if (!session) return;
    let live = true;
    const read = async () => {
      try {
        const t = isPreview()
          ? (await import("../nebula/mock")).mockTurn(getState(), agent.id)
          : await invoke<Turn | null>("thread_turn", { session, kind: agent.kind });
        if (live) {
          setTurn(t);
          noteTurn(getState().agents[agent.id] ?? agent, t);
        }
      } catch {
        // No log to read: the strip just doesn't show.
      }
    };
    void read();
    // While it works the log grows; once it stops, the status change reads it.
    const timer = running ? window.setInterval(read, 3000) : undefined;
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [session, agent.id, running, agent.status, agent.status_changed_at]);
  return turn;
}

const harness = (agent: Agent) => (agent.kind === "codex" ? "Codex" : "Claude");

function Mark({ ok }: { ok: boolean | null }) {
  return ok === null ? (
    <span className="ts-mark is-pending" aria-label="Running">
      …
    </span>
  ) : ok ? (
    <span className="ts-mark is-ok" aria-label="Worked">
      ✓
    </span>
  ) : (
    <span className="ts-mark is-bad" aria-label="Failed">
      ✕
    </span>
  );
}

/** One quiet line above the terminal: what the thread did in its latest
 *  turn, from its log, and the turn itself on a click. */
export function TurnStrip({ agent, worktree }: { agent: Agent; worktree: Worktree | undefined }) {
  const turn = useTurn(agent);
  const [open, setOpen] = useState(readOpen);
  const [height, setHeight] = useColumnWidth(TURN_STRIP);
  const body = useRef<HTMLDivElement>(null);
  const git = useAppState().git[worktree?.id ?? ""];
  const off = useTurnLineHidden();
  if (!turn || off) return null;
  // However tall you dragged it, the terminal keeps some room below.
  const room = Math.max(TURN_STRIP.min, Math.min(height, window.innerHeight - 220));
  const working = agent.status === "running";
  const sum = summarize(turn, worktree?.path ?? "", agent.status === "needs_feedback");
  const ago = relativeTime(turn.last * 1000);
  const took = duration((working ? Date.now() / 1000 : turn.last) - turn.started);
  const toggle = () => {
    setOpen(!open);
    writeOpen(!open);
  };
  const commands = sum.commands.slice(-12);
  const failed = sum.commands.filter((c) => c.ok === false).length;
  // A finished turn that left changes behind: reviewing them is the next step.
  const reviewable = !working && sum.edited.length > 0 && !!git && !("error" in git) && changedFiles(git) > 0;

  return (
    <div className={`turn-strip${open ? " is-open" : ""}`}>
      <div className="ts-row">
        <button className="ts-line" onClick={toggle} aria-expanded={open} title={open ? "Hide this turn" : "Show this turn"}>
          <span className="ts-lead">{working ? `Working · ${took}` : `Last turn · ${took}`}</span>
          <span className="ts-parts">
            {sum.headline.map((p, i) => (
              <span key={p.text} className={`ts-part${p.tone ? ` is-${p.tone}` : ""}`}>
                {i > 0 && <span className="ts-sep" aria-hidden>·</span>}
                {p.text}
              </span>
            ))}
          </span>
          {!working && ago && <span className="ts-ago">{ago === "now" ? "just now" : `${ago} ago`}</span>}
          <span className="ts-chev" aria-hidden>
            {open ? "▴" : "▾"}
          </span>
        </button>
        {reviewable && worktree && (
          <button
            className="btn btn-sm ts-review"
            onClick={() => openReview(worktree.id, agent.id)}
            title="Review the changes, comment, and send them back or commit"
          >
            Review changes
          </button>
        )}
        <button
          className="icon-btn ts-hide"
          onClick={() => setTurnLineHidden(true)}
          aria-label="Hide the turn summary"
          title="Hide this summary on every thread. Summary, at the top of a thread, brings it back."
        >
          ×
        </button>
      </div>
      {open && (
        <div className="ts-body" ref={body} style={{ maxHeight: room }}>
          <section>
            <h4>You asked</h4>
            <p className="ts-prose">{turn.prompt}</p>
          </section>
          {sum.asking && (
            <section>
              <h4>Waiting on you</h4>
              <p className="ts-prose ts-ask">{sum.asking}</p>
            </section>
          )}
          {sum.edited.length > 0 && (
            <section>
              <h4>
                Changed {sum.edited.length} {sum.edited.length === 1 ? "file" : "files"}
                {worktree && (
                  <button className="link-btn ts-h-link" onClick={() => openReview(worktree.id, agent.id)}>
                    Review diff
                  </button>
                )}
              </h4>
              <ul className="ts-files">
                {sum.edited.map((p) => (
                  <li key={p} title={p}>
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {turn.said && turn.said.trim() !== sum.asking && (
            <section>
              <h4>{working ? `Latest from ${harness(agent)}` : `${harness(agent)}'s last words`}</h4>
              <p className="ts-prose">{turn.said}</p>
            </section>
          )}
          {commands.length > 0 && (
            <details className="ts-fold">
              <summary>
                Ran {sum.commands.length} {sum.commands.length === 1 ? "command" : "commands"}
                {failed > 0 && <span className="ts-fold-bad">, {failed} failed</span>}
                {sum.looked > 0 && `, looked through ${sum.looked} ${sum.looked === 1 ? "file" : "files"}`}
              </summary>
              {commands.length < sum.commands.length && <p className="ts-foot">The last {commands.length}:</p>}
              <ul className="ts-commands">
                {commands.map((c, i) => (
                  <li key={i} title={c.command}>
                    <Mark ok={c.ok} />
                    <span className="ts-cmd-note">{c.note ?? c.command}</span>
                    {c.note && <code>{c.command}</code>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {commands.length === 0 && sum.looked > 0 && (
            <p className="ts-foot">
              Looked through {sum.looked} {sum.looked === 1 ? "file" : "files"}.
            </p>
          )}
        </div>
      )}
      {open && (
        <Resizer spec={TURN_STRIP} width={room} onWidth={setHeight} rows measure={() => body.current?.offsetHeight} />
      )}
    </div>
  );
}

/** The top of a review: what the thread was asked and what its last turn
 *  did, so the diff reads against what it was for. */
export function TurnBrief({ agent, worktree }: { agent: Agent; worktree: Worktree }) {
  const turn = useTurn(agent);
  if (!turn) return null;
  const sum = summarize(turn, worktree.path, agent.status === "needs_feedback");
  return (
    <section className="turn-brief" aria-label={`What ${agent.name} did`}>
      <p className="tb-head">
        <span className="tb-name">{agent.name}</span>
        {sum.headline.map((p) => (
          <span key={p.text} className={`ts-part${p.tone ? ` is-${p.tone}` : ""}`}>
            <span className="ts-sep" aria-hidden>
              ·
            </span>
            {p.text}
          </span>
        ))}
      </p>
      <p className="tb-asked">
        <span className="tb-label">You asked</span> {turn.prompt}
      </p>
      {turn.said && <p className="ts-prose ts-clamp tb-said">{turn.said}</p>}
    </section>
  );
}
