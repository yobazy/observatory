import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { closeLeadChat, markLeadSeen, noteReply, useLeads, useOpenLead } from "../nebula/leadCalls";
import { ASK_USER } from "../nebula/leadAsk";
import { hasStandIn, lastReply, pages, talkPhase, type BoxSize, type LeadEntry } from "../nebula/leadChat";
import { enqueue } from "../nebula/queue";
import { setPaneMode } from "../nebula/pane";
import { flash, getState, projectOfWorktree, setState, useAppState } from "../nebula/store";
import type { Agent } from "../nebula/types";
import type { FrameName } from "../vendor/pixel-pets/frames.ts";
import { PetSprite } from "./Pet";
import { useTranscript } from "./Reader";

// Talk to a lead as its pet (S27): a DS-style dialogue along the bottom of
// whatever view is open. The big pet slides up, then the text box with its
// name plate; the lead's latest reply types out a page at a time.

/** How long the box takes to slide away before it goes. */
const CLOSE_MS = 320;
/** Characters typed per tick, and the tick. */
const TYPE_STEP = 2;
const TYPE_MS = 22;
const ROWS = 3;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Mount once, over the views. Opens on a pet's click or ⌘L, never on its own. */
export function LeadChat() {
  const openId = useOpenLead();
  const leads = useLeads();
  const { agents } = useAppState();
  // Kept while the box slides away, so it has something to show.
  const [shown, setShown] = useState<string | null>(openId);
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (openId) {
      setShown(openId);
      // A frame down first, so the slide up runs.
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
      return () => cancelAnimationFrame(r);
    }
    setUp(false);
    const t = window.setTimeout(() => setShown(null), reducedMotion() ? 0 : CLOSE_MS);
    return () => clearTimeout(t);
  }, [openId]);
  // Its thread archived or gone while open: nothing to talk to.
  const lead = leads.find((l) => l.agentId === shown);
  const agent = shown ? agents[shown] : undefined;
  useEffect(() => {
    if (openId && !leads.some((l) => l.agentId === openId)) closeLeadChat();
  }, [openId, leads]);
  // Closed is unmounted: the slid-down pet and box take no layout.
  const phase = talkPhase(openId, shown, up);
  if (phase === "closed" || !lead || !agent) return null;
  return <Dialogue key={lead.agentId} lead={lead} agent={agent} up={phase === "open"} />;
}

function Dialogue({ lead, agent, up }: { lead: LeadEntry; agent: Agent; up: boolean }) {
  const t = useTranscript(agent);
  const reply = useMemo(() => lastReply(t?.entries), [t?.entries]);
  const queue = useAppState().queue[agent.id];
  const say = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useBoxSize(say);
  const reduced = useMemo(reducedMotion, []);

  // What you sent, shown as said until the lead's next reply lands.
  const [sent, setSent] = useState<{ text: string; after: number } | null>(null);
  const answered = sent && reply && reply.n > sent.after;
  useEffect(() => {
    if (answered) setSent(null);
  }, [answered]);

  const all = useMemo(() => (reply ? pages(reply.text, box) : []), [reply, box]);
  const [page, setPage] = useState(0);
  const [typed, setTyped] = useState(0);
  const text = sent ? "" : (all[page] ?? (reply ? "" : "Nothing said yet."));
  const typing = typed < text.length;

  // The dialog's reply feeds the pet's call, and opening it (or a new reply
  // landing while it's open) is seeing it.
  useEffect(() => {
    if (t) noteReply(agent.id, reply);
  }, [t, reply, agent.id]);
  useEffect(() => {
    if (up) markLeadSeen(getState().agents[agent.id] ?? agent, reply?.n ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [up, reply?.n]);

  // A new reply (or the box resized into other pages) starts again from
  // its first page, typed out.
  useEffect(() => {
    setPage(0);
    setTyped(0);
  }, [reply?.n, all.length]);
  useEffect(() => setTyped(reduced ? Infinity : 0), [page, text, reduced]);
  useEffect(() => {
    if (!up || !typing) return;
    const id = window.setInterval(() => setTyped((n) => n + TYPE_STEP), TYPE_MS);
    return () => clearInterval(id);
  }, [up, typing]);

  const advance = () => {
    if (typing) setTyped(Infinity);
    // Two quick presses before a render turn one page each, never past the last.
    else if (page < all.length - 1) setPage((p) => Math.min(p + 1, all.length - 1));
  };

  // Esc closes; Space skips or turns the page, unless you're typing a reply.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!up) return;
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        closeLeadChat();
      } else if (e.key === " " && document.activeElement !== input.current && !isEditable(document.activeElement)) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!up) return;
    const f = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 350);
    return () => clearTimeout(f);
  }, [up]);

  const working = !!sent || agent.status === "running" || (queue?.length ?? 0) > 0;
  const frame = useBlink(up && !reduced, working ? "lookUp" : "sit");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const words = input.current?.value.trim() ?? "";
    if (!words) return;
    input.current!.value = "";
    setSent({ text: words, after: reply?.n ?? -1 });
    try {
      const how = await enqueue(agent, words, { stay: true, turnEndedAt: t?.turnEndedAt });
      if (how === "queued") flash(`${lead.title} is busy; it gets your reply when its turn ends.`);
    } catch (err) {
      setSent(null);
      input.current!.value = words;
      flash(`Couldn't send it: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openRead = () => {
    const s = getState();
    setPaneMode("read");
    setState({
      view: "sessions",
      selectedProject: projectOfWorktree(s, agent.worktree_id)?.id ?? s.selectedProject,
      selectedSession: { Agent: agent.id },
    });
    closeLeadChat();
  };

  const more = !sent && !typing && page < all.length - 1;
  const standIn = !!reply && hasStandIn(reply.text);
  return (
    <div className={`talk${up ? " is-open" : ""}`}>
      <div className={`talk-pet${typing && up ? " is-speaking" : ""}`} aria-hidden>
        <PetSprite kind={lead.pet.kind} coat={lead.pet.coat} frame={frame} width={216} />
      </div>
      <div className="talk-box" role="dialog" aria-modal="false" aria-labelledby="talk-plate">
        <div className="talk-plate" id="talk-plate">
          {lead.title}
          {lead.model && <small>{lead.model}</small>}
        </div>
        <button type="button" className="talk-close" onClick={closeLeadChat} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
        <div className="talk-say" ref={say} onClick={advance} aria-live="polite">
          {sent ? (
            <>
              <span className="talk-you">“{sent.text}”</span>
              {"\n…"}
            </>
          ) : typing ? (
            text.slice(0, typed)
          ) : (
            <Said text={text} />
          )}
        </div>
        {more && (
          <span className="talk-more" aria-hidden>
            ▼
          </span>
        )}
        <form className="talk-foot" onSubmit={(e) => void submit(e)} autoComplete="off">
          <span className="talk-page">{all.length > 1 && !sent ? `${page + 1} of ${all.length}` : ""}</span>
          <input ref={input} placeholder="Say something to the lead…" aria-label={`Reply to the ${lead.title}`} spellCheck={false} />
          <button
            type="button"
            className={`talk-btn is-quiet${standIn ? " is-hint" : ""}`}
            onClick={openRead}
            title={standIn ? "This reply has code, a table or a long list the box leaves out" : "Read the whole thread"}
          >
            Open in Read view
          </button>
          <button type="submit" className="talk-btn">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

/** A page, with any ASK_USER: marked. */
function Said({ text }: { text: string }) {
  const parts = text.split(ASK_USER);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <mark className="talk-ask">{ASK_USER}</mark>}
          {p}
        </span>
      ))}
    </>
  );
}

/** Somewhere Space means something of its own: typing, or pressing a button. */
const isEditable = (el: Element | null) =>
  !!el &&
  (el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLButtonElement ||
    el instanceof HTMLSelectElement ||
    (el as HTMLElement).isContentEditable);

/** The pet's frame: `base`, with a blink now and then. */
function useBlink(on: boolean, base: FrameName): FrameName {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!on) return;
    let t: number;
    const next = () => {
      t = window.setTimeout(() => {
        setBlink(true);
        t = window.setTimeout(() => {
          setBlink(false);
          next();
        }, 140);
      }, 1800 + Math.random() * 2200);
    };
    next();
    return () => {
      clearTimeout(t);
      setBlink(false);
    };
  }, [on]);
  return blink && base === "sit" ? "blink" : base;
}

/** How many characters fit on a line of the text box, and how many lines. */
function useBoxSize(ref: React.RefObject<HTMLElement | null>): BoxSize {
  const [size, setSize] = useState<BoxSize>({ cols: 60, rows: ROWS });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return;
      ctx.font = `${style.fontSize} ${style.fontFamily}`;
      const sample = "the quick brown fox jumps over a lazy dog, PR #61 and 42 tests";
      const per = ctx.measureText(sample).width / sample.length || 10;
      // A character's slack, so the browser's own wrap doesn't run a page
      // onto a fourth line.
      const cols = Math.max(12, Math.floor(el.clientWidth / per) - 2);
      setSize((s) => (s.cols === cols ? s : { cols, rows: ROWS }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
