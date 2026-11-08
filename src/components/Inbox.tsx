import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
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

/** What the focused card does with a key; true when it used it. */
type KeyHandler = (e: KeyboardEvent) => boolean;
/** Each card's say in the keys, and whether it's the one they go to. */
interface Keys {
  focused: boolean;
  handler: MutableRefObject<KeyHandler | null>;
  /** Put off till later, or brought back. */
  later: boolean;
  onLater: () => void;
}

/** Cards put off with Later, until their thread moves on; kept while the
 *  app runs, so closing Decisions doesn't bring them back. */
const later = new Set<string>();
/** Threads answered from here, newest first, for the Moving strip. */
let moving: { id: string; at: number; queued: boolean }[] = [];
const MOVING_MS = 30 * 60_000;
function answered(agent: Agent, queued = false) {
  moving = [{ id: agent.id, at: Date.now(), queued }, ...moving.filter((m) => m.id !== agent.id)].slice(0, 12);
}
/** Keys a card takes for itself, so no option letter is picked by them alone. */
const ACTION_KEYS = new Set(["J", "K", "R", "E", "O", "L"]);

const editable = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

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
  const all = [...shown];
  for (const l of [...leaving].sort((a, b) => a.at - b.at)) all.splice(Math.min(l.at, all.length), 0, l.w);
  const [, bump] = useState(0);
  const list = all.filter((w) => !later.has(keyOf(w)));
  const putOff = all.filter((w) => later.has(keyOf(w)));
  // The card keys go to: the one you moved to, or whichever took the place
  // of one that just left.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const lastAt = useRef(0);
  // Later cards come last, and can have the keys too.
  const live = [...list, ...putOff].filter((w) => !leaving.some((l) => keyOf(l.w) === keyOf(w)));
  const at = live.findIndex((w) => keyOf(w) === focusKey);
  const focus = at >= 0 ? focusKey : live.length ? keyOf(live[Math.min(lastAt.current, live.length - 1)]) : null;
  if (at >= 0) lastAt.current = at;
  const handler = useRef<KeyHandler | null>(null);
  // The focused card sets it again as it renders below.
  handler.current = null;
  const body = useRef<HTMLDivElement>(null);
  const moveTo = (k: string) => {
    setFocusKey(k);
    requestAnimationFrame(() => body.current?.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editable(e.target)) {
        // Back from the reply box to the list; Esc again closes it.
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.ctrlKey || e.altKey || (e.metaKey && e.key !== "Enter") || e.isComposing) return;
      // A focused control takes Enter and Space itself, but an option you
      // just clicked keeps focus, and Enter there means send.
      const control = e.target instanceof Element ? e.target.closest("button, a, summary, [role=button]") : null;
      if (control && (e.key === " " || (e.key === "Enter" && !control.classList.contains("rd-opt")))) return;
      const i = live.findIndex((w) => keyOf(w) === focus);
      if (e.key === "j" || e.key === "ArrowDown" || e.key === "k" || e.key === "ArrowUp") {
        const next = live[Math.max(0, Math.min(live.length - 1, i + (e.key === "j" || e.key === "ArrowDown" ? 1 : -1)))];
        if (next) moveTo(keyOf(next));
      } else if (!handler.current?.(e)) return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const keysFor = (w: Waiting): Keys => ({
    focused: keyOf(w) === focus,
    handler,
    later: later.has(keyOf(w)),
    onLater: () => {
      if (later.has(keyOf(w))) later.delete(keyOf(w));
      else later.add(keyOf(w));
      bump((n) => n + 1);
    },
  });

  return (
    <section className="usage inbox" aria-labelledby="inbox-title">
      <header className="usage-head" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 id="inbox-title">Decisions</h1>
          <p className="usage-sub">
            {found === null
              ? "Reading your threads…"
              : shown.length
                ? `${shown.length === 1 ? "1 thread waits" : `${shown.length} threads wait`} on you${putOff.length ? `, ${putOff.length} of them later` : ""}`
                : "No thread is waiting on you."}
          </p>
        </div>
        <div className="usage-controls" ref={head}>
          {live.length > 0 && (
            <p className="inbox-keys" aria-label="Keys">
              <kbd>j</kbd> <kbd>k</kbd> move · <kbd>1</kbd> <kbd>a</kbd> pick · <kbd>r</kbd> recommended · <kbd>↵</kbd> send · <kbd>e</kbd> reply · <kbd>l</kbd>{" "}
              later · <kbd>o</kbd> open
            </p>
          )}
          <button className="btn" onClick={() => setState({ view: "sessions" })}>
            Done
          </button>
        </div>
      </header>
      <div className="usage-body inbox-body" ref={body}>
        <Moving waiting={found} />
        {[...list, ...putOff].map((w, i) => {
          const k = keyOf(w);
          const isLeaving = leaving.some((l) => keyOf(l.w) === k);
          const wt = state.worktrees[w.agent.worktree_id];
          const project = state.projects[wt?.project_id ?? ""]?.name ?? "";
          const branch = wt?.branch ?? "";
          const first = i === list.length && putOff.length > 0;
          const keys = keysFor(w);
          const item = w.prompt ? (
            <PromptItem key={k} waiting={w} project={project} branch={branch} root={wt?.path ?? ""} keys={keys} onFocus={() => setFocusKey(k)} />
          ) : (
            <InboxItem
              key={k}
              keys={keys}
              onFocus={() => setFocusKey(k)}
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
          return first
            ? [
                <h2 key="later" className="inbox-later-head">
                  Later · {putOff.length}
                </h2>,
                item,
              ]
            : item;
        })}
      </div>
    </section>
  );
}

function InboxItem({
  keys,
  onFocus,
  waiting,
  project,
  branch,
  root,
  leaving,
  onSent,
  onGone,
}: {
  keys: Keys;
  onFocus: () => void;
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
      answered(agent, how === "queued");
      leave();
    } catch {
      flash(`Couldn't send to ${agent.name}. Your answer is still here.`, 6000);
    }
  };
  const pick = (n: number, letter: string) => {
    const base = Object.keys(typed.picks).length ? { ...typed.picks, ...picks } : picks;
    if (Object.keys(typed.picks).length) setDraft(typed.rest);
    setPicks({ ...base, [n]: base[n] === letter ? "" : letter });
  };
  // A number, then a letter, picks that option: "2" "b". With one question
  // the letter alone does.
  const [chord, setChord] = useState<number | null>(null);
  useEffect(() => {
    if (!keys.focused) setChord(null);
  }, [keys.focused]);
  const box = useRef<HTMLInputElement>(null);
  if (keys.focused)
    keys.handler.current = (e) => {
      const k = e.key;
      if (k === "Enter") {
        void send();
        return true;
      }
      const asks = card.asks.filter((a) => a.options.length);
      if (/^[1-9]$/.test(k) && asks.some((a) => a.n === Number(k))) {
        setChord(Number(k));
        return true;
      }
      if (e.metaKey || !/^[a-z]$/i.test(k)) return false;
      const alone = asks.length === 1 && !asks[0].options.some((o) => ACTION_KEYS.has(o.letter)) ? asks[0] : undefined;
      const ask = chord !== null ? asks.find((a) => a.n === chord) : alone;
      const chorded = chord !== null;
      setChord(null);
      if (ask?.options.some((o) => o.letter === k.toUpperCase())) {
        pick(ask.n, k.toUpperCase());
        return true;
      }
      // A letter after a number was meant for that decision, not an action.
      if (chorded) return true;
      if (k === "r" && Object.keys(recommended).length) setPicks(recommended);
      else if (k === "e") box.current?.focus();
      else if (k === "o") openThread(agent);
      else if (k === "l") keys.onLater();
      else return false;
      return true;
    };
  return (
    <article
      ref={self}
      data-key={`${waiting.agent.id}:${waiting.n}`}
      className={`inbox-item${leaving ? " is-leaving" : ""}${keys.focused ? " is-focus" : ""}${keys.later ? " is-later" : ""}`}
      inert={leaving}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && leaving) onGone();
      }}
    >
      <ItemHead agent={agent} project={project} branch={branch} keys={keys} />
      {asked && <Asked text={asked} />}
      <Where.Provider value={{ from: agent.id, root, prUrl: null, turnEndedAt: null }}>
        <CardReply card={card} pair={null} compact from={agent.id} live sent={false} picks={shown} onPick={pick} />
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
      {keys.focused && chord !== null && (
        <p className="inbox-hint inbox-chord" role="status">
          Decision {chord}: now its letter
        </p>
      )}
      <div className="inbox-compose">
        <input
          ref={box}
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
function ItemHead({ agent, project, branch, keys, prompt = false }: { agent: Agent; project: string; branch: string; keys: Keys; prompt?: boolean }) {
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
      <button
        className="link-btn inbox-later-btn"
        onClick={keys.onLater}
        aria-label={keys.later ? `Bring ${agent.name} back` : `Later for ${agent.name}`}
        title={keys.later ? "Back into the list" : "Put this off: it moves to the bottom until the thread moves on (l)"}
      >
        {keys.later ? "Bring back" : "Later"}
      </button>
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
function PromptItem({
  waiting,
  project,
  branch,
  root,
  keys,
  onFocus,
}: {
  waiting: Waiting;
  project: string;
  branch: string;
  root: string;
  keys: Keys;
  onFocus: () => void;
}) {
  const { agent, asked, said } = waiting;
  const card = useMemo(() => (said ? readCard(said) : null), [said]);
  const self = useRef<HTMLElement>(null);
  // A choice's number picks it, as in the terminal.
  if (keys.focused)
    keys.handler.current = (e) => {
      if (/^[1-9]$/.test(e.key)) {
        const choice = [...(self.current?.querySelectorAll<HTMLButtonElement>(".qa-choice") ?? [])].find((b) => b.querySelector("kbd")?.textContent === e.key);
        choice?.click();
        return !!choice;
      }
      if (e.key === "o") openThread(agent);
      else if (e.key === "l") keys.onLater();
      else return false;
      return true;
    };
  return (
    <article
      ref={self}
      data-key={`${agent.id}:p${agent.status_changed_at}`}
      className={`inbox-item${keys.focused ? " is-focus" : ""}${keys.later ? " is-later" : ""}`}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
    >
      <ItemHead agent={agent} project={project} branch={branch} keys={keys} prompt />
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
      <QuickAnswer agent={agent} onOpen={() => openThread(agent)} onPicked={() => answered(agent)} every={4000} />
    </article>
  );
}

/** Threads answered from here in the last half hour, and how each is
 *  getting on: working, asking again, or done. A click opens it. */
function Moving({ waiting }: { waiting: Waiting[] | null }) {
  const { agents } = useAppState();
  const [, bump] = useState(0);
  const now = Date.now();
  const recent = moving.filter((m) => now - m.at < MOVING_MS && agents[m.id] && !agents[m.id].archived);
  if (!recent.length) return null;
  return (
    <div className="inbox-moving" role="group" aria-label="Answered from here">
      <span className="inbox-moving-label">Moving</span>
      {recent.map((m) => {
        const a = agents[m.id];
        // Until its status moves, it's still on the answer you just gave.
        const moved = a.status_changed_at > m.at;
        const asks = moved && waiting?.some((w) => w.agent.id === a.id);
        const [what, tone] = !moved
          ? [m.queued ? "queued" : "sent", "run"]
          : a.status === "running"
            ? ["working", "run"]
            : asks
              ? [a.status === "needs_feedback" ? "on a prompt" : "asks again", "wait"]
              : a.status === "finished"
                ? ["done", "done"]
                : ["stopped", "idle"];
        return (
          <button
            key={m.id}
            className={`inbox-moving-item is-${tone}`}
            onClick={() => openThread(a)}
            title={`Answered ${relativeTime(m.at) === "now" ? "just now" : `${relativeTime(m.at)} ago`}. Open ${a.name}`}
          >
            <span className="inbox-moving-dot" aria-hidden />
            {a.name} <span className="inbox-moving-what">{what}</span>
          </button>
        );
      })}
      <button
        className="link-btn"
        onClick={() => {
          moving = [];
          bump((n) => n + 1);
        }}
        aria-label="Clear the Moving list"
      >
        Clear
      </button>
    </div>
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
