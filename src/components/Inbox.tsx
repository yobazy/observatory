import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "../nebula/client";
import { flash, getState, setState, useAppState } from "../nebula/store";
import { enqueue } from "../nebula/queue";
import { answerText, pendingCard, suggested, typedAnswers, type Card } from "../nebula/replycard";
import type { Transcript } from "../nebula/transcript";
import type { Agent } from "../nebula/types";
import { useOverlayKeys } from "./Overlay";
import { CardReply } from "./Reader";

/** A thread whose latest reply waits on your decisions. */
interface Waiting {
  agent: Agent;
  n: number;
  card: Card;
}

/** How many threads the inbox last found waiting, for its sidebar entry. */
let lastCount: number | null = null;

async function waitingOn(agent: Agent): Promise<Waiting | null> {
  if (!agent.session_id) return null;
  const t: Transcript | null = isPreview()
    ? (await import("../nebula/mock")).mockTranscript(getState(), agent.id)
    : await invoke<Transcript | null>("thread_transcript", { session: agent.session_id, from: null, kind: agent.kind }).catch(() => null);
  const got = t && pendingCard(t.entries);
  return got ? { agent, n: got.n, card: got.card } : null;
}

/** Decisions (⌥⌘J): every thread whose latest reply asks you to decide
 *  something, as its card, to answer one after another without opening each. */
export function InboxView() {
  const state = useAppState();
  const head = useRef<HTMLDivElement>(null);
  useOverlayKeys(head);
  // Threads that have finished a turn; one still working can't be answered yet.
  const idle = useMemo(
    () =>
      Object.values(state.agents)
        .filter((a) => !a.archived && a.session_id && a.status !== "running")
        .sort((a, b) => b.status_changed_at - a.status_changed_at),
    [state.agents],
  );
  const key = idle.map((a) => `${a.id}:${a.status_changed_at}`).join(",");
  const [found, setFound] = useState<Waiting[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(idle.map(waitingOn)).then((all) => {
      if (!live) return;
      const waiting = all.filter((w): w is Waiting => !!w);
      lastCount = waiting.length;
      setFound(waiting);
    });
    return () => {
      live = false;
    };
  }, [key]);
  // Answered here: gone from the list while the thread takes it up.
  const [sent, setSent] = useState<Set<string>>(new Set());
  const shown = (found ?? []).filter((w) => !sent.has(`${w.agent.id}:${w.n}`));

  return (
    <section className="usage inbox" aria-labelledby="inbox-title">
      <header className="usage-head" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 id="inbox-title">Decisions</h1>
          <p className="usage-sub">
            {found === null
              ? "Reading your threads…"
              : shown.length
                ? `${shown.length === 1 ? "1 thread waits" : `${shown.length} threads wait`} on you to decide something`
                : "No thread is waiting on a decision."}
          </p>
        </div>
        <div className="usage-controls" ref={head}>
          <button className="btn" onClick={() => setState({ view: "sessions" })}>
            Done
          </button>
        </div>
      </header>
      <div className="usage-body inbox-body">
        {shown.map((w) => (
          <InboxItem
            key={`${w.agent.id}:${w.n}`}
            waiting={w}
            project={state.projects[state.worktrees[w.agent.worktree_id]?.project_id ?? ""]?.name ?? ""}
            onSent={() => setSent((s) => new Set(s).add(`${w.agent.id}:${w.n}`))}
          />
        ))}
      </div>
    </section>
  );
}

function InboxItem({ waiting, project, onSent }: { waiting: Waiting; project: string; onSent: () => void }) {
  const { agent, card } = waiting;
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState("");
  const typed = typedAnswers(card, draft);
  const shown = { ...typed.picks, ...Object.fromEntries(Object.entries(picks).filter(([, l]) => l)) };
  const recommended = useMemo(() => suggested(card), [card]);
  const outgoing = answerText(picks, draft);
  const ghost = !draft && !answerText(picks, "") ? answerText(recommended, "") : "";
  const send = async () => {
    if (!outgoing) return;
    try {
      const how = await enqueue(agent, outgoing);
      flash(how === "queued" ? `Queued for ${agent.name}` : `Sent to ${agent.name}`);
      onSent();
    } catch {
      flash(`Couldn't send to ${agent.name}. Your answer is still here.`, 6000);
    }
  };
  return (
    <article className="inbox-item">
      <div className="inbox-head">
        <span className="inbox-name">{agent.name}</span>
        {project && <span className="inbox-project">{project}</span>}
        <button
          className="link-btn"
          onClick={() => {
            setState((s) => ({
              view: "sessions",
              selectedProject: s.worktrees[agent.worktree_id]?.project_id ?? s.selectedProject,
              selectedSession: { Agent: agent.id },
            }));
          }}
        >
          Open thread
        </button>
      </div>
      <CardReply
        card={card}
        pair={null}
        compact
        from={agent.id}
        live
        sent={false}
        picks={shown}
        onPick={(n, letter) => {
          const base = Object.keys(typed.picks).length ? { ...typed.picks, ...picks } : picks;
          if (Object.keys(typed.picks).length) setDraft(typed.rest);
          setPicks({ ...base, [n]: base[n] === letter ? "" : letter });
        }}
      />
      <div className="inbox-compose">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={ghost ? `${ghost}    Tab to use it` : `Reply to ${agent.name}`}
          aria-label={`Reply to ${agent.name}`}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && ghost) {
              e.preventDefault();
              setPicks(recommended);
            } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn btn-primary" disabled={!outgoing} onClick={() => void send()}>
          Send
        </button>
      </div>
    </article>
  );
}

/** The sidebar's way in, beside Ideas. */
export function InboxEntry() {
  const state = useAppState();
  const on = state.view === "inbox";
  return (
    <button
      className={`side-stat${lastCount ? " is-hot" : ""}${on ? " is-on" : ""}`}
      onClick={() => setState({ view: on ? "sessions" : "inbox" })}
      title={`Decisions: ${lastCount === null ? "" : `${lastCount || "none"} waiting. `}Every thread whose latest reply asks you to decide something, to answer from one place (⌥⌘J)`}
    >
      <span className="side-stat-top">
        <ForkGlyph />
        {!!lastCount && <span className="side-stat-badge" aria-hidden />}
      </span>
      {/* Counted when Decisions last opened; a dash until then. */}
      <span className="side-stat-value">{lastCount ?? "–"}</span>
      <span className="side-stat-label">Decisions</span>
    </button>
  );
}

/** A path splitting in two: Decisions. */
function ForkGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.5v4M8 6.5 4.5 10v3.5M8 6.5l3.5 3.5v3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
