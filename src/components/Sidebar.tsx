import { useMemo, useRef, useState, useEffect } from "react";
import {
  STATUS_ORDER,
  daemonName,
  getState,
  projectAgents,
  projectOfWorktree,
  setState,
  sortedProjects,
  useAppState,
  waitingAgents,
} from "../nebula/store";
import { lastPrompt, relativeTime } from "../nebula/status";
import type { Agent, Project } from "../nebula/types";
import { UsageChip } from "./Usage";
import { AutomationsButton } from "./Automations";
import { ActivityGlyph, LoadMeter } from "./Activity";
import { Pet } from "./Pet";
import { restartToUpdate, useUpdateState } from "../nebula/updates";
import { QuickAnswer } from "./QuickAnswer";
import { AwayDigest } from "./AwayDigest";
import { ProjectIcon, useProjectColorStyle, useProjectMenu } from "./ProjectIcon";
import { FlagGlyph, FollowUps, PriorityMark } from "./Organize";
import { UncommittedEntry } from "./Uncommitted";
import { IdeasEntry } from "./Ideas";
import { InboxEntry } from "./Inbox";
import { createFolder, deleteFolder, moveFolder, moveInFolder, moveProject, moveToFolder, renameFolder, shiftFolder, toggleFolder } from "../nebula/organize";
import { allTags, cleanTag, layout, matches, type ProjectFolder } from "../nebula/folders";
import { carriedTags } from "../nebula/threadtags";
import { FolderGlyph } from "./ProjectOrganize";
import { ContextMenu, type MenuItem } from "./Menu";
import { ConfirmDialog, TextDialog, type ConfirmDialogSpec, type TextDialogSpec } from "./Dialogs";
import { reorderKey, useReorder, type DropInto } from "./useReorder";
import { useBatches } from "../nebula/batch";
import { useRecentCount, useVisits } from "../nebula/recent";
import { RECENT_COUNTS, recentProjects, type RecentCount } from "../nebula/recentList";

/** The drop group (useReorder's `data-drop-into`) of the projects in no
 *  folder; a folder's is its id. */
const LOOSE = "";

/** A project held over a folder goes into it; over the list, out of its folder. */
const fileInto = (own: string): DropInto => ({
  own,
  onDrop: (repo, into) => void moveToFolder(repo, into === LOOSE ? null : into),
});

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
  const projects = useMemo(() => sortedProjects(state), [state]);
  // Unfiltered, the list is folders first, then the projects in none.
  const grouped = useMemo(() => layout(projects, state.prefs), [projects, state.prefs]);
  const looseRepos = grouped.loose.map((p) => p.repo_path);
  const reorder = useReorder((repo, to) => void moveProject(repo, to, looseRepos), !filtered, fileInto(LOOSE));
  const folderOrder = useReorder((id, to) => void moveFolder(id, to), !filtered);
  // The tags each project's threads carry, by repo: "#tag" finds those too.
  const threadTags = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.repo_path, carriedTags(state.prefs, projectAgents(state, p.id).map((a) => a.id))])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, state.prefs, state.agents, state.worktrees],
  );
  const tags = useMemo(() => allTags(state.prefs, projects.map((p) => p.repo_path), threadTags), [projects, state.prefs, threadTags]);
  // A "#tag" filter is a tag looked for across projects: a project opened
  // meanwhile turns its chip on, and ⌘K can set it.
  const queryTag = query.trim().startsWith("#") ? cleanTag(query) || null : null;
  useEffect(() => {
    if (getState().tagFilter !== queryTag) setState({ tagFilter: queryTag });
  }, [queryTag]);
  useEffect(() => {
    if (state.tagFilter && state.tagFilter !== queryTag) setQuery(`#${state.tagFilter}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tagFilter]);
  const waiting = useMemo(() => waitingAgents(state), [state]);
  const shown = useMemo(() => {
    if (query.trim()) return projects.filter((p) => matches(p, daemonName(p), state.prefs, query, threadTags[p.repo_path]));
    // Needs you: what's waiting, working or unread, and the project you're in.
    if (needsOnly)
      return projects.filter(
        (p) =>
          p.id === state.selectedProject ||
          state.missingProjects[p.id] ||
          projectAgents(state, p.id).some((a) => a.status === "needs_feedback" || a.status === "running" || a.unseen),
      );
    return projects;
  }, [projects, query, needsOnly, state, threadTags]);
  const hiddenCount = projects.length - shown.length;
  // The order on screen, which ⌘1–9 count in: a folded folder's projects aren't.
  const onScreen = filtered ? shown : [...grouped.folders.flatMap((g) => (g.folder.collapsed ? [] : g.projects)), ...grouped.loose];
  const keyOf = (p: Project) => (filtered ? null : onScreen.indexOf(p));

  const row = (p: Project, i: number, count: number, move: (to: number) => void) => (
    <ProjectRow
      project={p}
      index={keyOf(p)}
      agents={projectAgents(state, p.id)}
      live={Object.values(state.terminals).some(
        (t) => t.alive && t.run_command !== null && state.worktrees[t.worktree_id]?.project_id === p.id,
      )}
      selected={p.id === state.selectedProject}
      onMenu={projectMenu.openFor}
      onKeyDown={(e) => !filtered && reorderKey(e, i, count, move)}
    />
  );

  const [folderMenu, setFolderMenu] = useState<{ items: MenuItem[]; x: number; y: number; label: string } | null>(null);
  const [folderDialog, setFolderDialog] = useState<TextDialogSpec | ConfirmDialogSpec | null>(null);
  const openFolderMenu = (e: React.MouseEvent, folder: ProjectFolder) => {
    e.preventDefault();
    const all = state.prefs.projectFolders ?? [];
    const at = all.findIndex((f) => f.id === folder.id);
    const items: MenuItem[] = [
      {
        label: "Rename folder…",
        run: () =>
          setFolderDialog({
            kind: "text",
            title: "Rename folder",
            label: "Folder name",
            initial: folder.name,
            submit: "Rename",
            onSubmit: async (name) => void (await renameFolder(folder.id, name)),
          }),
      },
      ...(at > 0 ? [{ label: "Move up", run: () => void shiftFolder(folder.id, -1), separated: true }] : []),
      ...(at < all.length - 1 ? [{ label: "Move down", run: () => void shiftFolder(folder.id, 1), separated: at === 0 }] : []),
      {
        label: "Delete folder…",
        destructive: true,
        separated: true,
        run: () =>
          setFolderDialog({
            kind: "confirm",
            title: `Delete ${folder.name}?`,
            message: folder.projects.length
              ? `The folder goes and its ${folder.projects.length === 1 ? "project goes" : `${folder.projects.length} projects go`} back to the list. Nothing else changes.`
              : "The folder goes. Nothing else changes.",
            confirm: "Delete folder",
            onConfirm: async () => void (await deleteFolder(folder.id)),
          }),
      },
    ];
    setFolderMenu({ items, x: e.clientX, y: e.clientY, label: `${folder.name} actions` });
  };

  // ⌘P jumps to the project filter; ⌘1–9 picks a project.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "p") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if (/^[1-9]$/.test(e.key)) {
        const p = onScreen[Number(e.key) - 1];
        if (p) {
          e.preventDefault();
          setState({ selectedProject: p.id });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onScreen]);

  return (
    <nav className="sidebar" aria-label="Projects">
      <div className="sidebar-top" data-tauri-drag-region>
        <span className="wordmark" data-tauri-drag-region>
          {/* A build run from the source, beside the installed app, says so
              in place of the name: the row has no room for both. */}
          {import.meta.env.DEV ? (
            <span className="dev-badge" title="Observatory, a development build run from the source">
              DEV
            </span>
          ) : (
            "Observatory"
          )}
        </span>
        <span className="sidebar-actions">
          <LinkDot />
          <button className="icon-btn" title="Hide the sidebar (⌘B)" aria-label="Hide the sidebar" onClick={onHide}>
            <PanelGlyph />
          </button>
        </span>
      </div>

      {/* The cards and the projects scroll as one, so a long list of what
          finished never leaves the projects out of reach. */}
      <div className="sidebar-scroll">
        {waiting.length > 0 && (
          <section className="side-card waiting" aria-label="Sessions waiting on you">
            <h2
              className="side-card-head"
              title="Sessions stopped until you answer them: a question, a permission prompt or a menu. Click one to open it, or Answer to reply from here."
            >
              <AskGlyph />
              <span className="side-card-title">Waiting on you</span> <span className="side-card-count">{waiting.length}</span>
            </h2>
            <ul>
              {waiting.map((a) => {
                const open = answering.has(a.id);
                const project = projectOfWorktree(state, a.worktree_id);
                return (
                  <li key={a.id} className={open ? "is-answering" : undefined}>
                    <button
                      className="side-row"
                      onClick={() => selectAgent(a)}
                      title={`${a.name}, in ${project?.name ?? "its project"}, is waiting on you.${lastPrompt(a) ? `\nYou asked: ${lastPrompt(a)}` : ""}\nClick to open it.`}
                    >
                      <span className="side-row-name">
                        {a.name}
                        <PriorityMark priority={state.prefs.taskPriorities?.[a.id]} />
                        {state.prefs.followUps?.[a.id] !== undefined && (
                          <span className="waiting-flag" role="img" aria-label="Flagged for follow-up" title="Flagged for follow-up">
                            <FlagGlyph />
                          </span>
                        )}
                      </span>
                      <span className="side-row-age">{relativeTime(a.status_changed_at)}</span>
                      <span className="side-row-sub">
                        <ProjectDot project={project} />
                        <span className="side-row-text">{project?.name}</span>
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
        <div className="side-entries">
          <UncommittedEntry />
          <IdeasEntry />
          <InboxEntry />
        </div>

        <RecentPanel projects={projects} onMenu={projectMenu.openFor} />

        <div className="projects-head">
          <h2 title="Every project nebula knows. Right-click one for folders, a name of your own, tags, its icon and color.">
            Projects <span className="projects-count">{projects.length}</span>
          </h2>
          <button
            className="icon-btn"
            onClick={() =>
              setFolderDialog({
                kind: "text",
                title: "New folder",
                label: "Folder name",
                initial: "",
                submit: "Create folder",
                note: "Put projects in it by dragging them onto it, or from their right-click menu: Move to folder.",
                onSubmit: async (name) => void (await createFolder(name)),
              })
            }
            title="New folder: group projects together"
            aria-label="New folder"
          >
            <FolderGlyph plus />
          </button>
          <button className="icon-btn" onClick={onAddProject} title="Add a project: a git folder for nebula to run agents in (⌘O)" aria-label="Add project">
            +
          </button>
        </div>

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

        {tags.length > 0 && (
          <div className="tag-filter" aria-label="Filter by tag">
            {tags.map((t) => {
              const on = query.trim().toLowerCase() === `#${t}`;
              return (
                <button
                  key={t}
                  className={`tag-chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setQuery(on ? "" : `#${t}`)}
                  title={on ? "Show every project again" : `Show only projects tagged #${t}, or with threads tagged #${t}`}
                >
                  #{t}
                </button>
              );
            })}
          </div>
        )}

        {!filtered && grouped.folders.length > 0 && (
          <ul className="folder-list" ref={folderOrder.list} aria-label="Folders">
            {grouped.folders.map(({ folder, projects: inside }, i, all) => {
              // Folders drag by their heading; their projects drag on their own.
              const { onPointerDown, ...item } = folderOrder.item(folder.id);
              return (
                <li key={folder.id} {...item}>
                  <FolderGroup
                    folder={folder}
                    projects={inside}
                    row={row}
                    onMenu={openFolderMenu}
                    onHeadDown={onPointerDown}
                    onHeadKey={(e) => reorderKey(e, i, all.length, (to) => void moveFolder(folder.id, to))}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <ul className="project-list is-loose" ref={reorder.list} data-drop-into={filtered ? undefined : LOOSE}>
          {(filtered ? shown : grouped.loose).map((p, i, list) => (
            <li key={p.id} {...reorder.item(p.repo_path)}>
              {row(p, i, list.length, (to) => void moveProject(p.repo_path, to, looseRepos))}
            </li>
          ))}
          {needsOnly && !query && hiddenCount > 0 && (
            <li className="project-quiet">
              <button className="link-btn" onClick={() => setNeedsOnly(false)} title="These have nothing waiting, working or unread. Show them too.">
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
      </div>

      {projectMenu.element}
      {folderMenu && <ContextMenu {...folderMenu} onClose={() => setFolderMenu(null)} />}
      {folderDialog?.kind === "text" && <TextDialog d={folderDialog} onClose={() => setFolderDialog(null)} />}
      {folderDialog?.kind === "confirm" && <ConfirmDialog d={folderDialog} onClose={() => setFolderDialog(null)} />}
      <Pet on={state.prefs.pet !== false} />
      <UpdateReady />
      <footer className="sidebar-foot">
        <UsageChip />
        <AutomationsButton />
        <button
          className={`icon-btn foot-gear${state.view === "activity" ? " is-on" : ""}`}
          onClick={() => setState({ view: state.view === "activity" ? "sessions" : "activity" })}
          aria-pressed={state.view === "activity"}
          aria-label="Activity"
          title="Activity: what's running in your projects, and the CPU and memory it takes (⌥⌘U)"
        >
          <ActivityGlyph />
        </button>
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

/** The last few projects you were in, this one marked among them, above
 *  the full list so switching back never takes a scroll or a search. */
function RecentPanel({ projects, onMenu }: { projects: Project[]; onMenu: (e: React.MouseEvent, project: Project) => void }) {
  const state = useAppState();
  const visits = useVisits();
  const [count, setCount] = useRecentCount();
  const current = state.selectedProject ? state.projects[state.selectedProject] : undefined;
  const recent = useMemo(() => recentProjects(visits, projects, current, count), [visits, projects, current, count]);
  // Only you being here isn't a list yet.
  if (recent.length < 2) return null;
  return (
    <section className="recent" aria-label="Recent projects">
      <div className="recent-head">
        <h2 title="The projects you were in last, newest first, with the one you're in highlighted.">Recent</h2>
        <select
          className="recent-count"
          value={count}
          onChange={(e) => setCount(Number(e.target.value) as RecentCount)}
          aria-label="How many recent projects to show"
          title="How many recent projects to show"
        >
          {RECENT_COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <ul>
        {recent.map(({ project, at, here }) => {
          const agents = projectAgents(state, project.id);
          const needs = agents.filter((a) => a.status === "needs_feedback").length;
          const running = agents.filter((a) => a.status === "running").length;
          return (
            <li key={project.id}>
              <button
                className={`recent-row${here ? " is-selected" : ""}`}
                aria-current={here ? "page" : undefined}
                onClick={() => setState({ selectedProject: project.id })}
                onContextMenu={(e) => onMenu(e, project)}
                title={here ? `${project.name}\n${project.repo_path}\nYou're here` : `${project.name}\n${project.repo_path}\nLast opened: ${relativeTime(at)}`}
              >
                <ProjectIcon project={project} />
                <span className="project-name">{project.name}</span>
                <span className="project-meta">
                  {running > 0 && (
                    <span className="project-working" title={`${running} in progress`}>
                      <span className="orbit" aria-hidden />
                      <span aria-hidden>{running}</span>
                    </span>
                  )}
                  {needs > 0 && (
                    <span className="project-badge badge-needs" title={`${needs} waiting on you`}>
                      {needs}
                    </span>
                  )}
                  <span className="recent-age">{here ? "here" : relativeTime(at)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
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

/** A folder of projects: its header folds it away, keeping what's inside
 *  waiting, working or unread in sight, and drags it among the folders. Its
 *  projects drag among themselves, onto another folder, or out to the list;
 *  a project dragged onto it goes in. */
function FolderGroup({
  folder,
  projects,
  row,
  onMenu,
  onHeadDown,
  onHeadKey,
}: {
  folder: ProjectFolder;
  projects: Project[];
  row: (p: Project, i: number, count: number, move: (to: number) => void) => React.ReactNode;
  onMenu: (e: React.MouseEvent, folder: ProjectFolder) => void;
  onHeadDown: (e: React.PointerEvent<HTMLElement>) => void;
  onHeadKey: (e: React.KeyboardEvent) => void;
}) {
  const state = useAppState();
  const reorder = useReorder((repo, to) => void moveInFolder(folder.id, repo, to), true, fileInto(folder.id));
  const agents = projects.flatMap((p) => projectAgents(state, p.id));
  const needs = agents.filter((a) => a.status === "needs_feedback").length;
  const running = agents.filter((a) => a.status === "running").length;
  const unseen = agents.filter((a) => a.status === "finished" && a.unseen).length;
  const open = !folder.collapsed;
  return (
    <section className={`folder${open ? " is-open" : ""}`} aria-label={`${folder.name} folder`} data-drop-into={folder.id}>
      <button
        className="folder-head"
        onClick={() => void toggleFolder(folder.id)}
        onContextMenu={(e) => onMenu(e, folder)}
        onPointerDown={onHeadDown}
        onKeyDown={onHeadKey}
        aria-expanded={open}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        title={`${folder.name}: ${projects.length} ${projects.length === 1 ? "project" : "projects"}. Click to ${open ? "fold it away" : "open it"}; drag to move it; right-click to rename or delete it. Drag a project onto it to put it in.`}
      >
        <span className="folder-chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <FolderGlyph open={open} />
        <span className="folder-name">{folder.name}</span>
        <span className="folder-count">{projects.length}</span>
        {!open && (
          <span className="project-meta">
            {running > 0 && (
              <span className="project-working" title={`${running} in progress`}>
                <span className="orbit" aria-hidden />
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
          </span>
        )}
      </button>
      {open && (
        <ul className="project-list in-folder" ref={reorder.list}>
          {projects.map((p, i) => (
            <li key={p.id} {...reorder.item(p.repo_path)}>
              {row(p, i, projects.length, (to) => void moveInFolder(folder.id, p.repo_path, to))}
            </li>
          ))}
          {projects.length === 0 && <li className="folder-empty">Empty. Drag a project here, or right-click one and pick Move to folder.</li>}
        </ul>
      )}
    </section>
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
  const { missingProjects, prefs } = useAppState();
  const missing = !!missingProjects[project.id];
  const tags = prefs.projectTags?.[project.repo_path] ?? [];

  return (
    <button
      className={`project-row${selected ? " is-selected" : ""}${colorStyle ? " has-color" : ""}${missing ? " is-missing" : ""}`}
      style={colorStyle}
      onClick={() => setState({ selectedProject: project.id })}
      onContextMenu={(e) => onMenu(e, project)}
      onKeyDown={onKeyDown}
      aria-keyshortcuts={index !== null ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      aria-current={selected ? "page" : undefined}
      title={
        missing
          ? `Folder not found: ${project.repo_path}`
          : `${project.name}\n${project.repo_path}${summary ? `\n${summary}` : ""}\nRight-click for folders, a name of your own, tags, icon and color.`
      }
    >
      <span className="project-line">
        <ProjectIcon project={project} />
        <span className="project-name">{project.name}</span>
        <PriorityMark priority={prefs.projectPriorities?.[project.repo_path]} />
        {live && <span className="live-dot" title="Dev server running" aria-label="Dev server running" />}
        <span className="project-meta">
          <LoadMeter projectId={project.id} />
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
      {tags.length > 0 && <span className="project-tags">{tags.map((t) => `#${t}`).join("  ")}</span>}
      {/* One segment per live session, ordered by urgency. */}
      <span
        className="spectrum"
        aria-label={summary || `${agents.length} sessions`}
        title={`${summary || `${agents.length} ${agents.length === 1 ? "session" : "sessions"}`}\nOne segment per session, most urgent first: coral is waiting on you, blue working, green finished and unread, grey finished, pink stopped with an error.`}
      >
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

/** A speech bubble: a session asking you something. */
function AskGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
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
