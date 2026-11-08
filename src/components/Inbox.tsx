import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flash, setState, useAppState } from "../nebula/store";
import { enqueue } from "../nebula/queue";
import { keepPutAway, useWaiting, type Waiting } from "../nebula/decisions";
import { CATCH_UP, answerText, asksYou, isCard, readCard, suggested, typedAnswers, type Card } from "../nebula/replycard";
import { relativeTime } from "../nebula/status";
import type { Agent } from "../nebula/types";
import { useOverlayKeys } from "./Overlay";
import { AskText, CardReply, Md, Where, toHtml } from "./Reader";
import { QuickAnswer } from "./QuickAnswer";

const keyOf = (w: Waiting) => `${w.agent.id}:${w.prompt ? `p${w.agent.status_changed_at}` : w.n}`;

/** Decisions (⌥⌘J): every thread whose latest reply asks you to decide
 *  something, as its card, to answer one after another without opening each. */
export function InboxView() {
  const state = useAppState();
  const head = useRef<HTMLDivElement>(null);
  useOverlayKeys(head);
  const found = useWaiting();
  // How long each has waited, kept current while the list is open.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
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
                ? `${shown.length === 1 ? "1 thread waits" : `${shown.length} threads wait`} on you`
                : "No thread is waiting on you."}
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
          const project = state.projects[wt?.project_id ?? ""]?.name ?? "";
          const branch = wt?.branch ?? "";
          if (w.prompt) return <PromptItem key={k} waiting={w} project={project} branch={branch} root={wt?.path ?? ""} />;
          return (
            <InboxItem
              key={k}
              waiting={w as Waiting & { card: Card }}
              project={project}
              branch={branch}
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
  waiting: Waiting & { card: Card };
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
  // Answering only earlier replies sends the thread off with its latest
  // decisions unsaid, and it won't wait here for them again.
  const latestLeft = backLines.length > 0 && card.asks.some((a) => a.options.length) && !answerText(picks, draft);
  const ghost = !draft && !answerText(picks, "") && !backLines.length ? answerText(recommended, "") : "";
  const self = useRef<HTMLElement>(null);
  // Answered: the card slides away and its space closes, then it leaves the
  // list. You stay here for the next one.
  // Slides away, then leaves the list; you stay for the next one.
  const leave = () => {
    const el = self.current;
    const animate = !!el && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Measured before the class goes on, for the height to close from.
    if (el && animate) el.style.setProperty("--h", `${el.offsetHeight}px`);
    onSent(animate);
  };
  const send = async () => {
    if (!outgoing || leaving) return;
    try {
      const how = await enqueue(agent, outgoing, { stay: true });
      flash(how === "queued" ? `Queued for ${agent.name}` : `Sent to ${agent.name}`);
      leave();
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
      <ItemHead agent={agent} project={project} branch={branch} />
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
        <details className="inbox-earlier" open={!asksYou(card)}>
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
                    keepPutAway(agent.id, d.entry);
                    setAway((x) => new Set(x).add(d.entry));
                    // That was all it waited on: nothing left to answer here.
                    if (earlier.length === 1 && !asksYou(card)) leave();
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
          <p className="inbox-earlier-foot">
            Not sure these still matter?{" "}
            <button
              className="link-btn"
              disabled={leaving}
              onClick={() => {
                void enqueue(agent, CATCH_UP, { stay: true }).then(
                  () => {
                    flash(`Asked ${agent.name} to catch you up`);
                    leave();
                  },
                  () => flash(`Couldn't ask ${agent.name} to catch you up`, 6000),
                );
              }}
              title="Ask for a fresh card: where it stands, and every decision still open"
            >
              Catch me up
            </button>
          </p>
        </details>
      )}
      {latestLeft && (
        <p className="inbox-hint" role="status">
          This answers the earlier replies only. Its latest decisions above go unanswered.
        </p>
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

/** A thread's name, where it is, how long it has waited, and a way in. */
function ItemHead({ agent, project, branch, prompt = false }: { agent: Agent; project: string; branch: string; prompt?: boolean }) {
  return (
    <div className="inbox-head">
      <span className="inbox-name">{agent.name}</span>
      {project && <span className="inbox-project">{project}</span>}
      {branch && (
        <span className="inbox-branch" title={`On branch ${branch}`}>
          {branch}
        </span>
      )}
      {prompt && <span className="inbox-kind">in its terminal</span>}
      {agent.status_changed_at > 0 && (
        <span className="inbox-age" title={`Waiting since ${new Date(agent.status_changed_at).toLocaleString()}`}>
          waiting {relativeTime(agent.status_changed_at)}
        </span>
      )}
      <button className="link-btn" onClick={() => openThread(agent)} aria-label={`Open ${agent.name}`}>
        Open thread
      </button>
    </div>
  );
}

function openThread(agent: Agent) {
  setState((s) => ({
    view: "sessions",
    selectedProject: s.worktrees[agent.worktree_id]?.project_id ?? s.selectedProject,
    selectedSession: { Agent: agent.id },
  }));
}

/** A thread stopped on a choice in its terminal (a permission, a question):
 *  what it was doing, and the choice as buttons. Picking one answers the
 *  terminal; the thread then works on and leaves the list. */
function PromptItem({ waiting, project, branch, root }: { waiting: Waiting; project: string; branch: string; root: string }) {
  const { agent, asked, said } = waiting;
  const card = useMemo(() => (said ? readCard(said) : null), [said]);
  return (
    <article className="inbox-item">
      <ItemHead agent={agent} project={project} branch={branch} prompt />
      {asked && <Asked text={asked} />}
      {said && card && (
        <Where.Provider value={{ from: agent.id, root, prUrl: null, turnEndedAt: null }}>
          {isCard(card) && card.headline ? (
            <p className="inbox-said" dangerouslySetInnerHTML={{ __html: toHtml(card.headline, true) }} />
          ) : (
            <Md className="inbox-said" text={said} />
          )}
        </Where.Provider>
      )}
      <QuickAnswer agent={agent} onOpen={() => openThread(agent)} every={4000} />
    </article>
  );
}

/** What you said that set this turn off: one line, all of it on a click. */
function Asked({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const [clamped, setClamped] = useState(false);
  const line = useRef<HTMLSpanElement>(null);
  const said = text.trim() === CATCH_UP ? "Catch me up" : text.trim();
  useLayoutEffect(() => {
    const el = line.current;
    if (el && !full) setClamped(el.scrollWidth > el.clientWidth || said.includes("\n"));
  }, [said, full]);
  return (
    <p className={`inbox-asked${full ? " is-full" : ""}`}>
      <span className="inbox-asked-label">You asked</span>
      <span className="inbox-asked-text" ref={line}>
        {said}
      </span>
      {(clamped || full) && (
        <button className="link-btn" onClick={() => setFull(!full)} aria-expanded={full}>
          {full ? "Less" : "All of it"}
        </button>
      )}
    </p>
  );
}

/** The sidebar's way in, beside Ideas. */
export function InboxEntry() {
  const state = useAppState();
  const on = state.view === "inbox";
  const count = useWaiting()?.length ?? null;
  return (
    <button
      className={`side-stat${count ? " is-hot" : ""}${on ? " is-on" : ""}`}
      onClick={() => setState({ view: on ? "sessions" : "inbox" })}
      title={`Decisions: ${count === null ? "" : `${count || "none"} waiting. `}Every thread waiting on you to decide something or answer its terminal, to answer from one place (⌥⌘J)`}
    >
      <span className="side-stat-top">
        <ForkGlyph />
        {!!count && <span className="side-stat-badge" aria-hidden />}
      </span>
      {/* A dash while the threads are first read. */}
      <span className="side-stat-value">{count ?? "–"}</span>
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
