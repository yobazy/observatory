import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "../nebula/client";
import { openReview } from "../nebula/diff";
import { getState } from "../nebula/store";
import { relativeTime } from "../nebula/status";
import { duration, summarize, type Turn } from "../nebula/turnsummary";
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

/** The thread's latest turn, read again as it moves. */
function useTurn(agent: Agent): Turn | null {
  const [turn, setTurn] = useState<Turn | null>(null);
  const session = agent.kind === "claude" ? agent.session_id : null;
  const running = agent.status === "running";
  useEffect(() => {
    if (!session) return;
    let live = true;
    const read = async () => {
      try {
        const t = isPreview()
          ? (await import("../nebula/mock")).mockTurn(getState(), agent.id)
          : await invoke<Turn | null>("thread_turn", { session });
        if (live) setTurn(t);
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
  if (!turn) return null;
  const working = agent.status === "running";
  const sum = summarize(turn, worktree?.path ?? "", agent.status === "needs_feedback");
  const ago = relativeTime(turn.last * 1000);
  const took = duration((working ? Date.now() / 1000 : turn.last) - turn.started);
  const toggle = () => {
    setOpen(!open);
    writeOpen(!open);
  };
  const commands = sum.commands.slice(-12);

  return (
    <div className={`turn-strip${open ? " is-open" : ""}`}>
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
      {open && (
        <div className="ts-body">
          <section>
            <h4>You asked</h4>
            <p className="ts-prose ts-clamp">{turn.prompt}</p>
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
                  <button className="link-btn ts-h-link" onClick={() => openReview(worktree.id)}>
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
          {commands.length > 0 && (
            <section>
              <h4>
                Ran {sum.commands.length} {sum.commands.length === 1 ? "command" : "commands"}
                {commands.length < sum.commands.length && <span className="ts-h-note">, the last {commands.length}</span>}
              </h4>
              <ul className="ts-commands">
                {commands.map((c, i) => (
                  <li key={i} title={c.command}>
                    <Mark ok={c.ok} />
                    <span className="ts-cmd-note">{c.note ?? c.command}</span>
                    {c.note && <code>{c.command}</code>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {turn.said && turn.said.trim() !== sum.asking && (
            <section>
              <h4>{working ? "Latest from Claude" : "Claude's last words"}</h4>
              <p className="ts-prose ts-clamp">{turn.said}</p>
            </section>
          )}
          {sum.looked > 0 && (
            <p className="ts-foot">
              Looked through {sum.looked} {sum.looked === 1 ? "file" : "files"}
              {turn.dropped > 0 ? `; ${turn.dropped} earlier steps not shown` : ""}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
