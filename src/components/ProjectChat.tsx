import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useCards } from "../nebula/cards";
import { dollars, costBySession } from "../nebula/budgetHold";
import { markLeadSeen, noteReply, openLeadChat, openLeadTerminal, useChatLead, useLeadCalls, useLeadReply } from "../nebula/leadCalls";
import { lastReply, QUIET, type FaceFrame, type LeadEntry } from "../nebula/leadChat";
import { outcomesOf, useLeadActs, type AskAction } from "../nebula/leadActions";
import { answerLeadAsk, levelFlash, setLeadLevel, startedTasks } from "../nebula/leadRunner";
import { levelOf } from "../nebula/leadLevel";
import { chatItems, chatPreview, leadActivity, liveReply, runStarts, sinceToday, splitAsks, taskStep, type ChatItem, type ChatTask } from "../nebula/projectChat";
import { enqueue } from "../nebula/queue";
import { answer, findQuestion, readScreen, type Choice, type Question } from "../nebula/screen";
import { useLanded } from "../nebula/prwatch";
import { answersSaid, answerText, readCard } from "../nebula/replycard";
import { flash, getState, setState, useAppState } from "../nebula/store";
import { sessionKey } from "../nebula/usageData";
import type { Entry } from "../nebula/transcript";
import type { Agent } from "../nebula/types";
import { avatarStatusLabel, LeadAvatar, tintVars, type AvatarStatus } from "./LeadAvatar";
import { Md, Reply, useReveal, useTranscript, Where } from "./Reader";
import { LeadVoiceFields, LevelPicker } from "./LeadCard";

// Chat with a project (S29): the project's lead is a pet, and the face of
// the project. Its thread shows here as a chat, not in the Read view or the
// terminal: your messages on the right, its replies on the left in its
// colour, its round face (S30) beside the first of each run, the app's [observatory] lines as small event lines, and
// under a reply the tasks it started, live, and its asks with Yes and No.
// A reply is set as the Read view sets one (a card with decisions to tap,
// Needs you and its verdict, or prose), so the lead is answered the same way.

const STEPS = ["Queued", "Running", "PR", "Merged"] as const;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The tint a lead's row and chat are drawn in, as the `--t` they read. */
const tintStyle = (lead: LeadEntry) => tintVars(lead.pet);

/** A lead's chat row: at the top of its project's threads, or "All
 *  projects" at the top of the projects list for the top lead. */
export function ChatRow({ lead }: { lead: LeadEntry }) {
  const reply = useLeadReply(lead.agentId);
  const mine = useMemo(() => [lead], [lead]);
  const call = useLeadCalls(mine)[lead.agentId] ?? QUIET;
  const on = useChatLead()?.agentId === lead.agentId;
  // Stuck on a prompt only its terminal can answer.
  const prompt = useAppState().agents[lead.agentId]?.status === "needs_feedback";
  const top = lead.projectId === null;
  const name = top ? lead.name : `Chat with ${lead.name}`;
  const why = prompt ? "Waiting on a prompt in its terminal" : call.why === "ask" ? `${call.count === 1 ? "A question" : `${call.count} questions`} for you` : call.why === "unread" ? "An unread reply" : null;
  return (
    <button
      type="button"
      className={`chat-row${top ? " is-top" : ""}${call.calling || prompt ? " is-calling" : ""}${on ? " is-on" : ""}`}
      style={tintStyle(lead)}
      onClick={() => openLeadChat(lead.agentId)}
      aria-current={on ? "page" : undefined}
      title={`${name}: ${top ? "the top lead, over every project" : `${lead.name}'s lead`}${lead.model ? ` (${lead.model})` : ""}.${why ? ` ${why}.` : ""}`}
    >
      <LeadAvatar pet={lead.pet} size={32} className="chat-row-pet" />
      <span className="chat-row-txt">
        <span className="chat-row-name">{name}</span>
        <span className="chat-row-sub">{chatPreview(reply?.text) || (top ? "Ask about any project" : `Ask ${lead.name}, or give it a task`)}</span>
      </span>
      {prompt ? (
        <span className="chat-badge is-prompt" aria-label={why ?? undefined}>
          !
        </span>
      ) : (
        call.calling && (
          <span className="chat-badge" aria-label={why ?? undefined}>
            {call.count}
          </span>
        )
      )}
    </button>
  );
}

/** A project's lead as its face (S30) in the project's header, with a dot when it has
 *  something for you (a new reply, an open ask, or a prompt only its
 *  terminal can answer). A click opens its chat, as ⌘L does. */
export function LeadPetButton({ lead }: { lead: LeadEntry }) {
  const mine = useMemo(() => [lead], [lead]);
  const call = useLeadCalls(mine)[lead.agentId] ?? QUIET;
  const on = useChatLead()?.agentId === lead.agentId;
  const prompt = useAppState().agents[lead.agentId]?.status === "needs_feedback";
  const why = prompt ? "Waiting on a prompt in its terminal" : call.why === "ask" ? `${call.count === 1 ? "A question" : `${call.count} questions`} for you` : call.why === "unread" ? "An unread reply" : null;
  const label = `Chat with ${lead.name}${why ? `: ${why.toLowerCase()}` : ""}`;
  return (
    <button
      type="button"
      className={`lead-pet-btn${call.calling || prompt ? " is-calling" : ""}${on ? " is-on" : ""}`}
      style={tintStyle(lead)}
      onClick={() => openLeadChat(lead.agentId)}
      aria-label={label}
      aria-pressed={on}
      title={`${label} (⌘L)${lead.model ? `\nThe project's lead, on ${lead.model}.` : ""}`}
    >
      <LeadAvatar pet={lead.pet} size={26} />
      {(call.calling || prompt) && <span className={`lead-pet-dot${prompt ? " is-prompt" : ""}`} aria-hidden />}
    </button>
  );
}

/** The chat, in place of the terminal column's thread. */
export function ProjectChat({ lead }: { lead: LeadEntry }) {
  const state = useAppState();
  const agent = state.agents[lead.agentId];
  if (!agent) return null;
  return <Chat key={agent.id} lead={lead} agent={agent} />;
}

function Chat({ lead, agent }: { lead: LeadEntry; agent: Agent }) {
  const state = useAppState();
  const card = useCards()[lead.projectId ?? ""]?.lead;
  const acts = useLeadActs();
  const t = useTranscript(agent);
  const entries = t?.entries;
  const reply = useMemo(() => lastReply(entries), [entries]);
  const wt = state.worktrees[agent.worktree_id];
  const reduced = useMemo(reducedMotion, []);

  // Opening the chat (or a reply landing while it's open) is seeing it.
  useEffect(() => {
    if (t) noteReply(agent.id, reply);
  }, [t, reply, agent.id]);
  useEffect(() => {
    if (reply) markLeadSeen(getState().agents[agent.id] ?? agent, reply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply?.n, reply?.at, agent.id]);

  // What you sent, shown at once, until the log has it.
  const [sent, setSent] = useState<{ text: string; after: number }[]>([]);
  const lastN = entries?.length ? entries[entries.length - 1].n : -1;
  useEffect(() => {
    if (!entries) return;
    setSent((s) => s.filter((m) => !entries.some((e) => e.kind === "you" && e.n > m.after && e.text.trim() === m.text)));
  }, [entries]);

  const tasks = useMemo((): ChatTask[] => {
    if (lead.projectId === null) return [];
    return startedTasks(lead.projectId, state).map(({ rec, agent: a, label }) => {
      const p = a ? state.prs[a.worktree_id] : undefined;
      const open = p?.kind === "found" && (p.pr.state === "open" || p.pr.state === "draft") ? p.pr : null;
      return {
        taskId: rec.taskId,
        branch: rec.branch,
        at: rec.at,
        n: rec.n,
        replyAt: rec.replyAt,
        label,
        checks: open ? { state: open.checks, failing: open.failing } : null,
        agentId: a && !a.archived ? a.id : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.projectId, state.agents, state.prs, state.worktrees, acts]);

  const items = useMemo(
    () =>
      chatItems(entries ?? [], {
        leadId: agent.id,
        tasks,
        outcomes: lead.acts ? outcomesOf(agent.id, acts) : [],
        answered: (key) => acts.answered.includes(key),
        name: (id) => state.agents[id]?.name,
        settled: (a) => settledWhy(a, lead.projectId, state),
      }),
    [entries, tasks, acts, lead.acts, lead.projectId, agent.id, state],
  );

  // What was said when the chat opened sits still; replies after it fade in.
  const known = useRef<Set<string> | null>(null);
  if (t && !known.current) known.current = new Set(items.map((it) => it.key));
  const fresh = (key: string) => !!known.current && !known.current.has(key);

  // The latest reply while nothing you said follows it: its decisions take
  // taps, sent with whatever you type.
  const latest = useMemo(() => {
    let n = -1;
    for (const it of items) n = it.kind === "pet" ? it.n : it.kind === "me" ? -1 : n;
    return n;
  }, [items]);
  // The reply whose decisions take taps; a later update without any leaves
  // them live.
  const live = useMemo(() => liveReply(items, (text) => readCard(text).asks.length > 0), [items]);
  const [tapped, setTapped] = useState<{ entry: number; picks: Record<number, string>; sent: boolean }>({ entry: -1, picks: {}, sent: false });
  const picks = tapped.entry === live ? tapped.picks : {};
  const pick = (n: number, letter: string) => setTapped({ entry: live, picks: { ...picks, [n]: picks[n] === letter ? "" : letter }, sent: false });
  // What you answered each earlier reply with, read from your next message.
  const answered = useMemo(() => {
    const out: Record<number, Record<number, string>> = {};
    let asked = -1;
    for (const it of items) {
      if (it.kind === "pet") asked = readCard(it.text).asks.length ? it.n : asked;
      else if (it.kind === "me" && asked >= 0) {
        out[asked] = answersSaid(it.text);
        asked = -1;
      }
    }
    return out;
  }, [items]);
  const latestText = useMemo(() => {
    const it = items.find((x) => x.kind === "pet" && x.n === latest);
    return it?.kind === "pet" ? it.text : undefined;
  }, [items, latest]);
  const latestVerdict = useMemo(() => (latestText ? readCard(latestText).verdict : null), [latestText]);
  const landed = useLanded(wt?.path, latestVerdict);
  const latestThread = useMemo(() => (entries && latest >= 0 ? { n: latest, entries } : undefined), [entries, latest]);
  const liveThread = useMemo(() => (entries && live >= 0 ? { n: live, entries } : undefined), [entries, live]);
  const prompted = agent.status === "needs_feedback";
  const replyOf = (n: number): ReplyBits => {
    const own = n === latest ? { landed, thread: latestThread } : {};
    if (n !== live) return { live: false, sent: true, picks: answered[n] ?? {}, onPick: pick, ...own };
    const gone = tapped.entry === live && tapped.sent;
    return { live: !gone && !prompted, sent: gone, picks, onPick: pick, ...own, thread: liveThread };
  };
  // A PR named as "#75" links to it, in the project's repo.
  const prUrl = useMemo(() => {
    if (lead.projectId === null) return null;
    const pr = Object.values(state.worktrees)
      .filter((w) => w.project_id === lead.projectId)
      .map((w) => state.prs[w.id])
      .find((p) => p?.kind === "found");
    return pr?.kind === "found" ? pr.pr.url : null;
  }, [lead.projectId, state.worktrees, state.prs]);

  // A lead that hasn't said anything yet may be stuck before its first turn,
  // on a question its hooks can't report: whether to trust a new folder.
  const screenAsk = useScreenAsk(agent, agent.status === "running" && !items.some((it) => it.kind === "pet"));
  const [answering, setAnswering] = useState(false);
  const pickOnScreen = async (q: Question, c: Choice) => {
    setAnswering(true);
    try {
      await answer(agent, q, c);
      flash(`Answered ${lead.title}: ${c.label}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => setAnswering(false), 800);
    }
  };

  const queued = state.queue[agent.id]?.length ?? 0;
  const activity = leadActivity({ status: agent.status, queued, sending: sent.length, onScreen: !!screenAsk });
  const working = activity === "working";

  // Kept at the bottom as things land, unless you've scrolled up to read.
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = log.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items.length, sent.length, working, t]);

  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), [agent.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = input.current?.value.trim() ?? "";
    const words = answerText(picks, typed);
    if (!words) return;
    input.current!.value = "";
    const was = tapped;
    if (Object.values(picks).some(Boolean)) setTapped({ entry: live, picks, sent: true });
    pinned.current = true;
    const mine = { text: words, after: lastN };
    setSent((s) => [...s, mine]);
    setAnsweringQ(null);
    try {
      const how = await enqueue(getState().agents[agent.id] ?? agent, words, { stay: true, turnEndedAt: t?.turnEndedAt });
      if (how === "queued") flash(`${lead.title} is busy; it gets your message when its turn ends.`);
    } catch (err) {
      setSent((s) => s.filter((m) => m !== mine));
      setTapped(was);
      input.current!.value = typed;
      flash(`Couldn't send it: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const costs = useMemo(() => costBySession(sinceToday(state.usage)), [state.usage]);
  const cost = agent.session_id ? (costs.get(sessionKey(agent.kind, agent.session_id)) ?? 0) : 0;
  const frame = useBlink(!reduced);
  const top = lead.projectId === null;
  const days = dayLabels(items);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const starts = useMemo(() => runStarts(items), [items]);
  const lastIsPet = items.length > 0 && items[items.length - 1].kind === "pet" && !sent.length;
  // A question the lead passed on to you in its latest reply, unanswered.
  const openAsk = latestText !== undefined && !sent.length && splitAsks(latestText).asks.length > 0;
  const status: AvatarStatus = activity === "prompt" || openAsk || items.some((it) => it.kind === "ask" && !it.done) ? "calling" : working ? "working" : "idle";
  // Answer on a lead's question: the box says what you're answering.
  const [answeringQ, setAnsweringQ] = useState<string | null>(null);
  const answerAsk = (q: string) => {
    setAnsweringQ(q);
    input.current?.focus();
  };

  return (
    <section className="chat" style={tintStyle(lead)} aria-label={top ? "Chat with every project's top lead" : `Chat with ${lead.name}`}>
      <header className="chat-head" data-tauri-drag-region>
        <LeadAvatar pet={lead.pet} size={52} frame={frame} status={status} className="chat-head-pet" />
        <div className="chat-head-text" data-tauri-drag-region>
          <h1>
            {lead.name}
            <span className="sr-only">, {avatarStatusLabel(status).toLowerCase()}</span>
          </h1>
          <p className="chat-meta">
            <b>{top ? "Top lead" : "Lead"}</b>
            {lead.model ? ` · ${lead.model}` : ""} · {dollars(cost)} today
            {" · "}
            <button type="button" className="link-btn chat-raw" onClick={() => openLeadTerminal(agent.id)} title="The lead's raw session, as a thread's terminal">
              Open terminal
            </button>
            {!top && card && (
              <>
                {" · "}
                <button
                  type="button"
                  className="link-btn chat-raw"
                  aria-expanded={voiceOpen}
                  onClick={() => setVoiceOpen((o) => !o)}
                  title="How the lead talks, and your instructions to it"
                >
                  Personality{card.personality ? `: ${card.personality.length > 40 ? `${card.personality.slice(0, 39)}…` : card.personality}` : ""}
                </button>
              </>
            )}
          </p>
        </div>
        {!top && card && lead.projectId && (
          <label className="chat-acts" htmlFor={`chat-level-${lead.projectId}`}>
            Level
            <LevelPicker
              id={`chat-level-${lead.projectId}`}
              compact
              level={levelOf(card)}
              onPick={(level) => {
                setLeadLevel(lead.projectId!, card, level);
                flash(levelFlash(lead.name, level));
              }}
            />
          </label>
        )}
        {voiceOpen && !top && card && lead.projectId && (
          <div className="chat-voice" role="dialog" aria-label={`${lead.name}'s personality and instructions`} onKeyDown={(e) => e.key === "Escape" && setVoiceOpen(false)}>
            <LeadVoiceFields projectId={lead.projectId} projectName={lead.name} lead={card} />
            <button type="button" className="link-btn chat-voice-done" onClick={() => setVoiceOpen(false)}>
              Done
            </button>
          </div>
        )}
      </header>
      <div
        className="chat-log"
        ref={log}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <Where.Provider value={{ from: agent.id, root: wt?.path ?? "", prUrl, turnEndedAt: t?.turnEndedAt ?? null, run: false }}>
          {!t && !screenAsk && <p className="chat-empty">Reading the lead's thread…</p>}
          {t && !screenAsk && !items.length && !sent.length && <p className="chat-empty">Nothing said yet. Say hello, or give it a task.</p>}
          {items.map((it) => (
            <ChatLine
              key={it.key}
              item={it}
              lead={lead}
              day={days.get(it.key)}
              first={starts.has(it.key)}
              fresh={fresh(it.key)}
              reply={it.kind === "pet" ? replyOf(it.n) : undefined}
              onAnswer={it.kind === "pet" && it.n === latest && !sent.length ? answerAsk : undefined}
            />
          ))}
          {sent.map((m, i) => (
            <div key={`sent${i}`} className="chat-say is-me is-sending">
              <div className="chat-bubble">{m.text}</div>
            </div>
          ))}
          {screenAsk && (
            <div className="chat-prompt is-asking" role="group" aria-label={`Answer ${lead.title}`}>
              <span>{lead.title} is waiting on this in its terminal before it starts:</span>
              {screenAsk.prompt && <p className="qa-prompt">{screenAsk.prompt}</p>}
              <div className="qa-choices">
                {screenAsk.choices.map((c) => (
                  <button key={c.key} type="button" className={`qa-choice${c.selected ? " is-current" : ""}`} disabled={answering} onClick={() => void pickOnScreen(screenAsk, c)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <button type="button" className="link-btn" onClick={() => openLeadTerminal(agent.id)}>
                Open terminal
              </button>
            </div>
          )}
          {activity === "prompt" && !screenAsk && (
            <div className="chat-prompt" role="status">
              <span>{lead.title} is waiting on a prompt in its terminal.</span>
              <button type="button" className="btn chat-yes" onClick={() => openLeadTerminal(agent.id)}>
                Open terminal
              </button>
            </div>
          )}
          {working && (
            <div className={`chat-say is-pet${lastIsPet ? " is-more" : ""}`}>
              <SayAvatar lead={lead} first={!lastIsPet} />
              <div className="chat-bubble">
                <span className="chat-typing" aria-label={`${lead.title} is working`}>
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </div>
          )}
        </Where.Provider>
      </div>
      <form className="chat-compose" onSubmit={(e) => void submit(e)} autoComplete="off">
        <input
          ref={input}
          placeholder={
            answeringQ && openAsk
              ? `Your answer: ${answeringQ}`
              : !tapped.sent && Object.values(picks).some(Boolean)
              ? "Add a note to your answers, or just Send"
              : top
                ? "Ask about any project, or hand one some work"
                : `Ask ${lead.name}, or give it a task`
          }
          aria-label={`Message ${lead.title}`}
          spellCheck
        />
        <button type="submit" className="btn chat-send">
          {agent.status === "running" ? "Queue" : "Send"}
        </button>
      </form>
    </section>
  );
}

/** What a lead's reply needs to answer its decisions: whether it still takes
 *  taps, what's picked, and for the latest, its thread and landed PRs. */
type ReplyBits = {
  live: boolean;
  sent: boolean;
  picks: Record<number, string>;
  onPick: (n: number, letter: string) => void;
  landed?: string | null;
  thread?: { n: number; entries: Entry[] };
};

/** The lead's face beside the first reply of a run; the space it takes
 *  beside the rest, so their bubbles line up. */
function SayAvatar({ lead, first }: { lead: LeadEntry; first: boolean }) {
  return first ? <LeadAvatar pet={lead.pet} size={30} className="chat-say-pet" /> : <span className="chat-say-pet is-gap" aria-hidden />;
}

function ChatLine({
  item,
  lead,
  day,
  first,
  fresh,
  reply,
  onAnswer,
}: {
  item: ChatItem;
  lead: LeadEntry;
  day: string | undefined;
  first: boolean;
  /** It landed while the chat was open: its words fade in. */
  fresh: boolean;
  reply?: ReplyBits;
  /** Its questions for you are still open: answering one focuses the box. */
  onAnswer?: (question: string) => void;
}) {
  const said = useRef<HTMLDivElement>(null);
  useReveal(said, fresh && item.kind === "pet");
  const line = (() => {
    switch (item.kind) {
      case "me":
        return (
          <div className="chat-say is-me">
            <div className="chat-bubble">{item.text}</div>
          </div>
        );
      case "pet": {
        const { body, asks } = splitAsks(item.text);
        return (
          <div className="chat-said" ref={said}>
            {body && (
              <div className={`chat-say is-pet${first ? "" : " is-more"}`}>
                <SayAvatar lead={lead} first={first} />
                {reply && <Reply text={body} from={lead.agentId} prose="chat-bubble chat-md" {...reply} />}
              </div>
            )}
            {asks.map((q, i) => (
              <div key={i} className={`chat-say is-pet${!body && !i && first ? "" : " is-more"}`}>
                <SayAvatar lead={lead} first={!body && !i && first} />
                <div className={`chat-bubble chat-question${onAnswer ? " is-open" : ""}`}>
                  <span className="chat-question-label">{onAnswer ? "Asks you" : "Asked you"}</span>
                  <Md text={q} className="chat-md" />
                  {onAnswer && (
                    <button type="button" className="btn btn-sm chat-question-answer" onClick={() => onAnswer(q)}>
                      Answer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      }
      case "event":
        return <EventLine text={item.text} thread={item.thread} />;
      case "task":
        return <TaskCard task={item.task} />;
      case "ask":
        return <AskRow lead={lead} n={item.n} at={item.at} ask={item.ask} done={item.done} />;
    }
  })();
  return (
    <>
      {day && <div className="chat-day">{day}</div>}
      {line}
    </>
  );
}

/** Open a thread the lead talks about; the lead's face above the threads
 *  comes back to the chat. */
function openThread(agentId: string) {
  setState((s) => {
    const a = s.agents[agentId];
    return a ? { selectedProject: s.worktrees[a.worktree_id]?.project_id ?? s.selectedProject, selectedSession: { Agent: a.id } } : {};
  });
}

/** An [observatory] line; one about a thread that's still around opens it. */
function EventLine({ text, thread }: { text: string; thread?: string }) {
  const agent = useAppState().agents[thread ?? ""];
  if (!agent || agent.archived) return <div className="chat-event">{text}</div>;
  return (
    <button type="button" className="chat-event is-link" onClick={() => openThread(agent.id)} title={`Open ${agent.name}`}>
      {text}
    </button>
  );
}

/** A task the lead started, on the four steps: Queued, Running, PR, Merged. */
function TaskCard({ task }: { task: ChatTask }) {
  const { step, text, tone } = taskStep(task);
  return (
    <div className={`chat-task is-${tone}`}>
      <div className="chat-task-line">
        Started <code>{task.branch}</code>
        <span className="chat-task-state">{text}</span>
        {task.agentId && (
          <button type="button" className="link-btn chat-task-open" onClick={() => openThread(task.agentId!)} title="Open its thread">
            Open
          </button>
        )}
      </div>
      <div className="chat-steps" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s} className={i <= step ? "is-on" : ""} />
        ))}
      </div>
      <div className="chat-step-labels" aria-hidden>
        {STEPS.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </div>
  );
}

/** An ASK line (S28) as a row: Yes merges or archives, No dismisses it,
 *  and the lead hears which. */
function AskRow({ lead, n, at, ask, done }: { lead: LeadEntry; n: number; at: number; ask: AskAction; done: string | null }) {
  const { agents } = useAppState();
  const [busy, setBusy] = useState(false);
  const thread = ask.what === "archive" ? (agents[ask.agentId]?.name ?? ask.agentId) : "";
  const what = ask.what === "merge" ? `Merge #${ask.pr}?` : `Archive ${thread}?`;
  const answer = (yes: boolean) => {
    setBusy(true);
    answerLeadAsk(lead.agentId, n, ask, yes, at)
      .then((line) => line && yes && flash(ask.what === "merge" ? `Merged #${ask.pr}` : `Archived ${thread}`))
      .catch((e) => flash(`Couldn't ${ask.what}: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className={`chat-ask${done ? " is-answered" : ""}`}>
      <div className="chat-ask-q">
        {what}
        <small>{done ?? ask.why}</small>
      </div>
      {!done && (
        <>
          <button type="button" className="btn chat-yes" disabled={busy} onClick={() => answer(true)}>
            Yes, {ask.what}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => answer(false)}>
            No
          </button>
        </>
      )}
    </div>
  );
}

/** Why an ask can't be answered any more, from what's happened since: its
 *  PR merged or closed, or its thread archived or gone. */
function settledWhy(a: AskAction, projectId: string | null, s: ReturnType<typeof getState>): string | null {
  if (a.what === "archive") {
    const t = s.agents[a.agentId];
    return !t ? "That thread is gone" : t.archived ? "Archived" : null;
  }
  for (const w of Object.values(s.worktrees)) {
    const p = w.project_id === projectId ? s.prs[w.id] : undefined;
    if (p?.kind === "found" && p.pr.number === a.pr && (p.pr.state === "merged" || p.pr.state === "closed")) return `#${a.pr} is ${p.pr.state}`;
  }
  return null;
}

/** A "Today" / "Yesterday" / date line before the first item of each day. */
function dayLabels(items: ChatItem[], now = new Date()): Map<string, string> {
  const out = new Map<string, string>();
  const dayOf = (sec: number) => new Date(sec * 1000).toDateString();
  const today = now.toDateString();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString();
  let last: string | null = null;
  for (const it of items) {
    if (!("at" in it)) continue;
    const d = dayOf(it.at);
    if (d === last) continue;
    last = d;
    out.set(it.key, d === today ? "Today" : d === yesterday ? "Yesterday" : new Date(it.at * 1000).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }));
  }
  return out;
}

/** The face's frame: sitting, with a blink now and then. */
function useBlink(on: boolean): FaceFrame {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!on) return;
    let t: number;
    const next = () => {
      t = window.setTimeout(
        () => {
          setBlink(true);
          t = window.setTimeout(() => {
            setBlink(false);
            next();
          }, 150);
        },
        2600 + Math.random() * 2400,
      );
    };
    next();
    return () => {
      clearTimeout(t);
      setBlink(false);
    };
  }, [on]);
  return blink ? "blink" : "sit";
}

const SCREEN_MS = 2_000;

/** The question on the lead's screen while `on`, read every couple of
 *  seconds; null when there's none. */
function useScreenAsk(agent: Agent, on: boolean): Question | null {
  const [q, setQ] = useState<Question | null>(null);
  useEffect(() => {
    if (!on || !agent.alive) {
      setQ(null);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    // Each read waits for the last, so a slow daemon can't pile them up.
    const read = async () => {
      if (!document.hidden) {
        const lines = await readScreen(agent).catch(() => null);
        if (!live) return;
        setQ(lines ? findQuestion(lines) : null);
      }
      timer = setTimeout(read, SCREEN_MS);
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Re-reading on every agent update would restart the poll each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, agent.alive, on]);
  return q;
}
