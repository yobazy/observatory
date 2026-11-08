import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "../nebula/client";
import { flash, getState, setState, useAppState } from "../nebula/store";
import { enqueue } from "../nebula/queue";
import { CATCH_UP, answerText, pendingCard, suggested, typedAnswers, type Pending } from "../nebula/replycard";
import { relativeTime } from "../nebula/status";
import type { Transcript } from "../nebula/transcript";
import type { Agent } from "../nebula/types";
import { useOverlayKeys } from "./Overlay";
import { AskText, CardReply, Where, toHtml } from "./Reader";

/** A thread whose latest reply waits on your decisions. */
interface Waiting extends Pending {
  agent: Agent;
}

/** Earlier replies whose open decisions you put away here, as
 *  "agent:entry", so they stay away the next time Decisions opens. */
const PUT_AWAY = "observatory.decisions.putAway";
function putAway(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PUT_AWAY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function keepPutAway(keys: Set<string>) {
  try {
    // The newest few hundred: enough for any thread still around.
    localStorage.setItem(PUT_AWAY, JSON.stringify([...keys].slice(-300)));
  } catch {
    // Private mode or full: put away for this visit only.
  }
}

const keyOf = (w: Waiting) => `${w.agent.id}:${w.n}`;

/** How many threads the inbox last found waiting, for its sidebar entry. */
let lastCount: number | null = null;

async function waitingOn(agent: Agent): Promise<Waiting | null> {
  if (!agent.session_id) return null;
  const t: Transcript | null = isPreview()
    ? (await import("../nebula/mock")).mockTranscript(getState(), agent.id)
    : await invoke<Transcript | null>("thread_transcript", { session: agent.session_id, from: null, kind: agent.kind }).catch(() => null);
  const got = t && pendingCard(t.entries);
  if (!got) return null;
  const away = putAway();
  const earlier = got.earlier.filter((d) => !away.has(`${agent.id}:${d.entry}`));
  // Put away everything earlier, and the latest reply asks nothing itself.
  if (!earlier.length && !got.card.asks.length && !got.card.asksNote) return null;
  return { ...got, agent, earlier };
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
  // Answered here: gone from the list while the thread takes it up. The
  // thread starts working at once and so drops out of `found`; a card on
  // its way out keeps its place until its animation ends.
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<{ w: Waiting; at: number }[]>([]);
  const gone = (w: Waiting) => sent.has(keyOf(w)) || leaving.some((l) => keyOf(l.w) === keyOf(w));
  const shown = (found ?? []).filter((w) => !gone(w));
  const list = [...shown];
  for (const l of [...leaving].sort((a, b) => a.at - b.at)) list.splice(Math.min(l.at, list.length), 0, l.w);

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
        {list.map((w, i) => {
          const k = keyOf(w);
          const isLeaving = leaving.some((l) => keyOf(l.w) === k);
          const wt = state.worktrees[w.agent.worktree_id];
          return (
            <InboxItem
              key={k}
              waiting={w}
              project={state.projects[wt?.project_id ?? ""]?.name ?? ""}
              branch={wt?.branch ?? ""}
              root={wt?.path ?? ""}
              leaving={isLeaving}
              onSent={(animate) => {
                if (animate) setLeaving((ls) => [...ls, { w, at: i }]);
                else setSent((s) => new Set(s).add(k));
              }}
              onGone={() => {
                setSent((s) => new Set(s).add(k));
                setLeaving((ls) => ls.filter((l) => keyOf(l.w) !== k));
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

function InboxItem({
  waiting,
  project,
  branch,
  root,
  leaving,
  onSent,
  onGone,
}: {
  waiting: Waiting;
  project: string;
  branch: string;
  /** Its checkout, for the paths its reply names. */
  root: string;
  leaving: boolean;
  /** Answered; `animate` when it should slide away rather than just go. */
  onSent: (animate: boolean) => void;
  /** Its slide away has ended. */
  onGone: () => void;
}) {
  const { agent, card, asked } = waiting;
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState("");
  // Taps on decisions earlier replies left open, by reply then decision.
  const [back, setBack] = useState<Record<number, Record<number, string>>>({});
  const [away, setAway] = useState<Set<number>>(new Set());
  const earlier = waiting.earlier.filter((d) => !away.has(d.entry));
  const earlierCount = earlier.reduce((k, d) => k + d.asks.length, 0);
  const typed = typedAnswers(card, draft);
  const shown = { ...typed.picks, ...Object.fromEntries(Object.entries(picks).filter(([, l]) => l)) };
  const recommended = useMemo(() => suggested(card), [card]);
  // Each earlier reply's answers said against it, as the Read view does.
  const backLines = earlier
    .map((d) => [d.quote, answerText(back[d.entry] ?? {}, "")] as const)
    .filter(([, said]) => said)
    .map(([quote, said]) => `About your reply that starts "${quote}": ${said}`);
  // Answers to earlier replies keep a paragraph of their own, as in the Read view.
  const outgoing = [answerText(picks, draft), backLines.join("\n")].filter(Boolean).join("\n\n");
  const ghost = !draft && !answerText(picks, "") && !backLines.length ? answerText(recommended, "") : "";
  const self = useRef<HTMLElement>(null);
  // Answered: the card slides away and its space closes, then it leaves the
  // list. You stay here for the next one.
  const send = async () => {
    if (!outgoing || leaving) return;
    try {
      const how = await enqueue(agent, outgoing, { stay: true });
      flash(how === "queued" ? `Queued for ${agent.name}` : `Sent to ${agent.name}`);
      const el = self.current;
      const animate = !!el && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Measured before the class goes on, for the height to close from.
      if (el && animate) el.style.setProperty("--h", `${el.offsetHeight}px`);
      onSent(animate);
    } catch {
      flash(`Couldn't send to ${agent.name}. Your answer is still here.`, 6000);
    }
  };
  return (
    <article
      ref={self}
      className={`inbox-item${leaving ? " is-leaving" : ""}`}
      inert={leaving}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && leaving) onGone();
      }}
    >
      <div className="inbox-head">
        <span className="inbox-name">{agent.name}</span>
        {project && <span className="inbox-project">{project}</span>}
        {branch && (
          <span className="inbox-branch" title={`On branch ${branch}`}>
            {branch}
          </span>
        )}
        {agent.status_changed_at > 0 && (
          <span className="inbox-age" title={`Waiting since ${new Date(agent.status_changed_at).toLocaleString()}`}>
            waiting {relativeTime(agent.status_changed_at)}
          </span>
        )}
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
      {asked && <Asked text={asked} />}
      <Where.Provider value={{ from: agent.id, root, prUrl: null, turnEndedAt: null }}>
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
      </Where.Provider>
      {earlier.length > 0 && (
        // Folded while the latest reply asks its own; open when it's all there is.
        <details className="inbox-earlier" open={!card.asks.length && !card.asksNote}>
          <summary>
            {earlierCount === 1 ? "1 decision left open earlier" : `${earlierCount} decisions left open earlier`}
            {backLines.length > 0 && (
              <span className="inbox-earlier-picked"> · {backLines.length === 1 ? "answering 1 reply" : `answering ${backLines.length} replies`}</span>
            )}
          </summary>
          {earlier.map((d) => (
            <div key={d.entry} className="inbox-earlier-reply">
              <div className="inbox-earlier-head">
                <span className="rd-quote">“{d.quote}”</span>
                <button
                  className="link-btn"
                  onClick={() => {
                    const all = putAway();
                    all.add(`${agent.id}:${d.entry}`);
                    keepPutAway(all);
                    setAway((x) => new Set(x).add(d.entry));
                    setBack(({ [d.entry]: _, ...rest }) => rest);
                  }}
                  title="These don't matter any more: don't list them again"
                >
                  Put away
                </button>
              </div>
              {d.asks.map((a) => (
                <div key={a.n} className="rd-q">
                  <AskText n={a.n} text={a.text} />
                  <span className="rd-opts">
                    {a.options.map((o) => {
                      const on = back[d.entry]?.[a.n] === o.letter;
                      return (
                        <button
                          key={o.letter}
                          className={`rd-opt${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() => setBack((b) => ({ ...b, [d.entry]: { ...b[d.entry], [a.n]: on ? "" : o.letter } }))}
                        >
                          <b>{o.letter}</b> <span dangerouslySetInnerHTML={{ __html: toHtml(o.label, true) }} />
                        </button>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </details>
      )}
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

/** What you said that set this turn off: one line, all of it on a click. */
function Asked({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const said = text.trim() === CATCH_UP ? "Catch me up" : text.trim();
  return (
    <button
      className={`inbox-asked${full ? " is-full" : ""}`}
      onClick={() => setFull(!full)}
      aria-expanded={full}
      title={full ? "Show less" : "Show all of it"}
    >
      <span className="inbox-asked-label">You asked</span> {said}
    </button>
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
