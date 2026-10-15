import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { isPreview } from "../nebula/client";
import { flash, getState } from "../nebula/store";
import { enqueue, isIdle } from "../nebula/queue";
import { merge, stepsLine, type Entry, type Transcript } from "../nebula/transcript";
import type { Agent } from "../nebula/types";
import type { Choice, Question } from "../nebula/screen";
import { AskChoices } from "./AskStrip";

/** The thread's conversation, read again as it moves. */
function useTranscript(agent: Agent): { entries: Entry[]; dropped: number } | null {
  const [got, setGot] = useState<{ entries: Entry[]; dropped: number } | null>(null);
  const last = useRef<number | null>(null);
  const session = agent.session_id;
  const running = agent.status === "running";
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
          const entries = from === null || !prev ? t.entries : merge(prev.entries, t.entries, t.dropped);
          last.current = entries.length ? entries[entries.length - 1].n : null;
          return { entries, dropped: t.dropped };
        });
      } catch {
        // No log to read: the reader says so.
      }
    };
    void read();
    const timer = running ? window.setInterval(read, 2500) : undefined;
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [session, agent.id, running, agent.status, agent.status_changed_at]);
  return got;
}

function Reply({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return (
    <div
      className="md-doc rd-md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const href = (e.target as HTMLElement).closest("a")?.getAttribute("href");
        if (!href) return;
        e.preventDefault();
        if (/^https?:/i.test(href)) void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch(() => {});
      }}
    />
  );
}

function Steps({ entry, root }: { entry: Entry; root: string }) {
  const rel = (t: string) => (root && t.startsWith(`${root}/`) ? t.slice(root.length + 1) : t);
  const failed = entry.steps.some((s) => s.ok === false);
  return (
    <details className={`rd-steps${failed ? " has-failed" : ""}`}>
      <summary>{stepsLine(entry.steps)}</summary>
      <ul>
        {entry.steps.map((s, i) => (
          <li key={i}>
            <span className={`ts-mark ${s.ok === null ? "is-pending" : s.ok ? "is-ok" : "is-bad"}`} aria-hidden>
              {s.ok === null ? "…" : s.ok ? "✓" : "✕"}
            </span>
            <span className="rd-tool">{s.tool.replace(/^mcp__[^_]+__/, "")}</span>
            <code title={s.target}>{rel(s.target)}</code>
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
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [draft, setDraft] = useState("");
  const waiting = agent.status === "needs_feedback";

  // Stay at the bottom while new entries come in, unless you scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [t?.entries]);

  const send = async () => {
    const text = draft.trim();
    if (!text || waiting) return;
    setDraft("");
    stick.current = true;
    if ((await enqueue(agent, text)) === "queued") flash(`Queued for ${agent.name}: sent when its turn ends`);
  };

  return (
    <div className="reader">
      <div
        className="rd-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
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
              {t.entries.map((e) =>
                e.kind === "you" ? (
                  <div key={e.n} className="rd-you">
                    {e.text}
                  </div>
                ) : e.kind === "claude" ? (
                  <Reply key={e.n} text={e.text} />
                ) : e.kind === "steps" ? (
                  <Steps key={e.n} entry={e} root={root.replace(/\/+$/, "")} />
                ) : (
                  <p key={e.n} className="rd-note">
                    Stopped by you
                  </p>
                ),
              )}
              {agent.status === "running" && <p className="rd-note rd-working">Working…</p>}
            </>
          )}
        </div>
      </div>
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
            <textarea
              rows={2}
              value={draft}
              placeholder={isIdle(agent) ? `Reply to ${agent.name}` : `Queue a reply for when ${agent.name} is done`}
              aria-label="Reply"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn btn-primary" disabled={!draft.trim()} onClick={() => void send()} title="Send (⌘↵)">
              {isIdle(agent) ? "Send" : "Queue"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
