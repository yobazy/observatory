import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { isPreview } from "../nebula/client";
import { flash, getState, useAppState } from "../nebula/store";
import { findPrRefs, pathInCode, prLink } from "../nebula/pathtext";
import { resolve } from "../nebula/termpaths";
import { enqueue, isIdle, unqueue } from "../nebula/queue";
import { clock, doingLine, merge, stepsLine, type Entry, type Transcript } from "../nebula/transcript";
import { closeThread } from "../nebula/verdicts";
import { answersSaid, answerText, beforeAfter, isCard, noteFor, openDecisions, turnsOf, passageText, suggested, pointerText, readCard, replyQuote, typedAnswers, type Card, type Chip } from "../nebula/replycard";
import { saveMoment } from "../nebula/moments";
import { shipKind } from "../nebula/git";
import { SHIP_LABEL, shipPrompt, shipWhat } from "../nebula/actions";
import { highlightUnder } from "../nebula/highlight";
import { markRead, readPlan, readTo } from "../nebula/readmark";
import { baseName, describe, openPreview, previewUrl } from "../nebula/preview";
import type { Agent } from "../nebula/types";
import type { Choice, Question } from "../nebula/screen";
import { AskChoices } from "./AskStrip";
import { ReaderFind } from "./ReaderFind";

/** What you were typing to each agent, kept when the reader remounts for a
 *  new session (/clear, resume). */
const drafts = new Map<string, string>();
/** Earlier decisions you put away, per agent, for as long as the app runs. */
const dismissedFor = new Map<string, Set<number>>();

/** The thread's conversation, read again as it moves. */
function useTranscript(agent: Agent): { entries: Entry[]; dropped: number } | null {
  const [got, setGot] = useState<{ entries: Entry[]; dropped: number } | null>(null);
  const last = useRef<number | null>(null);
  const session = agent.session_id;
  useEffect(() => {
    if (!session) return;
    let live = true;
    const read = async () => {
      try {
        const from = last.current;
        const t: Transcript | null = isPreview()
          ? (await import("../nebula/mock")).mockTranscript(getState(), agent.id)
          : await invoke<Transcript | null>("thread_transcript", { session, from, kind: agent.kind });
        if (!live || !t) return;
        setGot((prev) => {
          // Nothing new since the last read: keep what's shown as it is.
          const same = prev && from !== null && t.dropped === prev.dropped;
          if (same && JSON.stringify(t.entries) === JSON.stringify(prev.entries.filter((e) => e.n >= from))) return prev;
          const entries = from === null || !prev ? t.entries : merge(prev.entries, t.entries, t.dropped);
          last.current = entries.length ? entries[entries.length - 1].n : null;
          return { entries, dropped: t.dropped };
        });
      } catch {
        // No log to read: the reader says so.
      }
    };
    void read();
    // Keep reading whatever the status says: a turn's last reply can reach
    // the log after the thread shows finished, and nothing else fetches it.
    const timer = window.setInterval(read, 2500);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [session, agent.id, agent.status, agent.status_changed_at]);
  return got;
}

// A line break in a reply is one on screen too, so lines written one under
// another (a list after a bold label, with no blank line) don't run together.
const toHtml = (md: string, inline = false) =>
  DOMPurify.sanitize(
    (inline ? marked.parseInline(md, { async: false, breaks: true }) : marked.parse(md, { async: false, breaks: true })) as string,
  );

/** What a reply's paths and "#75"s are read against: the thread they're
 *  from, its checkout, and any PR of its project, for the repo's address. */
const Where = createContext<{ from: string; root: string; prUrl: string | null }>({ from: "", root: "", prUrl: null });

/** Links in a reply open in the browser, not in the app's webview; a path
 *  opens in the preview. */
function openLink(e: MouseEvent) {
  const path = (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
  if (path) {
    e.preventDefault();
    void openPreview([path.dataset.path!], path.dataset.from || null);
    return;
  }
  const href = (e.target as HTMLElement).closest("a")?.getAttribute("href");
  if (!href) return;
  e.preventDefault();
  if (/^https?:/i.test(href)) void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch(() => {});
}

/** Put `text` on the clipboard and say so. */
function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => flash(`Copied ${what}`, 1500),
    () => flash("Couldn't copy that", 4000),
  );
}

function Md({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => toHtml(text), [text]);
  const el = useRef<HTMLDivElement>(null);
  // Each code block is colored by its language, and gets a Copy for what's in it.
  useEffect(() => {
    if (el.current) highlightUnder(el.current);
    const added: HTMLElement[] = [];
    for (const pre of el.current?.querySelectorAll("pre") ?? []) {
      const b = document.createElement("button");
      b.className = "rd-copy";
      b.textContent = "Copy";
      b.title = "Copy this block";
      b.onclick = (e) => {
        e.stopPropagation();
        copy((pre.querySelector("code") ?? pre).textContent?.replace(/\n$/, "") ?? "", "the block");
      };
      pre.append(b);
      added.push(b);
    }
    return () => added.forEach((b) => b.remove());
  }, [html]);
  // A code span that names a file on disk opens it; "#75" goes to that PR.
  const where = useContext(Where);
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    let live = true;
    const spans = [...root.querySelectorAll<HTMLElement>("code")].filter((c) => !c.closest("pre") && pathInCode(c.textContent ?? ""));
    void resolve(
      spans.map((c) => pathInCode(c.textContent ?? "")!),
      where.root || null,
    ).then((abs) => {
      if (!live) return;
      spans.forEach((c, i) => {
        if (!abs[i]) return;
        c.classList.add("rd-path");
        c.dataset.path = abs[i]!;
        c.dataset.from = where.from;
        c.title = `Open ${abs[i]}`;
      });
    });
    if (where.prUrl) {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement?.closest("a, code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      const texts: Text[] = [];
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (findPrRefs(n.textContent ?? "").length) texts.push(n as Text);
      for (const node of texts) {
        const text = node.textContent ?? "";
        const frag = document.createDocumentFragment();
        let at = 0;
        for (const ref of findPrRefs(text)) {
          frag.append(text.slice(at, ref.start));
          const a = document.createElement("a");
          a.href = prLink(where.prUrl, ref.number);
          a.className = "rd-pr";
          a.textContent = text.slice(ref.start, ref.start + ref.length);
          frag.append(a);
          at = ref.start + ref.length;
        }
        frag.append(text.slice(at));
        node.replaceWith(frag);
      }
    }
    return () => {
      live = false;
    };
  }, [html, where.root, where.prUrl]);
  return <div ref={el} className={`md-doc rd-md ${className}`} dangerouslySetInnerHTML={{ __html: html }} onClick={openLink} />;
}

/** The images a reply names, shown in it; a click opens the preview. */
function Pictures({ paths, from, pair = null }: { paths: string[]; from: string; pair?: [string, string] | null }) {
  const [ready, setReady] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(paths.map((p) => describe(p).then(() => p, () => null))).then((got) => {
      if (live) setReady(got.filter((p): p is string => !!p));
    });
    return () => {
      live = false;
    };
  }, [paths.join("\n")]);
  if (!ready.length) return null;
  // Before and after side by side, at the same size, to compare.
  if (pair && pair.every((p) => ready.includes(p)))
    return (
      <div className="rd-pics is-pair">
        {pair.map((p, i) => (
          <figure key={p}>
            <button className="rd-pic" onClick={() => void openPreview(pair, from)} title={`Open ${p}`}>
              <img src={previewUrl(p)} alt={i ? "After" : "Before"} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            </button>
            <figcaption>{i ? "After" : "Before"}</figcaption>
          </figure>
        ))}
      </div>
    );
  return (
    <div className="rd-pics">
      {ready.map((p) => (
        <button key={p} className="rd-pic" onClick={() => void openPreview([p], from)} title={`Open ${p}`}>
          <img src={previewUrl(p)} alt="" onError={(e) => (e.currentTarget.closest(".rd-pic") as HTMLElement).remove()} />
        </button>
      ))}
    </div>
  );
}

/** The videos a reply names, ready to play in it; Open puts one in the
 *  preview, bigger. */
function Videos({ paths, from }: { paths: string[]; from: string }) {
  const [ready, setReady] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(paths.map((p) => describe(p).then(() => p, () => null))).then((got) => {
      if (live) setReady(got.filter((p): p is string => !!p));
    });
    return () => {
      live = false;
    };
  }, [paths.join("\n")]);
  if (!ready.length) return null;
  return (
    <div className="rd-pics">
      {ready.map((p) => (
        <figure key={p} className="rd-video">
          <video src={previewUrl(p)} controls playsInline preload="metadata" />
          <figcaption>
            <span title={p}>{baseName(p)}</span>
            <button className="btn btn-sm" onClick={() => void openPreview([p], from)} title="Open in the preview">
              Open
            </button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** How the reply closes: safe to close, with the button that does it while
 *  this is the latest reply, or what's keeping it open, with what's left to
 *  ship beside it. */
function VerdictLine({ verdict, onClose, ship }: { verdict: Chip; onClose?: () => void; ship?: Ship | null }) {
  return (
    <div className="rd-verdict-row">
      <p className={`rd-verdict is-${verdict.tone}`}>
        <span className="rd-verdict-text" dangerouslySetInnerHTML={{ __html: toHtml(verdict.text, true) }} />
      </p>
      {verdict.tone === "done" && onClose && (
        <button className="btn btn-primary btn-sm" onClick={onClose} title="Archives the thread; Undo brings it back">
          Close thread
        </button>
      )}
      {ship && verdict.tone !== "done" && (
        <button className="btn btn-sm" onClick={ship.run} title={ship.title}>
          {ship.label}
        </button>
      )}
    </div>
  );
}

/** "Other…" after a decision's options: an answer of your own, written in. */
function OtherAnswer({ value, live, sent, onSet }: { value: string; live: boolean; sent: boolean; onSet: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (editing)
    return (
      <input
        className="rd-other"
        autoFocus
        value={text}
        placeholder="Your answer"
        aria-label="Your own answer"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (text.trim() !== value) onSet(text.trim() || value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setText(value);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <button
      className={`rd-opt${value ? (sent ? " is-on is-sent" : " is-on") : ""}`}
      disabled={!live}
      aria-pressed={!!value}
      onClick={() => {
        setText(value);
        setEditing(true);
      }}
    >
      {value || "Other…"}
    </button>
  );
}

/** A reply written as a card: headline, status, pictures, decisions to tap,
 *  and details folded away. Decisions only take taps on the latest reply. */
export function CardReply({
  card,
  pair,
  ship = null,
  compact = false,
  from,
  live,
  sent,
  picks,
  onPick,
  onClose,
}: {
  card: Card;
  /** Its two pictures as before and after, when it says which is which. */
  pair: [string, string] | null;
  /** What git says is left to ship, offered beside a verdict that keeps the
   *  thread open: Commit & push, Push or Resolve. */
  ship?: Ship | null;
  /** Just the headline, status and decisions, as Decisions lists it. */
  compact?: boolean;
  from: string;
  live: boolean;
  /** The picks are what you answered with, not taps waiting to be sent. */
  sent: boolean;
  picks: Record<number, string>;
  onPick: (n: number, letter: string) => void;
  onClose?: () => void;
}) {
  const headline = useMemo(() => (card.headline ? toHtml(card.headline, true) : ""), [card.headline]);
  return (
    <article className="rd-card">
      {headline && <h3 className="rd-head" dangerouslySetInnerHTML={{ __html: headline }} onClick={openLink} />}
      {card.chips.length > 0 && (
        <div className="rd-chips">
          {card.chips.map((c, i) => (
            <span key={i} className={`rd-chip is-${c.tone}`}>
              {c.text}
            </span>
          ))}
        </div>
      )}
      {!compact && <Pictures paths={card.images} from={from} pair={pair} />}
      {!compact && <Videos paths={card.videos} from={from} />}
      {!compact && card.body && <Md text={card.body} />}
      {card.asks.length > 0 && (
        <section className="rd-needs" aria-label="Needs you">
          <h4>Needs you</h4>
          {card.asks.map((a) => (
            <div key={a.n} className="rd-q">
              <span className="rd-q-text" dangerouslySetInnerHTML={{ __html: toHtml(`${a.n}. ${a.text}`, true) }} />
              {a.options.length > 0 && (
                <span className="rd-opts">
                  {a.options.map((o) => (
                    <button
                      key={o.letter}
                      className={`rd-opt${picks[a.n] === o.letter ? (sent ? " is-on is-sent" : " is-on") : ""}`}
                      disabled={!live}
                      aria-pressed={picks[a.n] === o.letter}
                      title={sent && picks[a.n] === o.letter ? "You answered this" : undefined}
                      onClick={() => onPick(a.n, o.letter)}
                    >
                      <b>{o.letter}</b> <span dangerouslySetInnerHTML={{ __html: toHtml(o.label, true) }} />
                    </button>
                  ))}
                  {(live || (picks[a.n] ?? "").length > 1) && (
                    <OtherAnswer value={(picks[a.n] ?? "").length > 1 ? picks[a.n] : ""} live={live} sent={sent} onSet={(v) => onPick(a.n, v)} />
                  )}
                </span>
              )}
            </div>
          ))}
          {card.asksNote && <Md text={card.asksNote} />}
        </section>
      )}
      {!compact && card.details && (
        <details className="rd-fold">
          <summary>Details</summary>
          <Md text={card.details} />
        </details>
      )}
      {card.verdict && <VerdictLine verdict={card.verdict} onClose={onClose} ship={ship} />}
    </article>
  );
}

type Ship = { label: string; title: string; run: () => void };

function Reply(props: {
  ship?: Ship | null;
  text: string;
  from: string;
  live: boolean;
  sent: boolean;
  picks: Record<number, string>;
  onPick: (n: number, letter: string) => void;
  onClose?: () => void;
}) {
  const card = useMemo(() => readCard(props.text), [props.text]);
  const pair = useMemo(() => beforeAfter(card.images, props.text), [card.images, props.text]);
  return isCard(card) ? <CardReply card={card} pair={pair} {...props} /> : <Md text={props.text} />;
}

/** What a step changed, or how it failed: a failure shows at once, a
 *  change when you ask. */
function StepDetail({ detail, failed }: { detail: string; failed: boolean }) {
  const [open, setOpen] = useState(failed);
  const lines = detail.split("\n");
  return (
    <>
      <button className="link-btn rd-step-more" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide" : failed ? "Output" : "Diff"}
      </button>
      {open && (
        <pre className={`rd-diff${failed ? " is-output" : ""}`}>
          {lines.map((l, i) => (
            <span key={i} className={failed ? "" : l.startsWith("+ ") ? "is-add" : l.startsWith("- ") ? "is-del" : "is-gap"}>
              {l}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
    </>
  );
}

/** How long the turn under way has run, ticking. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!since) return null;
  return <span className="rd-elapsed">{clock((now - since) / 1000)}</span>;
}

type Undecided = ReturnType<typeof openDecisions>[number];

/** Decisions left open on earlier replies, folded to a line above the box.
 *  An option puts its answer in the box, said against that reply. */
function OpenDecisions({
  open,
  onShow,
  onAnswer,
  onDismiss,
}: {
  open: Undecided[];
  onShow: (n: number) => void;
  onAnswer: (d: Undecided, n: number, letter: string) => void;
  onDismiss: (d: Undecided) => void;
}) {
  const count = open.reduce((k, d) => k + d.asks.length, 0);
  return (
    <details className="rd-open">
      <summary>{count === 1 ? "1 earlier decision still open" : `${count} earlier decisions still open`}</summary>
      {open.map((d) => (
        <div key={d.entry} className="rd-open-reply">
          <div className="rd-open-head">
            <button className="link-btn rd-quote" onClick={() => onShow(d.entry)} title="Show this reply">
              “{d.quote}”
            </button>
            <button className="link-btn" onClick={() => onDismiss(d)} aria-label="Put these away" title="Put these away">
              ×
            </button>
          </div>
          {d.asks.map((a) => (
            <div key={a.n} className="rd-q">
              <span className="rd-q-text" dangerouslySetInnerHTML={{ __html: toHtml(`${a.n}. ${a.text}`, true) }} />
              <span className="rd-opts">
                {a.options.map((o) => (
                  <button key={o.letter} className="rd-opt" onClick={() => onAnswer(d, a.n, o.letter)}>
                    <b>{o.letter}</b> <span dangerouslySetInnerHTML={{ __html: toHtml(o.label, true) }} />
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
    </details>
  );
}

function Steps({ entry, root, fresh }: { entry: Entry; root: string; fresh: boolean }) {
  const rel = (t: string) => (root && t.startsWith(`${root}/`) ? t.slice(root.length + 1) : t);
  const failed = entry.steps.some((s) => s.ok === false);
  return (
    <details className={`rd-steps${failed ? " has-failed" : ""}${fresh ? " is-new" : ""}`}>
      <summary>{stepsLine(entry.steps)}</summary>
      <ul>
        {entry.steps.map((s, i) => (
          <li key={i}>
            <span className={`ts-mark ${s.ok === null ? "is-pending" : s.ok ? "is-ok" : "is-bad"}`} aria-hidden>
              {s.ok === null ? "…" : s.ok ? "✓" : "✕"}
            </span>
            <span className="rd-tool">{s.tool.replace(/^mcp__.+?__/, "")}</span>
            <code title={s.target}>{rel(s.target)}</code>
            {s.detail && <StepDetail detail={s.detail} failed={s.ok === false} />}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The thread as something to read: your prompts, Claude's replies set as
 *  prose, and the work between them folded to a line each. Replies go in
 *  from the box at the bottom. */
export function Reader({
  agent,
  root,
  onTerminal,
  question,
  onPick,
}: {
  agent: Agent;
  root: string;
  onTerminal: () => void;
  question: Question | null;
  onPick: (c: Choice) => void;
}) {
  const t = useTranscript(agent);
  const state = useAppState();
  const where = useMemo(() => {
    const project = state.worktrees[agent.worktree_id]?.project_id;
    const pr = Object.values(state.worktrees)
      .filter((w) => w.project_id === project)
      .map((w) => state.prs[w.id])
      .find((p) => p?.kind === "found");
    return { from: agent.id, root, prUrl: pr?.kind === "found" ? pr.pr.url : null };
  }, [agent.id, agent.worktree_id, root, state.worktrees, state.prs]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  // Entries there when the thread opened sit still; later ones arrive.
  const known = useRef<number | null>(null);
  if (t && known.current === null) known.current = t.entries.length ? t.entries[t.entries.length - 1].n : -1;
  const fresh = (e: Entry) => known.current !== null && e.n > known.current;
  const lastN = useRef<number | null>(null);
  // Where you'd read to last time, and what that makes of the thread as it
  // opened: a line where the new part starts, earlier turns folded away.
  const plan = useRef<ReturnType<typeof readPlan> | null>(null);
  if (t && !plan.current) plan.current = readPlan(t.entries, readTo(agent.id));
  const [unfolded, setUnfolded] = useState(false);
  const foldTo = unfolded ? null : (plan.current?.foldTo ?? null);
  const seenAll = () => lastN.current !== null && markRead(agent.id, lastN.current);
  // Something arrived below while you were scrolled up.
  const [behind, setBehind] = useState(false);
  const [draft, setDraftState] = useState(() => drafts.get(agent.id) ?? "");
  const setDraft = (text: string) => {
    drafts.set(agent.id, text);
    setDraftState(text);
  };
  // A glide down to the latest is under way; resizes leave it be.
  const gliding = useRef(false);
  const waiting = agent.status === "needs_feedback";
  // Answers tapped on the latest reply, until you send them or it moves on.
  const [tapped, setTapped] = useState<{ entry: number; picks: Record<number, string> }>({ entry: -1, picks: {} });
  const latest = useMemo(() => {
    const all = t?.entries ?? [];
    const last = [...all].reverse().find((e) => e.kind === "claude");
    return last && !all.some((e) => e.kind === "you" && e.n > last.n) ? last.n : -1;
  }, [t?.entries]);
  // Answers queued while it works, shown as sent until your message lands.
  const [queued, setQueued] = useState<{ entry: number; picks: Record<number, string>; text: string; how: "sent" | "queued" }>({
    entry: -1,
    picks: {},
    text: "",
    how: "sent",
  });
  const picks = tapped.entry === latest ? tapped.picks : {};
  // A queued message you took back out of the queue no longer counts.
  const stillGoing = queued.how === "sent" || (getState().queue[agent.id] ?? []).some((q) => q.text === queued.text);
  // What you answered each earlier reply with, read from the message after it.
  const answered = useMemo(() => {
    const out: Record<number, Record<number, string>> = {};
    let reply = -1;
    for (const e of t?.entries ?? []) {
      if (e.kind === "claude" && readCard(e.text).asks.length) reply = e.n;
      else if (e.kind === "you" && reply >= 0) {
        // A message pointing at a reply says which first, then the answers.
        const said = answersSaid(e.text);
        out[reply] = Object.keys(said).length ? said : answersSaid(e.text.split(/\n\s*\n/).slice(1).join("\n\n"));
        reply = -1;
      }
    }
    return out;
  }, [t?.entries]);
  // The step under way, said as what it's doing.
  const doing = useMemo(() => {
    const last = t?.entries[t.entries.length - 1];
    const step = last?.kind === "steps" ? last.steps[last.steps.length - 1] : undefined;
    return step && step.ok === null ? doingLine(step) : null;
  }, [t?.entries]);
  const latestCard = useMemo(() => {
    const e = t?.entries.find((x) => x.n === latest);
    return e ? readCard(e.text) : null;
  }, [t?.entries, latest]);
  // Answers typed or dictated into the box ("2 a, 3 b") light up as taps.
  const typed = typedAnswers(latestCard, draft);
  const shown = { ...typed.picks, ...Object.fromEntries(Object.entries(picks).filter(([, l]) => l)) };
  const showQueued = queued.entry === latest && stillGoing && !answerText(shown, "");
  const pick = (n: number, letter: string) => {
    // Tapping takes over the typed answers, so they aren't said twice.
    const base = Object.keys(typed.picks).length ? { ...typed.picks, ...picks } : picks;
    if (Object.keys(typed.picks).length) setDraft(typed.rest);
    setTapped({ entry: latest, picks: { ...base, [n]: base[n] === letter ? "" : letter } });
  };
  // Opening the Read view from its switch puts you in the thread, so ⌘F and
  // ⌘↑ work at once; a box you're typing in keeps its focus.
  useEffect(() => {
    const at = document.activeElement;
    if (!at || at === document.body || at.closest("[role=radiogroup]")) scroller.current?.focus({ preventScroll: true });
  }, []);
  // ⌘F finds in the thread while you're in it; ⌘↑/⌘↓ go from one of your
  // messages to the one before or after, ⇧⌘↑/⇧⌘↓ to either end.
  const [finding, setFinding] = useState(false);
  const readerEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inside = readerEl.current?.contains(document.activeElement);
      if (!e.metaKey || e.altKey || e.ctrlKey || !inside) return;
      if (e.key === "f") {
        e.preventDefault();
        setUnfolded(true);
        setFinding(true);
        return;
      }
      if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || (document.activeElement as HTMLElement).matches("textarea, input")) return;
      const el = scroller.current;
      if (!el) return;
      e.preventDefault();
      const up = e.key === "ArrowUp";
      if (e.shiftKey) {
        if (up) {
          setUnfolded(true);
          stick.current = false;
          el.scrollTop = 0;
        } else toBottom("auto");
        return;
      }
      const top = el.getBoundingClientRect().top;
      const mine = [...el.querySelectorAll<HTMLElement>(".rd-you:not(.is-queued)")];
      const next = up
        ? mine.filter((m) => m.getBoundingClientRect().top < top - 4).pop()
        : mine.find((m) => m.getBoundingClientRect().top > top + 20);
      if (next) {
        stick.current = false;
        el.scrollTop += next.getBoundingClientRect().top - top - 16;
      } else if (up && foldTo !== null) setUnfolded(true);
      else if (!up) toBottom("auto");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Decisions earlier replies asked that you haven't answered, kept in view
  // until you answer or put them away.
  // Entry numbers start over with each session, so what you put away is kept per session.
  const thread = `${agent.id}:${agent.session_id}`;
  const [dismissed, setDismissed] = useState<Set<number>>(() => dismissedFor.get(thread) ?? new Set());
  useEffect(() => void dismissedFor.set(thread, dismissed), [thread, dismissed]);
  const undecided = useMemo(
    () => openDecisions(t?.entries ?? [], latest).filter((d) => !dismissed.has(d.entry)),
    [t?.entries, latest, dismissed],
  );
  const turns = useMemo(() => turnsOf(t?.entries ?? []), [t?.entries]);
  // A reply kept as a note, in the folder picked in Settings.
  const saveNote = async (text: string) => {
    if (!state.prefs.notesFolder) {
      flash("Pick a notes folder first, in Settings under Read view", 6000);
      return;
    }
    const project = state.projects[state.worktrees[agent.worktree_id]?.project_id ?? ""]?.name ?? "";
    const note = noteFor(text, { thread: agent.name, project, date: new Date().toLocaleDateString("sv") });
    if (isPreview()) return flash(`Saved “${note.name}” to your notes`);
    try {
      const path = await invoke<string>("save_note", { name: note.name, text: note.body });
      flash(`Saved to ${path.split("/").pop()}`);
    } catch (e) {
      flash(`Couldn't save the note: ${e}`, 6000);
    }
  };
  // What's left to ship on this thread's checkout, asked of the agent itself.
  const ship = useMemo((): Ship | null => {
    const g = state.git[agent.worktree_id];
    const wt = state.worktrees[agent.worktree_id];
    if (!g || "error" in g || !wt) return null;
    const kind = shipKind(g, wt);
    if (!kind) return null;
    const what = shipWhat(kind, g.branch ?? "this branch");
    return {
      label: SHIP_LABEL[kind],
      title: `Ask ${agent.name} to ${what}`,
      run: () =>
        void enqueue(agent, shipPrompt(kind, g)).then(
          (how) => flash(how === "queued" ? `Queued for ${agent.name}: ${what}` : `Asked ${agent.name} to ${what}`),
          () => flash(`Couldn't ask ${agent.name} to ${what}`, 6000),
        ),
    };
  }, [state.git, state.worktrees, agent]);
  const showReply = (n: number, which = ".rd-reply") => {
    if (foldTo !== null && n < foldTo) setUnfolded(true);
    // After the fold opens, if it had to.
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`${which}[data-n="${n}"]`);
      if (!el) return;
      stick.current = false;
      el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      el.classList.remove("is-flash");
      void el.offsetWidth;
      el.classList.add("is-flash");
    });
  };
  // "Point at this": a reply you want looked at, with a screenshot of how it
  // showed, sent along with whatever you say about it.
  const [pointed, setPointed] = useState<{ entry: number; quote: string; shot: string | null; passage?: boolean } | null>(null);
  // Text selected in a reply, offered as "Reply about this" beside it.
  const [selected, setSelected] = useState<{ entry: number; text: string; x: number; y: number } | null>(null);
  const readSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const reply = sel?.anchorNode?.parentElement?.closest<HTMLElement>(".rd-reply[data-n]");
    const reader = scroller.current?.parentElement;
    if (!text || !reply || !sel?.rangeCount || !reader || !reply.contains(sel.focusNode)) return setSelected(null);
    const box = sel.getRangeAt(0).getBoundingClientRect();
    const at = reader.getBoundingClientRect();
    setSelected({ entry: Number(reply.dataset.n), text, x: box.left - at.left + box.width / 2, y: box.top - at.top });
  };
  useEffect(() => {
    const clear = () => !window.getSelection()?.toString().trim() && setSelected(null);
    document.addEventListener("selectionchange", clear);
    return () => document.removeEventListener("selectionchange", clear);
  }, []);
  const [pointing, setPointing] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // What the latest card recommends, offered in the empty box like the
  // terminal's ghost text: Tab taps those answers, Enter sends them.
  const recommended = useMemo(() => (latestCard ? suggested(latestCard) : {}), [latestCard]);
  const ghost = !draft && !answerText(picks, "") && !pointed && !showQueued ? answerText(recommended, "") : "";
  const said = answerText(picks, draft);
  const outgoing =
    pointed && said
      ? pointed.passage
        ? passageText(pointed.quote, said)
        : pointerText(pointed.quote, pointed.shot, said)
      : pointed
        ? ""
        : said;
  const point = async (e: Entry) => {
    if (pointing !== null) return;
    setPointing(e.n);
    const saved = await saveMoment().catch(() => null);
    setPointing(null);
    if (saved?.noScreenshot) flash(saved.noScreenshot, 6000);
    setPointed({ entry: e.n, quote: replyQuote(e.text), shot: saved && !saved.noScreenshot ? `${saved.dir}/screenshot.png` : null });
    box.current?.focus();
  };

  // Stay at the bottom while new entries come in, unless you scrolled up;
  // then say something new is below instead.
  useLayoutEffect(() => {
    const el = scroller.current;
    const n = t?.entries.length ? t.entries[t.entries.length - 1].n : null;
    const grew = lastN.current !== null && n !== null && n > lastN.current;
    const opening = lastN.current === null;
    lastN.current = n;
    if (!el) return;
    // Polls hand back a new list even when nothing changed; only arrivals move you.
    // Opening on something new starts you where it starts, not at the end.
    const since = opening ? el.querySelector<HTMLElement>(".rd-since") : null;
    const at = since ? since.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 24 : 0;
    if (since && at + el.clientHeight < el.scrollHeight) {
      stick.current = false;
      el.scrollTop = at;
      lastTop.current = el.scrollTop;
      setBehind(true);
    } else if (stick.current && (grew || opening)) toBottom(opening ? "auto" : "smooth");
    else if (grew) setBehind(true);
    if (stick.current) seenAll();
  }, [t?.entries]);

  // Pictures and folds change the height after the entries land; stay at
  // the bottom through that too.
  useEffect(() => {
    const el = scroller.current;
    const col = el?.firstElementChild;
    if (!el || !col) return;
    const watch = new ResizeObserver(() => {
      if (stick.current && !gliding.current) el.scrollTop = el.scrollHeight;
    });
    watch.observe(col);
    return () => watch.disconnect();
  }, [!t]);

  const toBottom = (how: ScrollBehavior) => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setBehind(false);
    const smooth = how === "smooth" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    gliding.current = smooth;
    // WebKit has no scrollend; reaching the bottom ends the glide, or this.
    if (smooth) window.setTimeout(() => (gliding.current = false), 700);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  const send = async () => {
    const text = outgoing;
    if (!text || waiting) return;
    const was = { draft, tapped, pointed };
    setDraft("");
    setTapped({ entry: -1, picks: {} });
    setPointed(null);
    stick.current = true;
    try {
      const how = await enqueue(agent, text);
      setQueued({ entry: latest, picks, text, how });
      if (how === "queued") flash(`Queued for ${agent.name}: sent when its turn ends`);
    } catch {
      // It didn't go: put back what you wrote and picked.
      setDraft(was.draft);
      setTapped(was.tapped);
      setPointed(was.pointed);
      flash(`Couldn't send to ${agent.name}. Your reply is still in the box.`, 6000);
    }
  };

  return (
    <Where.Provider value={where}>
      <div
        ref={readerEl}
        className={`reader${state.prefs.readerText ? ` is-text-${state.prefs.readerText}` : ""}${state.prefs.readerWidth === "wide" ? " is-wide" : ""}`}
      >
        {finding && (
          <ReaderFind
            scroller={scroller}
            version={t?.entries}
            onClose={() => {
              setFinding(false);
              scroller.current?.focus();
            }}
          />
        )}
        {turns.length >= 3 && (
          <nav className="rd-rail" aria-label="Turns in this thread">
            {turns.map((x) => (
              <button
                key={x.n}
                className={`rd-rail-dot${x.tone ? ` is-${x.tone}` : ""}`}
                title={x.prompt}
                aria-label={`Go to “${x.prompt}”`}
                onClick={() => showReply(x.n, ".rd-you")}
              />
            ))}
          </nav>
        )}
        <div
          className="rd-scroll"
          tabIndex={-1}
          ref={scroller}
          onMouseUp={readSelection}
          onKeyUp={(e) => e.shiftKey && readSelection()}
          onScroll={(e) => {
            if (selected) setSelected(null);
            // Only scrolling up lets go of the bottom, so a smooth glide down
            // to a new entry doesn't count as leaving it.
            const el = e.currentTarget;
            // Content shrinking (a fold closing, the working line going)
            // pulls scrollTop back too; that isn't you, unless it leaves
            // you away from the bottom.
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            if (el.scrollTop < lastTop.current - 2 && !near) stick.current = false;
            else if (near) {
              if (!stick.current) seenAll();
              stick.current = true;
              gliding.current = false;
              setBehind(false);
            }
            lastTop.current = el.scrollTop;
          }}
        >
          <div className="rd-col">
            {!t ? (
              <p className="rd-note">Reading the thread…</p>
            ) : t.entries.length === 0 ? (
              <p className="rd-note">Nothing said yet.</p>
            ) : (
              <>
                {t.dropped > 0 && <p className="rd-note">Earlier messages aren't shown; the terminal has them.</p>}
                {foldTo !== null && (
                  <button className="rd-earlier" onClick={() => setUnfolded(true)}>
                    {plan.current!.turns === 1 ? "1 earlier turn" : `${plan.current!.turns} earlier turns`}
                  </button>
                )}
                {t.entries.filter((e) => foldTo === null || e.n >= foldTo).flatMap((e) => [
                  ...(e.n === plan.current?.unread
                    ? [
                        <p key="since" className="rd-since" role="separator">
                          <span>New since you were here</span>
                        </p>,
                      ]
                    : []),
                  e.kind === "you" ? (
                    <div key={e.n} data-n={e.n} className={`rd-you${fresh(e) ? " is-new" : ""}`}>
                      {e.text}
                    </div>
                  ) : e.kind === "claude" ? (
                    <div
                      key={e.n}
                      data-n={e.n}
                      className={`rd-reply${pointed?.entry === e.n ? " is-pointed" : ""}${fresh(e) ? " is-new" : ""}`}
                    >
                      <Reply
                        ship={e.n === latest && !waiting ? ship : null}
                        text={e.text}
                        from={agent.id}
                        live={e.n === latest && !waiting}
                        sent={e.n !== latest || showQueued}
                        picks={e.n !== latest ? (answered[e.n] ?? {}) : showQueued ? queued.picks : shown}
                        onPick={pick}
                        onClose={e.n === latest && agent.status === "finished" && !agent.archived ? () => closeThread(agent) : undefined}
                      />
                      <div className="rd-tools">
                        <button className="rd-point" onClick={() => copy(e.text, "the reply")} title="Copy this reply as Markdown. To copy part of it, select that part and press ⌘C">
                          Copy
                        </button>
                        <button
                          className="rd-point"
                          onClick={() => void saveNote(e.text)}
                          title={
                            state.prefs.notesFolder
                              ? `Save this reply as a Markdown note in ${state.prefs.notesFolder}`
                              : "Save this reply as a Markdown note, in a folder you pick in Settings"
                          }
                        >
                          Save as note
                        </button>
                        {!waiting && (
                          <button
                            className={`rd-point${pointing === e.n ? " is-busy" : ""}`}
                            disabled={pointing !== null}
                            onClick={() => void point(e)}
                            title="Take a screenshot of this reply and tell the agent what to change about it"
                          >
                            {pointing === e.n ? "Capturing…" : "Point at this"}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : e.kind === "steps" ? (
                    <Steps key={e.n} entry={e} root={root.replace(/\/+$/, "")} fresh={fresh(e)} />
                  ) : (
                    <p key={e.n} className={`rd-note${fresh(e) ? " is-new" : ""}`}>
                      Stopped by you
                    </p>
                  ),
                ])}
                {(state.queue[agent.id] ?? []).map((q) => (
                  <div key={q.id} className="rd-you is-queued">
                    {q.text}
                    <span className="rd-queued-bar">
                      <span>Queued, sent when its turn ends</span>
                      <button
                        className="link-btn"
                        onClick={() => {
                          unqueue(agent.id, q.id);
                          setDraft(draft.trim() ? `${q.text}\n\n${draft}` : q.text);
                          box.current?.focus();
                        }}
                      >
                        Edit
                      </button>
                      <button className="link-btn" onClick={() => unqueue(agent.id, q.id)}>
                        Take back
                      </button>
                    </span>
                  </div>
                ))}
                {agent.status === "running" && (
                  <p className="rd-note rd-working">
                    <span className="rd-pulse" aria-hidden />
                    <span className="rd-doing">{doing ?? "Working…"}</span>
                    <Elapsed since={agent.status_changed_at} />
                  </p>
                )}
              </>
            )}
          </div>
          {selected && (
            <button
              className="rd-about"
              style={{ left: selected.x, top: selected.y }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setPointed({ entry: selected.entry, quote: selected.text, shot: null, passage: true });
                setSelected(null);
                window.getSelection()?.removeAllRanges();
                box.current?.focus();
              }}
            >
              Reply about this
            </button>
          )}
          {behind && (
            <div className="rd-latest-at">
              <button className="rd-latest" onClick={() => toBottom("smooth")}>
                ↓ Jump to latest
              </button>
            </div>
          )}
        </div>
        {!waiting && undecided.length > 0 && (
          <OpenDecisions
            open={undecided}
            onShow={showReply}
            onAnswer={(d, n, letter) => {
              const line = `About your reply that starts "${d.quote}": ${n} ${letter}`;
              setDraft(draft.trim() ? `${draft.trimEnd()}\n${line}` : line);
              box.current?.focus();
            }}
            onDismiss={(d) => setDismissed((x) => new Set(x).add(d.entry))}
          />
        )}
        <div className="rd-compose">
          {waiting && question ? (
            <div className="rd-ask">
              {question.prompt && <p className="rd-wait">{question.prompt}</p>}
              <AskChoices question={question} onPick={onPick} />
            </div>
          ) : waiting ? (
            <p className="rd-wait">
              It's waiting on a choice in the terminal.{" "}
              <button className="link-btn" onClick={onTerminal}>
                Answer there
              </button>
            </p>
          ) : (
            <>
              {pointed && (
                <span className="rd-picked rd-pointed" title={pointed.shot ?? "No screenshot"}>
                  <span className="rd-quote">{pointed.passage ? "On" : "About"} “{pointed.quote}”</span>
                  <button className="link-btn" onClick={() => setPointed(null)} aria-label="Stop pointing at that reply">
                    ×
                  </button>
                </span>
              )}
              {answerText(picks, "") && (
                <span className="rd-picked">
                  {answerText(picks, "")}
                  <button className="link-btn" onClick={() => setTapped({ entry: -1, picks: {} })} aria-label="Clear the answers">
                    ×
                  </button>
                </span>
              )}
              <textarea
                ref={box}
                rows={2}
                value={draft}
                placeholder={
                  ghost
                    ? `${ghost}    Tab to use it`
                    : pointed
                    ? pointed.passage
                      ? "What do you want to ask or change about it?"
                      : "What should change about it?"
                    : answerText(picks, "")
                    ? "Add anything else, or just send"
                    : isIdle(agent)
                      ? `Reply to ${agent.name}`
                      : `Queue a reply for when ${agent.name} is done`
                }
                aria-label="Reply"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && !e.shiftKey && ghost) {
                    e.preventDefault();
                    setTapped({ entry: latest, picks: recommended });
                  } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    // Enter sends, like the terminal; Shift-Enter starts a new line.
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button className="btn btn-primary" disabled={!outgoing} onClick={() => void send()} title="Send (↵). Shift-↵ for a new line">
                {isIdle(agent) ? "Send" : "Queue"}
              </button>
            </>
          )}
        </div>
      </div>
    </Where.Provider>
  );
}
