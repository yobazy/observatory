import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { flash, setState, useAppState } from "../nebula/store";
import { enqueue } from "../nebula/queue";
import { keepPutAway, recheck, useWaiting, type Waiting } from "../nebula/decisions";
import { CATCH_UP, answerText, asksYou, isCard, readCard, suggested, typedAnswers, type Card } from "../nebula/replycard";
import { relativeTime } from "../nebula/status";
import type { Agent } from "../nebula/types";
import { useOverlayKeys } from "./Overlay";
import { AskText, CardReply, Md, Where, toHtml } from "./Reader";
import { QuickAnswer } from "./QuickAnswer";
import { NO_ANSWER, backLines, firstQuestion, outgoing, pickedWords, recommendedFor, type Answer } from "../nebula/inboxAnswers";

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
 *  something, to answer one after another without opening each. The queue
 *  sits on the left, one line a thread; the card it's on fills the right.
 *  What you pick on a card stays while you move between them, so several
 *  can be answered and sent together. */
export function InboxView() {
  const state = useAppState();
  const head = useRef<HTMLDivElement>(null);
  useOverlayKeys(head);
  const found = useWaiting();
  // How long each has waited, kept current while the list is open, and
  // each card checked against its thread's latest reply.
  const [, tick] = useState(0);
  useEffect(() => {
    recheck();
    const t = window.setInterval(() => {
      tick((n) => n + 1);
      recheck();
    }, 60_000);
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
  // Each card's picks and typing, by card, so moving away keeps them.
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const answerOf = (w: Waiting) => answers[keyOf(w)] ?? NO_ANSWER;
  const setAnswer = (k: string, f: (a: Answer) => Answer) => setAnswers((s) => ({ ...s, [k]: f(s[k] ?? NO_ANSWER) }));
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
  const rail = useRef<HTMLElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const moveTo = (k: string) => {
    setFocusKey(k);
    requestAnimationFrame(() => rail.current?.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  // A new card starts at its top.
  useLayoutEffect(() => {
    pane.current?.scrollTo({ top: 0 });
  }, [focus]);
  // Cards whose answer is on its way, so neither Send nor Send all sends it
  // again while the first is still out.
  const inFlight = useRef(new Set<string>());
  const claim = (k: string) => {
    if (inFlight.current.has(k)) return false;
    inFlight.current.add(k);
    return true;
  };
  const release = (k: string) => inFlight.current.delete(k);
  // Cards with an answer ready to go, for sending together. Not the ones put
  // off with Later: that's what Later is for.
  const ready = list.flatMap((w) => {
    if (leaving.some((l) => keyOf(l.w) === keyOf(w)) || inFlight.current.has(keyOf(w))) return [];
    const text = w.prompt ? "" : outgoing(w.earlier, answerOf(w));
    return text ? [{ w, text }] : [];
  });
  // The ones whose reply recommends something you haven't started on.
  const recommendable = list.filter(
    (w) => !w.prompt && w.card && !leaving.some((l) => keyOf(l.w) === keyOf(w)) && Object.keys(recommendedFor(w.card, answerOf(w))).length,
  );
  const pickRecommended = () => {
    for (const w of recommendable)
      setAnswer(keyOf(w), (a) => {
        const rec = recommendedFor(w.card!, a);
        return Object.keys(rec).length ? { ...a, picks: rec } : a;
      });
    flash(recommendable.length === 1 ? "Picked what 1 thread recommends" : `Picked what ${recommendable.length} threads recommend`);
  };
  const [sendingAll, setSendingAll] = useState(false);
  const sendAll = async () => {
    if (sendingAll) return;
    const go = ready.filter(({ w }) => claim(keyOf(w)));
    if (!go.length) return;
    setSendingAll(true);
    const got = await Promise.all(
      go.map(({ w, text }) =>
        enqueue(w.agent, text, { stay: true })
          .then(
            (how) => {
              answered(w.agent, how === "queued");
              return keyOf(w);
            },
            () => null,
          )
          .finally(() => release(keyOf(w))),
      ),
    );
    setSendingAll(false);
    const ok = got.filter((k): k is string => !!k);
    setSent((s) => new Set([...s, ...ok]));
    const failed = go.length - ok.length;
    const left = `${failed === 1 ? "its answer is" : "their answers are"} still here`;
    flash(
      !ok.length
        ? `Couldn't send ${failed === 1 ? "the answer" : `any of the ${failed} answers`}; ${left}`
        : `Sent ${ok.length === 1 ? "1 answer" : `${ok.length} answers`}${failed ? `. ${failed} couldn't go; ${left}` : ""}`,
      failed ? 6000 : undefined,
    );
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
      } else if (e.key === "Enter" && e.shiftKey) {
        void sendAll();
      } else if (e.key === "R" && e.shiftKey) {
        if (recommendable.length) pickRecommended();
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
      else {
        later.add(keyOf(w));
        // Put off: on to the card that takes its place, not after it.
        if (keyOf(w) === focus) setFocusKey(null);
      }
      bump((n) => n + 1);
    },
  });
  // The pane shows the focused card, and any on their way out above it.
  const inPane = [...list, ...putOff].filter((w) => keyOf(w) === focus || leaving.some((l) => keyOf(l.w) === keyOf(w)));

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
              <kbd>j</kbd> <kbd>k</kbd> move · <kbd>1</kbd> <kbd>a</kbd> pick · <kbd>r</kbd> recommended · <kbd>↵</kbd> send · <kbd>⇧↵</kbd> send all · <kbd>e</kbd> reply · <kbd>l</kbd>{" "}
              later · <kbd>o</kbd> open
            </p>
          )}
          <button className="btn" onClick={() => setState({ view: "sessions" })}>
            Done
          </button>
        </div>
      </header>
      <div className="usage-body inbox-body">
        {live.length > 0 && (
          <nav className="inbox-rail" ref={rail} aria-label="Waiting threads">
            <div className="inbox-rail-actions">
              <button
                className="btn btn-sm"
                disabled={!recommendable.length}
                onClick={pickRecommended}
                title="On every card you haven't started, pick what its reply recommends (⇧R). Nothing is sent until you send it"
              >
                Pick recommended{recommendable.length ? ` · ${recommendable.length}` : ""}
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={!ready.length || sendingAll}
                onClick={() => void sendAll()}
                title="Send every card's answer at once (⇧↵)"
              >
                {sendingAll ? "Sending…" : ready.length > 1 ? `Send ${ready.length}` : "Send all"}
              </button>
            </div>
            {[...list, ...putOff].map((w, i) => {
              const k = keyOf(w);
              if (leaving.some((l) => keyOf(l.w) === k)) return null;
              const row = (
                <RailRow
                  key={k}
                  k={k}
                  waiting={w}
                  project={state.projects[state.worktrees[w.agent.worktree_id]?.project_id ?? ""]?.name ?? ""}
                  answer={answerOf(w)}
                  on={k === focus}
                  isLater={later.has(k)}
                  onPick={() => moveTo(k)}
                />
              );
              return i === list.length && putOff.length > 0
                ? [
                    <h2 key="later" className="inbox-later-head">
                      Later · {putOff.length}
                    </h2>,
                    row,
                  ]
                : row;
            })}
          </nav>
        )}
        <div className="inbox-pane" ref={pane}>
          <Moving waiting={found} />
          {inPane.map((w) => {
            const k = keyOf(w);
            const isLeaving = leaving.some((l) => keyOf(l.w) === k);
            const wt = state.worktrees[w.agent.worktree_id];
            const project = state.projects[wt?.project_id ?? ""]?.name ?? "";
            const branch = wt?.branch ?? "";
            const keys = keysFor(w);
            return w.prompt ? (
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
                answer={answerOf(w)}
                onAnswer={(f) => setAnswer(k, f)}
                claim={() => claim(k)}
                release={() => release(k)}
                onSendAll={() => void sendAll()}
                onSent={(animate) => {
                  const idx = all.findIndex((x) => keyOf(x) === k);
                  if (animate) setLeaving((ls) => [...ls, { w, at: idx }]);
                  else setSent((s) => new Set(s).add(k));
                }}
                onGone={() => {
                  setSent((s) => new Set(s).add(k));
                  setLeaving((ls) => ls.filter((l) => keyOf(l.w) !== k));
                }}
              />
            );
          })}
          {found !== null && !live.length && <p className="inbox-empty">Nothing waits on you. Threads you answer here show above as they move on.</p>}
        </div>
      </div>
    </section>
  );
}

/** What a thread stopped on a prompt is about, for its queue row: the
 *  headline of what it said this turn, else what you asked it. */
function promptLine(said: string, asked: string): string {
  const head = said ? (readCard(said).headline ?? said.split("\n").find((l) => l.trim()) ?? "") : "";
  const text = (head || (asked.trim() === CATCH_UP ? "" : asked)).replace(/(\*\*|__|`)/g, "").replace(/\s+/g, " ").trim();
  return text || "A choice in its terminal";
}

/** One waiting thread in the queue: its name, its first question, and
 *  what you've picked on it so far. */
function RailRow({
  k,
  waiting,
  project,
  answer,
  on,
  isLater,
  onPick,
}: {
  k: string;
  waiting: Waiting;
  project: string;
  answer: Answer;
  on: boolean;
  isLater: boolean;
  onPick: () => void;
}) {
  const { agent, card, prompt } = waiting;
  const q = firstQuestion(card);
  const said = prompt ? "" : pickedWords(card, answer);
  const asks = card?.asks.length ?? 0;
  const about = useMemo(() => (prompt ? promptLine(waiting.said, waiting.asked) : ""), [prompt, waiting.said, waiting.asked]);
  const line = prompt
    ? about
    : q
      ? q.text
      : waiting.earlier.length
        ? "Decisions left open earlier"
        : (card?.asksNote.split("\n").find((l) => l.trim()) ?? "Waits on your reply").replace(/(\*\*|__|`)/g, "");
  return (
    <button
      className={`inbox-row${on ? " is-on" : ""}${isLater ? " is-later" : ""}`}
      data-key={k}
      aria-current={on || undefined}
      onClick={onPick}
      // Tabbing to a row shows its card; a click leaves the keys on the card.
      onFocus={onPick}
      onMouseDown={(e) => e.preventDefault()}
      title={q && q.more ? `${q.text}\n…and ${q.more} more` : line}
    >
      <span className="inbox-row-top">
        <span className="inbox-row-name">{agent.name}</span>
        {agent.status_changed_at > 0 && <span className="inbox-row-age">{relativeTime(agent.status_changed_at)}</span>}
      </span>
      <span className="inbox-row-q">{line}</span>
      {said && <span className="inbox-row-said" aria-label={`Your answer: ${said}`}>→ {said}</span>}
      <span className="inbox-row-meta">
        {project && <span>{project}</span>}
        {prompt ? (
          <span className="inbox-row-tag is-prompt">terminal</span>
        ) : said ? null : asks > 1 ? (
          <span className="inbox-row-tag">{asks} decisions</span>
        ) : null}
      </span>
    </button>
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
  answer,
  onAnswer,
  claim,
  release,
  onSendAll,
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
  /** What you've picked and typed on it, kept by the list. */
  answer: Answer;
  onAnswer: (f: (a: Answer) => Answer) => void;
  /** Marks it on its way, false when it already is; `release` once it's gone or failed. */
  claim: () => boolean;
  release: () => void;
  /** ⇧↵ in its reply box: every card's answer, this one's too. */
  onSendAll: () => void;
  /** Answered; `animate` when it should slide away rather than just go. */
  onSent: (animate: boolean) => void;
  /** Its slide away has ended. */
  onGone: () => void;
}) {
  const { agent, card, asked } = waiting;
  const { picks, draft, back } = answer;
  const setDraft = (draft: string) => onAnswer((a) => ({ ...a, draft }));
  const setPicks = (picks: Record<number, string>) => onAnswer((a) => ({ ...a, picks }));
  const setBack = (f: (b: Answer["back"]) => Answer["back"]) => onAnswer((a) => ({ ...a, back: f(a.back) }));
  const [away, setAway] = useState<Set<number>>(new Set());
  const earlier = waiting.earlier.filter((d) => !away.has(d.entry));
  const earlierCount = earlier.reduce((k, d) => k + d.asks.length, 0);
  const typed = typedAnswers(card, draft);
  const shown = { ...typed.picks, ...Object.fromEntries(Object.entries(picks).filter(([, l]) => l)) };
  const recommended = useMemo(() => suggested(card), [card]);
  const backSaid = backLines(earlier, answer);
  // Answers to earlier replies keep a paragraph of their own, as in the Read view.
  const text = outgoing(earlier, answer);
  // Answering only earlier replies sends the thread off with its latest
  // decisions unsaid, and it won't wait here for them again.
  const latestLeft = backSaid.length > 0 && card.asks.some((a) => a.options.length) && !answerText(picks, draft);
  const ghost = !draft && !answerText(picks, "") && !backSaid.length ? answerText(recommended, "") : "";
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
    if (!text || leaving || !claim()) return;
    try {
      const how = await enqueue(agent, text, { stay: true });
      flash(how === "queued" ? `Queued for ${agent.name}` : `Sent to ${agent.name}`);
      answered(agent, how === "queued");
      leave();
    } catch {
      flash(`Couldn't send to ${agent.name}. Your answer is still here.`, 6000);
    } finally {
      release();
    }
  };
  const pick = (n: number, letter: string) => {
    const fromBox = Object.keys(typed.picks).length > 0;
    const base = fromBox ? { ...typed.picks, ...picks } : picks;
    onAnswer((a) => ({ ...a, draft: fromBox ? typed.rest : a.draft, picks: { ...base, [n]: base[n] === letter ? "" : letter } }));
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
            {backSaid.length > 0 && (
              <span className="inbox-earlier-picked"> · {backSaid.length === 1 ? "answering 1 reply" : `answering ${backSaid.length} replies`}</span>
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
              if (e.shiftKey) onSendAll();
              else void send();
            }
          }}
        />
        <button className="btn btn-primary" disabled={!text} onClick={() => void send()}>
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
