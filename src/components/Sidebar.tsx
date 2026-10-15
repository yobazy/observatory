import { useMemo, useRef, useState, useEffect } from "react";
import {
  STATUS_ORDER,
  projectAgents,
  projectOfWorktree,
  setState,
  sortedProjects,
  useAppState,
  waitingAgents,
} from "../nebula/store";
import { relativeTime } from "../nebula/status";
import type { Agent, Project } from "../nebula/types";
import { UsageChip } from "./Usage";
import { Pet } from "./Pet";
import { restartToUpdate, useUpdateState } from "../nebula/updates";
import { QuickAnswer } from "./QuickAnswer";
import { AwayDigest } from "./AwayDigest";
import { ProjectIcon, useProjectColorStyle, useProjectMenu } from "./ProjectIcon";
import { FlagGlyph, FollowUps } from "./Organize";
import { UncommittedEntry } from "./Uncommitted";
import { moveProject } from "../nebula/organize";
import { reorderKey, useReorder } from "./useReorder";
import { useBatches } from "../nebula/batch";

export function selectAgent(agent: Agent) {
  setState((s) => ({
    selectedProject: s.worktrees[agent.worktree_id]?.project_id ?? s.selectedProject,
    selectedSession: { Agent: agent.id },
  }));
}

export function Sidebar({
  onAddProject,
  onHide,
  onDispatch,
}: {
  onAddProject: () => void;
  onHide: () => void;
  onDispatch: () => void;
}) {
  const state = useAppState();
  const boardOn = useBatches().some((b) => !b.dismissed) || state.view === "dispatch";
  const [query, setQuery] = useState("");
  const [needsOnly, setNeedsOnly] = useNeedsOnly();
  // Waiting rows opened to answer from here, by agent id.
  const [answering, setAnswering] = useState<Set<string>>(() => new Set());
  const toggleAnswer = (id: string) =>
    setAnswering((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const search = useRef<HTMLInputElement>(null);
  const projectMenu = useProjectMenu();
  // Dragging reorders the whole list, so not while it's filtered.
  const filtered = !!query || needsOnly;
  const reorder = useReorder((repo, to) => void moveProject(repo, to), !filtered);

  const projects = useMemo(() => sortedProjects(state), [state]);
  const waiting = useMemo(() => waitingAgents(state), [state]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q)
      return projects.filter((p) => p.name.toLowerCase().includes(q) || p.repo_path.toLowerCase().includes(q));
    // Needs you: what's waiting, working or unread, and the project you're in.
    if (needsOnly)
      return projects.filter(
        (p) =>
          p.id === state.selectedProject ||
          state.missingProjects[p.id] ||
          projectAgents(state, p.id).some((a) => a.status === "needs_feedback" || a.status === "running" || a.unseen),
      );
    return projects;
  }, [projects, query, needsOnly, state]);
  const hiddenCount = projects.length - shown.length;

  // ⌘P jumps to the project filter; ⌘1–9 picks a project.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "p") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if (/^[1-9]$/.test(e.key)) {
        const p = projects[Number(e.key) - 1];
        if (p) {
          e.preventDefault();
          setState({ selectedProject: p.id });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projects]);

  return (
    <nav className="sidebar" aria-label="Projects">
      <div className="sidebar-top" data-tauri-drag-region>
        <span className="wordmark" data-tauri-drag-region>
          nebula
          {/* A build run from the source, beside the installed app: say so. */}
          {import.meta.env.DEV && (
            <span className="dev-badge" title="Development build, run from the source">
              DEV
            </span>
          )}
        </span>
        <span className="sidebar-actions">
          <LinkDot />
          <button className="icon-btn" title="Hide projects (⌘B)" aria-label="Hide projects" onClick={onHide}>
            <PanelGlyph />
          </button>
          <button
            className="icon-btn"
            title="Add project (⌘O)"
            aria-label="Add project"
            onClick={onAddProject}
          >
            +
          </button>
        </span>
      </div>

      {waiting.length > 0 && (
        <section className="waiting" aria-label="Sessions waiting on you">
          <h2 className="waiting-title">
            Waiting on you <span className="waiting-count">{waiting.length}</span>
          </h2>
          <ul>
            {waiting.map((a) => {
              const open = answering.has(a.id);
              return (
                <li key={a.id} className={open ? "is-answering" : undefined}>
                  <button className="waiting-row" onClick={() => selectAgent(a)}>
                    <span className="sdot dot-needs_feedback" aria-hidden />
                    <span className="waiting-name">
                      {a.name}
                      {state.prefs.followUps?.[a.id] !== undefined && (
                        <span className="waiting-flag" role="img" aria-label="Flagged for follow-up" title="Flagged for follow-up">
                          <FlagGlyph />
                        </span>
                      )}
                    </span>
                    <span className="waiting-where">
                      <span>
                        <ProjectDot project={projectOfWorktree(state, a.worktree_id)} />
                        {projectOfWorktree(state, a.worktree_id)?.name}
                      </span>
                      <span className="waiting-age">{relativeTime(a.status_changed_at)}</span>
                    </span>
                  </button>
                  <button
                    className={`waiting-answer${open ? " is-on" : ""}`}
                    onClick={() => toggleAnswer(a.id)}
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Answer"} ${a.name} here`}
                    title={open ? "Hide" : "Answer without opening it"}
                  >
                    {open ? "Hide" : "Answer"}
                  </button>
                  {open && <QuickAnswer agent={a} onOpen={() => selectAgent(a)} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <AwayDigest onOpen={selectAgent} />
      <FollowUps />
      <UncommittedEntry />

      <div className="project-search has-toggle">
        <input
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              setState({ selectedProject: shown[0].id });
              setQuery("");
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
          placeholder={`Filter ${projects.length} projects`}
          aria-label="Filter projects"
          aria-keyshortcuts="Meta+P"
          title="Filter projects (⌘P)"
          spellCheck={false}
        />
        <button
          className="needs-toggle"
          aria-pressed={needsOnly}
          onClick={() => setNeedsOnly(!needsOnly)}
          title={needsOnly ? "Show every project" : "Show only projects with something waiting, working or unread"}
        >
          Needs you
        </button>
      </div>

      <ul className="project-list" ref={reorder.list}>
        {shown.map((p, i) => (
          <li key={p.id} {...reorder.item(p.repo_path)}>
            <ProjectRow
              project={p}
              index={filtered ? null : i}
              agents={projectAgents(state, p.id)}
              live={Object.values(state.terminals).some(
                (t) => t.alive && t.run_command !== null && state.worktrees[t.worktree_id]?.project_id === p.id,
              )}
              selected={p.id === state.selectedProject}
              onMenu={projectMenu.openFor}
              onKeyDown={(e) => !filtered && reorderKey(e, i, shown.length, (to) => void moveProject(p.repo_path, to))}
            />
          </li>
        ))}
        {needsOnly && !query && hiddenCount > 0 && (
          <li className="project-quiet">
            <button className="link-btn" onClick={() => setNeedsOnly(false)}>
              {hiddenCount} quiet {hiddenCount === 1 ? "project" : "projects"}
            </button>
          </li>
        )}
        {shown.length === 0 && state.loaded && !needsOnly && (
          <li className="project-empty">
            {query ? (
              `No project matches “${query}”.`
            ) : (
              <>
                <p>No projects yet.</p>
                <button className="btn" onClick={onAddProject}>
                  Add a project <kbd>⌘O</kbd>
                </button>
              </>
            )}
          </li>
        )}
      </ul>

      {projectMenu.element}
      <Pet on={state.prefs.pet !== false} />
      <UpdateReady />
      <footer className="sidebar-foot">
        <UsageChip />
        <button className="icon-btn foot-gear" onClick={onDispatch} aria-label="Dispatch" title="Dispatch: your to-do list (⇧⌘N)">
          <ListGlyph />
        </button>
        {boardOn && (
          <button
            className={`icon-btn foot-gear${state.view === "dispatch" ? " is-on" : ""}`}
            onClick={() => setState({ view: state.view === "dispatch" ? "sessions" : "dispatch" })}
            aria-pressed={state.view === "dispatch"}
            aria-label="Dispatch board"
            title="Dispatch board: every dispatched task"
          >
            <BoardGlyph />
          </button>
        )}
        <button
          className={`icon-btn foot-gear${state.view === "settings" ? " is-on" : ""}`}
          onClick={() => setState({ view: state.view === "settings" ? "sessions" : "settings" })}
          aria-pressed={state.view === "settings"}
          aria-label="Settings"
          title="Settings (⌘,)"
        >
          <GearGlyph />
        </button>
      </footer>
    </nav>
  );
}

const NEEDS_KEY = "observatory.sidebar.needsOnly";

/** Whether the project list shows only what needs you; remembered per Mac. */
function useNeedsOnly(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(NEEDS_KEY) === "1";
    } catch {
      return false;
    }
  });
  return [
    on,
    (next) => {
      setOn(next);
      try {
        localStorage.setItem(NEEDS_KEY, next ? "1" : "0");
      } catch {
        // Remembering it is a nicety.
      }
    },
  ];
}

/** Once a new version is installed: restart into it, and what's in it. */
function UpdateReady() {
  const update = useUpdateState();
  const [open, setOpen] = useState(false);
  if (update.kind !== "ready") return null;
  return (
    <div className="update-ready">
      {open && (
        <ul className="update-notes" id="update-notes">
          {update.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <button
        className="btn btn-primary"
        onClick={() => void restartToUpdate()}
        title="Your agents keep running while the app restarts."
      >
        Restart to update to {update.version}
      </button>
      {update.notes.length > 0 && (
        <button
          className="update-whats-new"
          aria-expanded={open}
          aria-controls="update-notes"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide what's new" : "What's new"}
        </button>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  index,
  agents,
  selected,
  live,
  onMenu,
  onKeyDown,
}: {
  project: Project;
  index: number | null;
  agents: Agent[];
  selected: boolean;
  live: boolean;
  onMenu: (e: React.MouseEvent, project: Project) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const needs = agents.filter((a) => a.status === "needs_feedback").length;
  const unseen = agents.filter((a) => a.status === "finished" && a.unseen).length;
  const running = agents.filter((a) => a.status === "running").length;
  const ordered = [...agents].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );
  const summary = [
    needs && `${needs} waiting`,
    running && `${running} working`,
    unseen && `${unseen} unread`,
  ]
    .filter(Boolean)
    .join(", ");
  const colorStyle = useProjectColorStyle(project);
  const missing = !!useAppState().missingProjects[project.id];

  return (
    <button
      className={`project-row${selected ? " is-selected" : ""}${colorStyle ? " has-color" : ""}${missing ? " is-missing" : ""}`}
      style={colorStyle}
      onClick={() => setState({ selectedProject: project.id })}
      onContextMenu={(e) => onMenu(e, project)}
      onKeyDown={onKeyDown}
      aria-keyshortcuts={index !== null ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      aria-current={selected ? "page" : undefined}
      title={missing ? `Folder not found: ${project.repo_path}` : project.repo_path}
    >
      <span className="project-line">
        <ProjectIcon project={project} />
        <span className="project-name">{project.name}</span>
        {live && <span className="live-dot" title="Dev server running" aria-label="Dev server running" />}
        <span className="project-meta">
          {missing && (
            <span className="project-badge badge-missing" title="Folder not found. Right-click to locate it.">
              !
            </span>
          )}
          {running > 0 && (
            <span className="project-working" title={`${running} in progress`}>
              <span className="orbit" aria-hidden />
              <span className="sr-only">{running} in progress</span>
              <span aria-hidden>{running}</span>
            </span>
          )}
          {needs > 0 && (
            <span className="project-badge badge-needs" title={`${needs} waiting on you`}>
              {needs}
            </span>
          )}
          {unseen > 0 && (
            <span className="project-badge badge-unseen" title={`${unseen} finished, unread`}>
              {unseen}
            </span>
          )}
          {running + needs + unseen === 0 && index !== null && index < 9 && (
            <kbd className="project-key">⌘{index + 1}</kbd>
          )}
        </span>
      </span>
      {/* One segment per live session, ordered by urgency. */}
      <span className="spectrum" aria-label={summary || `${agents.length} sessions`}>
        {ordered.length === 0 ? (
          <span className="spectrum-empty" />
        ) : (
          ordered.map((a) => (
            <span key={a.id} className={`seg seg-${a.status}${a.unseen ? " is-unseen" : ""}`} />
          ))
        )}
      </span>
    </button>
  );
}

function LinkDot() {
  const link = useAppState().link;
  const label =
    link.state === "connected"
      ? `Connected to daemon (pid ${link.daemonPid})`
      : link.state === "connecting"
        ? "Connecting to daemon"
        : "Daemon not connected";
  return <span className={`link-dot link-${link.state}`} title={label} aria-label={label} />;
}

function GearGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Zm5.3 3.3.9.7-1.1 2-1.1-.3a4.8 4.8 0 0 1-1.3.8l-.2 1.1H7.5l-.2-1.1a4.8 4.8 0 0 1-1.3-.8l-1.1.3-1.1-2 .9-.7a4.9 4.9 0 0 1 0-1.8l-.9-.7 1.1-2 1.1.3c.4-.3.8-.6 1.3-.8l.2-1.1h2.2l.2 1.1c.5.2.9.5 1.3.8l1.1-.3 1.1 2-.9.7a4.9 4.9 0 0 1 0 1.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Three columns of cards: the Dispatch board. */
function BoardGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 2.75h3v10.5h-3zM6.5 2.75h3v6.5h-3zM10.5 2.75h3v8.5h-3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/** A checklist: Dispatch's to-do list. */
function ListGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path d="m2 4 1.2 1.2L5.4 3M2 10l1.2 1.2L5.4 9M7.5 4.2h6.5M7.5 10.2h6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A window with its left panel marked: hide or show a column. */
export function PanelGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 3v10" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** A small dot in the project's color, when it has one. */
export function ProjectDot({ project }: { project: Project | undefined }) {
  const style = useProjectColorStyle(project);
  return style ? <span className="project-dot" style={style} aria-hidden /> : null;
}
