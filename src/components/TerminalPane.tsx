import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { debugLog, onExit, onPty, request, send, sendInput } from "../nebula/client";
import { flash, getState, projectOfWorktree, setState, useAppState } from "../nebula/store";
import { agentSpec, harnessLabel, statusLabel, usualHarness } from "../nebula/status";
import { sessionKey, type Agent, type SessionRef } from "../nebula/types";
import { enqueue, isIdle, noteTyped, unqueue } from "../nebula/queue";
import { findQuestion, noteSize, type Choice, type Question } from "../nebula/screen";
import { TextDialog, type TextDialogSpec } from "./Dialogs";
import { hasLog, setTurnLineHidden, TurnStrip, useTurnLineHidden } from "./TurnStrip";
import { Reader } from "./Reader";
import { AskStrip } from "./AskStrip";
import { ShelfStrip } from "./Files";
import { addIdea } from "../nebula/ideas";
import { termFont, whenLoaded } from "../nebula/termfont";
import { linkPaths, osc8Links } from "../nebula/termpaths";
import { watchForFiles, type FileWatch } from "../nebula/shelf";
import { afterClosing } from "../nebula/recent";
import { isSliding } from "./Resizer";

const THEME = {
  background: "#0f1524",
  foreground: "#dfe4f0",
  cursor: "#9db4ff",
  cursorAccent: "#0f1524",
  selectionBackground: "#35456f",
  black: "#1b2438",
  red: "#ff7a6b",
  green: "#5fd4b0",
  yellow: "#f2b84b",
  blue: "#7fa2ff",
  magenta: "#c49bff",
  cyan: "#62c7e6",
  white: "#dfe4f0",
  brightBlack: "#5c6682",
  brightRed: "#ff9a8e",
  brightGreen: "#86e3c6",
  brightYellow: "#f7cd7a",
  brightBlue: "#a5bdff",
  brightMagenta: "#d6b8ff",
  brightCyan: "#8ad8ef",
  brightWhite: "#ffffff",
};

/** The terminal on the light surfaces: the same hues, deep enough to read. */
const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1b2233",
  cursor: "#3d5bd9",
  cursorAccent: "#ffffff",
  selectionBackground: "#cdd7f7",
  black: "#1b2233",
  red: "#c23a2b",
  green: "#1f8a67",
  yellow: "#946000",
  blue: "#2f55c9",
  magenta: "#8a44c2",
  cyan: "#10798f",
  white: "#8a93a8",
  brightBlack: "#5c6682",
  brightRed: "#d4442f",
  brightGreen: "#23a079",
  brightYellow: "#a86a00",
  brightBlue: "#3d5bd9",
  brightMagenta: "#9d55d6",
  brightCyan: "#138aa3",
  brightWhite: "#1b2233",
};

export const terminalTheme = (mode: string) =>
  mode === "light" ? LIGHT_THEME : mode === "black" ? { ...THEME, background: "#000000", cursorAccent: "#000000" } : THEME;

export function TerminalPane({ onNewTask }: { onNewTask: () => void }) {
  const state = useAppState();
  const session = state.selectedSession;
  const agent = session && "Agent" in session ? state.agents[session.Agent] : undefined;
  const tab = session && "Terminal" in session ? state.terminals[session.Terminal] : undefined;
  const exists = !!(agent || tab);

  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const current = useRef<SessionRef | null>(null);
  const [ready, setReady] = useState(false);
  const [exited, setExited] = useState<number | null | undefined>(undefined);
  // The numbered menu at the bottom of the screen, if there is one.
  const [menu, setMenu] = useState<Question | null>(null);
  const [dialog, setDialog] = useState<TextDialogSpec | null>(null);
  // The session's checkout: what a relative path in its output is under.
  const cwd = useRef<string | null>(null);
  const refit = useRef<() => void>(() => {});
  const files = useRef<FileWatch | null>(null);
  cwd.current = agent || tab ? (state.worktrees[(agent ?? tab)!.worktree_id]?.path ?? null) : null;

  // Follow the type picked in Settings, or ⌘+/⌘−; the new cell size can
  // change the rows and columns, so the session hears about it.
  const font = termFont(state.prefs);
  useEffect(() => {
    let live = true;
    // A bundled face measured before it loads would be measured as the fallback.
    void whenLoaded(font).then(() => {
      const t = term.current;
      if (!live || !t) return;
      t.options.fontFamily = font.family;
      t.options.fontSize = font.size;
      t.options.lineHeight = font.lineHeight;
      refit.current();
    });
    return () => {
      live = false;
    };
  }, [ready, font.family, font.size, font.lineHeight]);

  // Follow the app's light/dark/black surfaces.
  useEffect(() => {
    if (term.current) term.current.options.theme = terminalTheme(state.mode);
  }, [state.mode]);

  // One xterm for the app's lifetime; sessions swap in and out of it.
  useEffect(() => {
    let disposed = false;
    const font = termFont(getState().prefs);
    const t = new Terminal({
      fontFamily: font.family,
      fontSize: font.size,
      lineHeight: font.lineHeight,
      scrollback: 10_000,
      allowProposedApi: true,
      cursorBlink: true,
      theme: terminalTheme(getState().mode),
      linkHandler: osc8Links,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    const unlink = linkPaths(
      t,
      () => cwd.current,
      () => {
        const ref = current.current;
        return ref && "Agent" in ref ? ref.Agent : null;
      },
    );
    // Files the agent mentions land on its shelf.
    files.current = watchForFiles(
      t,
      () => {
        const ref = current.current;
        return ref && "Agent" in ref ? ref.Agent : null;
      },
      () => cwd.current,
    );
    t.loadAddon(new Unicode11Addon());
    t.unicode.activeVersion = "11";

    // Shift+Enter is a newline in Claude Code and friends: send ESC CR
    // (what their terminal setup maps it to) instead of a bare CR.
    t.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
        if (current.current) void sendInput(current.current, "\x1b\r");
        return false;
      }
      return true;
    });
    t.onData((data) => {
      const ref = current.current;
      if (!ref) return;
      if ("Agent" in ref) noteTyped(ref.Agent);
      void sendInput(ref, data);
    });

    void whenLoaded(font).finally(() => {
      if (disposed || !host.current) return;
      t.open(host.current);
      // WebGL in the app; the browser preview keeps the DOM renderer, which
      // survives page zoom and is readable in devtools.
      if ("__TAURI_INTERNALS__" in window) {
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          t.loadAddon(webgl);
        } catch {
          // The DOM renderer is slower but fine.
        }
      }
      f.fit();
      term.current = t;
      fit.current = f;
      if (import.meta.env.DEV) (window as unknown as { __term: Terminal }).__term = t;
      setReady(true);
    });

    const observer = new ResizeObserver(() => refit.current());
    refit.current = () => {
      if (!term.current || !fit.current || isSliding()) return;
      const { cols, rows } = term.current;
      fit.current.fit();
      const t2 = term.current;
      if (current.current && (t2.cols !== cols || t2.rows !== rows)) {
        void send("Resize", { session: current.current, cols: t2.cols, rows: t2.rows });
        if ("Agent" in current.current) noteSize(current.current.Agent, t2.cols, t2.rows);
      }
    };
    if (host.current) observer.observe(host.current);
    // A column slid open or shut: fit once, now it has stopped moving.
    const onSlid = () => refit.current();
    window.addEventListener("observatory:slid", onSlid);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("observatory:slid", onSlid);
      unlink();
      files.current?.dispose();
      files.current = null;
      t.dispose();
      term.current = null;
    };
  }, []);

  // Attach the selected session; re-attach after a reconnect (epoch).
  const key = session && exists ? sessionKey(session) : null;
  const connected = state.link.state === "connected";
  useEffect(() => {
    const t = term.current;
    if (!ready || !t || !session || !key || !connected) return;
    const ref = session;
    current.current = ref;
    setExited(undefined);
    t.reset();
    fit.current?.fit();

    // `end` is the seq just past the last byte written, so replayed and
    // live output that overlap are written once.
    let end = 0;
    setMenu(null);
    let scan: ReturnType<typeof setTimeout> | undefined;
    const rescan = () => {
      clearTimeout(scan);
      scan = setTimeout(() => {
        const b = t.buffer.active;
        const lines: string[] = [];
        for (let y = b.baseY; y < b.baseY + t.rows; y++) lines.push(b.getLine(y)?.translateToString(true) ?? "");
        const next = findQuestion(lines);
        setMenu((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      }, 120);
    };
    const offPty = onPty(ref, (chunk, bytes) => {
      if (chunk.replay) {
        t.reset();
        t.write(bytes);
        end = chunk.seq + bytes.length;
        files.current?.rescan();
        debugLog(`replay ${key}: ${bytes.length} bytes at ${t.cols}x${t.rows}`);
        t.write("", rescan);
        return;
      }
      const stop = chunk.seq + bytes.length;
      if (stop <= end) return;
      t.write(chunk.seq < end ? bytes.subarray(end - chunk.seq) : bytes, rescan);
      end = stop;
    });
    const offExit = onExit(ref, (code) => setExited(code));

    void send("Attach", { session: ref, from_seq: null, cols: t.cols, rows: t.rows });
    if ("Agent" in ref) noteSize(ref.Agent, t.cols, t.rows);
    if ("Agent" in ref) void send("MarkAgentSeen", { id: ref.Agent });
    t.focus();

    return () => {
      clearTimeout(scan);
      offPty();
      offExit();
      current.current = null;
      void send("Detach", { session: ref }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, connected, state.epoch]);

  // Looking at a session whose turn just finished marks it read.
  useEffect(() => {
    if (agent?.unseen && document.hasFocus()) void send("MarkAgentSeen", { id: agent.id });
  }, [agent?.unseen, agent?.id]);

  const [mode, setMode] = usePaneMode();
  const summaryHidden = useTurnLineHidden();
  const canRead = !!agent && hasLog(agent);
  const reading = canRead && mode === "read";
  const toTerminal = () => {
    setMode("terminal");
    requestAnimationFrame(() => term.current?.focus());
  };

  // Offered only while the session says it's waiting, so a menu left on
  // screen after it moved on isn't.
  const asking = agent?.status === "needs_feedback" ? menu : null;
  // The pick is read off this very screen, so unlike the sidebar's quick
  // answers there's no need to read it again first.
  const answer = (c: Choice) => {
    const ref = current.current;
    if (!ref || !asking) return;
    setMenu(null);
    void sendInput(ref, c.key);
  };

  const project = agent || tab ? projectOfWorktree(state, (agent ?? tab)!.worktree_id) : undefined;
  const wt = agent || tab ? state.worktrees[(agent ?? tab)!.worktree_id] : undefined;

  return (
    <section className="pane" aria-label="Terminal">
      {exists ? (
        <header className="pane-head" data-tauri-drag-region>
          <div className="pane-title" data-tauri-drag-region>
            {agent && <span className={`sdot dot-${agent.status}`} aria-hidden />}
            <RenameableTitle
              key={agent?.id ?? tab?.id}
              name={(agent ?? tab)!.name}
              onRename={(name) =>
                agent
                  ? request("RenameAgent", { id: agent.id, name })
                  : request("RenameTerminal", { id: tab!.id, name })
              }
            />
            <span className="pane-meta">
              {agent && (
                <span className={`pill pill-${agent.status}`} title={agentSpec(agent)}>
                  {statusLabel(agent)}
                </span>
              )}
              {!agent && <span>Shell</span>}
              {agent && harnessLabel(agent) !== usualHarness(Object.values(state.agents)) && <span>{harnessLabel(agent)}</span>}
              {project && (
                <span>
                  {project.name}
                  {wt && !wt.is_main ? ` on ${wt.branch}` : ""}
                </span>
              )}
            </span>
          </div>
          <div className="pane-actions">
            {canRead && summaryHidden && (
              <button className="btn btn-sm btn-rare" onClick={() => setTurnLineHidden(false)} title="Show what the latest turn did, above the terminal">
                Summary
              </button>
            )}
            {canRead && (
              <div className="segmented segmented-sm pane-mode" role="radiogroup" aria-label="Show the thread as">
                <button role="radio" aria-checked={!reading} className={reading ? "" : "is-on"} onClick={toTerminal}>
                  Terminal
                </button>
                <button
                  role="radio"
                  aria-checked={reading}
                  className={reading ? "is-on" : ""}
                  onClick={() => setMode("read")}
                  title="Read the thread as a conversation"
                >
                  Read
                </button>
              </div>
            )}
            {agent && !agent.archived && (
              <>
                <button
                  className="btn"
                  onClick={() => setDialog(queueDialog(agent))}
                  title={isIdle(agent) ? "Send a follow-up prompt" : "Queue a prompt to send when this turn ends"}
                >
                  {isIdle(agent) ? "Follow up" : "Queue next"}
                </button>
                <button className="btn btn-rare" onClick={() => request("RestartAgent", { id: agent.id })}>
                  Restart
                </button>
                <button
                  className="btn btn-rare"
                  onClick={() => {
                    void request("ArchiveAgent", { id: agent.id });
                    setState(afterClosing);
                  }}
                >
                  Archive
                </button>
              </>
            )}
            {agent?.archived && (
              <button className="btn" onClick={() => request("UnarchiveAgent", { id: agent.id })}>
                Restore
              </button>
            )}
            {tab && (
              <button
                className="btn"
                onClick={() => {
                  void request("CloseTerminal", { id: tab.id });
                  setState(afterClosing);
                }}
              >
                Close shell
              </button>
            )}
          </div>
        </header>
      ) : (
        <header className="pane-head" data-tauri-drag-region />
      )}

      {agent && <TurnStrip key={agent.id} agent={agent} worktree={wt} />}
      {asking && !reading && <AskStrip question={asking} onPick={answer} />}
      {agent && <QueueStrip agent={agent} queued={state.queue[agent.id]} />}
      {agent && <ShelfStrip agent={agent} worktree={wt} items={state.shelf[agent.id]} />}
      <div className="pane-body" data-drop-session={key ?? undefined}>
        <div ref={host} className={`xterm-host${exists ? "" : " is-hidden"}`} />
        {reading && agent && <Reader key={agent.id} agent={agent} root={wt?.path ?? ""} onTerminal={toTerminal} question={asking} onPick={answer} />}
        {!exists && (
          <div className="pane-empty">
            <p>Open a session from the list, or start something new.</p>
            <button className="btn btn-primary" onClick={onNewTask}>
              New task
            </button>
          </div>
        )}
        {exists && exited !== undefined && (
          <div className="pane-exit">
            <span>
              {exited === 0 || exited === null
                ? "This session has ended."
                : `This session exited with code ${exited}.`}
            </span>
            {agent && (
              <button className="btn" onClick={() => request("RestartAgent", { id: agent.id })}>
                Resume session
              </button>
            )}
          </div>
        )}
        {exists && !connected && (
          <div className="pane-exit">
            <span>Reconnecting to the daemon…</span>
          </div>
        )}
      </div>
      {dialog && <TextDialog d={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

const MODE_KEY = "observatory.paneMode";

/** Terminal or reader: how threads show, remembered on this Mac. */
function usePaneMode(): ["terminal" | "read", (m: "terminal" | "read") => void] {
  const [mode, setMode] = useState<"terminal" | "read">(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "read" ? "read" : "terminal";
    } catch {
      return "terminal";
    }
  });
  return [
    mode,
    (m) => {
      setMode(m);
      try {
        localStorage.setItem(MODE_KEY, m);
      } catch {
        // Remembering it is a nicety.
      }
    },
  ];
}

function queueDialog(agent: Agent): TextDialogSpec {
  const idle = isIdle(agent);
  return {
    kind: "text",
    title: idle ? `Follow up with ${agent.name}` : `Queue a prompt for ${agent.name}`,
    label: "Prompt",
    initial: "",
    multiline: true,
    submit: idle ? "Send" : "Queue",
    note: idle ? undefined : "Sent by this app as soon as the current turn ends, while the app is open.",
    onSubmit: async (text) => {
      if ((await enqueue(agent, text)) === "queued") flash(`Queued for ${agent.name}`);
    },
    alt: {
      label: "Save for later",
      title: "Keep it in Ideas, under this project, instead of sending it",
      onSubmit: async (text) => {
        const repo = projectOfWorktree(getState(), agent.worktree_id)?.repo_path ?? null;
        if (await addIdea(text, repo, { kind: "thread", agent: agent.id })) flash("Saved to Ideas");
      },
    },
  };
}

/** Prompts lined up for this agent's next turns, each removable. */
function QueueStrip({ agent, queued }: { agent: Agent; queued: { id: string; text: string }[] | undefined }) {
  // The one message opened to its full text, if any.
  const [open, setOpen] = useState<string | null>(null);
  if (!queued?.length) return null;
  return (
    <div className="queue-strip" aria-label={`Queued for ${agent.name}`}>
      <span className="queue-label">Up next</span>
      <ol>
        {queued.map((q, i) => (
          <li key={q.id}>
            <span className="queue-n">{i + 1}</span>
            <button
              className={`queue-text${open === q.id ? " is-open" : ""}`}
              aria-expanded={open === q.id}
              title={open === q.id ? "Show less" : "Show the whole message"}
              onClick={() => setOpen(open === q.id ? null : q.id)}
            >
              {q.text}
            </button>
            <button className="icon-btn" onClick={() => unqueue(agent.id, q.id)} aria-label="Remove from the queue" title="Remove">
              ×
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RenameableTitle({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (!editing) {
    return (
      <h2 className="pane-name" onDoubleClick={() => (setDraft(name), setEditing(true))} title="Double-click to rename">
        {name}
      </h2>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) void onRename(next).catch((e) => console.warn(e));
  };
  return (
    <input
      className="pane-name-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      aria-label="Session name"
    />
  );
}
