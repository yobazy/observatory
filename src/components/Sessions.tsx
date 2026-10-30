import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProjectIdeas } from "./Ideas";
import {
  flash,
  getState,
  projectAgents,
  projectWorktrees,
  setState,
  useAppState,
  worktreeAgents,
  worktreeTerminals,
} from "../nebula/store";
import { agentSpec, harnessLabel, KIND_LABEL, lastPrompt, relativeTime, statusLabel, usualHarness } from "../nebula/status";
import { request } from "../nebula/client";
import { changedFiles, neverPushed, shipKind, type GitState, type GitStatus } from "../nebula/git";
import { runOnWorktree, SHIP_LABEL, shipPrompt, shipWhat, takerFor } from "../nebula/actions";
import { AgentServerMark, BandRunButton, BandRunLine, ProjectRun } from "./Run";
import { PrLine } from "./Pr";
import { ConfirmDialog, type ConfirmDialogSpec } from "./Dialogs";
import { useHoverPreview } from "./HoverPreview";
import { fanOutOf, openCompare } from "../nebula/fanout";
import { useSessionCosts } from "../nebula/budget";
import { money, sessionKey } from "../nebula/usage";
import { EditorButton } from "./Editor";
import { openReview } from "../nebula/diff";
import { setArchived, useRowMenu, type Seed } from "./RowMenu";
import { PanelGlyph } from "./Sidebar";
import { ProjectIcon, useProjectColorStyle } from "./ProjectIcon";
import { locateProject } from "../nebula/relocate";
import { sameSession, type Agent, type SessionRef, type TerminalTab, type Worktree } from "../nebula/types";
import { cyclePriority, isFollowUp, isPinned, moveTask, toggleFlag } from "../nebula/organize";
import { FlagGlyph, PinGlyph, PriorityMark, TagChip, TagListDialog, TagMarks, ThreadTagsDialog, useTaskColorStyle } from "./Organize";
import { chipFor, hasTerms, searchTerms, tagCounts, tagList, threadShows, toggleChip } from "../nebula/threadtags";
import { tagProjectNow } from "../nebula/taggingRunner";
import type { DesktopPrefs } from "../nebula/theme";
import { reorderKey, useReorder } from "./useReorder";
import { useVerdict } from "../nebula/verdicts";
import { Plate, plateTone } from "./Plate";

/** Re-render once a minute so relative times stay honest. */
function useMinuteTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
}

type NewTask = (worktree?: string, seed?: Seed) => void;

/** Tasks picked with ⇧-click (a range) or ⌘-click (one at a time), to act
 *  on together. `click` handles a modified click and says if it did. */
type Picks = { ids: Set<string>; click: (e: React.MouseEvent, id: string) => boolean };
const PicksContext = createContext<Picks | null>(null);

/** What the list is narrowed to: a search's words, and the tag chips on. */
type Filter = { terms: string[]; tags: string[]; prefs: DesktopPrefs };

/** A task matches on its name, prompts, agent, model or branch, and on
 *  every chip's tag when any are on. */
function agentMatches(a: Agent, wt: Worktree, f: Filter): boolean {
  return threadShows(f.prefs, a.id, f.tags, f.terms, [
    a.name,
    a.custom_harness ?? KIND_LABEL[a.kind],
    a.model,
    wt.branch,
    ...a.recent_prompts.map((p) => p.text),
  ]);
}

/** Terminals carry no tags, so a chip hides them. */
function terminalMatches(t: TerminalTab, wt: Worktree, f: Filter): boolean {
  return !f.tags.length && hasTerms(f.terms, [t.name, t.run_command, wt.branch]);
}

const filtering = (f: Filter) => f.terms.length > 0 || f.tags.length > 0;

export function Sessions({ onNewTask, onHide }: { onNewTask: NewTask; onHide: () => void }) {
  const state = useAppState();
  useMinuteTick();
  const rowMenu = useRowMenu(onNewTask);
  const preview = useHoverPreview();
  const colorStyle = useProjectColorStyle(state.selectedProject ? state.projects[state.selectedProject] : undefined);
  const project = state.selectedProject ? state.projects[state.selectedProject] : undefined;
  const worktrees = useMemo(
    () => (project ? projectWorktrees(state, project.id) : []),
    [state, project],
  );
  const [query, setQuery] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  const terms = useMemo(() => searchTerms(query), [query]);
  // The tag chips that are on: only threads carrying all of them show.
  const [chips, setChips] = useState<string[]>([]);
  const [editingTags, setEditingTags] = useState(false);
  const [tagging, setTagging] = useState(false);
  const tags = project ? tagList(state.prefs, project.repo_path) : [];
  // A search and chips belong to the project they were set in. A tag looked
  // for across projects (the sidebar's "#tag", or ⌘K) turns its chip on.
  useEffect(() => setQuery(""), [project?.id]);
  useEffect(() => {
    const s = getState();
    const p = s.selectedProject ? s.projects[s.selectedProject] : undefined;
    setChips(p ? chipFor(s.tagFilter, tagList(s.prefs, p.repo_path)) : []);
  }, [project?.id, state.tagFilter]);
  // A chip whose tag was deleted or renamed lets go.
  const tagKey = tags.join("\n");
  const on = useMemo(() => chips.filter((t) => tags.includes(t)), [chips, tagKey]);
  const filter = useMemo((): Filter => ({ terms, tags: on, prefs: state.prefs }), [terms, on, state.prefs]);
  const threads = useMemo(() => {
    const wts = new Set(worktrees.map((w) => w.id));
    return Object.values(state.agents).filter((a) => wts.has(a.worktree_id));
  }, [state.agents, worktrees]);
  const counts = useMemo(
    () => (project ? tagCounts(threads, state.prefs, project.repo_path) : new Map<string, number>()),
    [threads, state.prefs, project],
  );
  // The first row a search or chip shows, top to bottom: Enter opens it.
  const firstMatch = useMemo((): SessionRef | null => {
    if (!filtering(filter)) return null;
    for (const wt of worktrees) {
      const agents = [...worktreeAgents(state, wt.id), ...worktreeAgents(state, wt.id, true)];
      const a = agents.find((a) => agentMatches(a, wt, filter));
      if (a) return { Agent: a.id };
      const t = worktreeTerminals(state, wt.id).find((t) => terminalMatches(t, wt, filter));
      if (t) return { Terminal: t.id };
    }
    return null;
  }, [state, worktrees, filter]);

  const bandsRef = useRef<HTMLDivElement>(null);
  const [pickedIds, setPicked] = useState<Set<string>>(() => new Set());
  // Where a ⇧-click range starts: the last row clicked without ⇧.
  const anchor = useRef<string | null>(null);
  const picked = useMemo(() => [...pickedIds].map((id) => state.agents[id]).filter(Boolean), [pickedIds, state.agents]);
  const clearPicks = () => setPicked(new Set());
  // Picks out of sight mustn't be acted on: a new project or search drops them.
  useEffect(() => {
    clearPicks();
    anchor.current = null;
  }, [project?.id, query, on]);
  const openAgent = state.selectedSession && "Agent" in state.selectedSession ? state.selectedSession.Agent : null;
  const picks: Picks = {
    ids: pickedIds,
    click: (e, id) => {
      if (e.shiftKey) {
        // The range runs in the order the rows are shown, across branches.
        const rows = [...(bandsRef.current?.querySelectorAll<HTMLElement>("[data-agent]") ?? [])].map((el) => el.dataset.agent!);
        const from = rows.indexOf(anchor.current ?? openAgent ?? id);
        const to = rows.indexOf(id);
        const range = from < 0 ? [id] : rows.slice(Math.min(from, to), Math.max(from, to) + 1);
        setPicked(new Set(e.metaKey ? [...pickedIds, ...range] : range));
        return true;
      }
      if (e.metaKey) {
        anchor.current = id;
        // The first ⌘-click keeps the open task in, as Finder keeps its selection.
        const next = new Set(pickedIds.size || !openAgent || !state.agents[openAgent] ? pickedIds : [openAgent]);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setPicked(next);
        return true;
      }
      anchor.current = id;
      if (pickedIds.size) clearPicks();
      return false;
    },
  };
  // Esc lets go of the picks, unless it's meant for a terminal or a field.
  useEffect(() => {
    if (!pickedIds.size) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key !== "Escape" || (el && el !== document.body && !el.closest(".bands"))) return;
      clearPicks();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickedIds.size]);

  // ⌘F finds a task, unless usage or settings lie over the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey || e.key !== "f" || getState().view !== "sessions") return;
      // In the Read view, ⌘F finds in the thread instead.
      if (document.activeElement?.closest(".reader")) return;
      e.preventDefault();
      searchBox.current?.focus();
      searchBox.current?.select();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Right-clicking one of several picked tasks acts on all of them.
  const onMenu: OpenMenu = (e, target) =>
    "Agent" in target && pickedIds.has(target.Agent.id) && picked.length > 1
      ? rowMenu.openForMany(e, picked, clearPicks)
      : rowMenu.openFor(e, target);

  if (!project) {
    return (
      <section className="sessions sessions-empty">
        <p>{state.loaded ? "Pick a project on the left." : "Loading projects…"}</p>
      </section>
    );
  }

  return (
    <section
      className={`sessions${colorStyle ? " has-color" : ""}`}
      style={colorStyle}
      aria-label={`${project.name} sessions`}
    >
      <header className="sessions-head" data-tauri-drag-region>
        <ProjectPlate projectId={project.id} seed={project.repo_path} />
        <div className="sessions-title" data-tauri-drag-region>
          <h1>
            <ProjectIcon project={project} size={22} />
            {project.name}
          </h1>
          <p className="sessions-path" title={project.repo_path}>
            {project.repo_path.replace(/^\/Users\/[^/]+/, "~")}
          </p>
          <ProjectIdeas repo={project.repo_path} />
        </div>
        <div className="sessions-actions">
          <button className="icon-btn" title="Hide tasks (⌥⌘B)" aria-label="Hide tasks" onClick={onHide}>
            <PanelGlyph />
          </button>
          {worktrees[0]?.is_main && <ProjectRun worktree={worktrees[0]} />}
          <button className="btn btn-primary" onClick={() => onNewTask()} title="New task (⌘N)">
            New task
          </button>
        </div>
      </header>

      {state.missingProjects[project.id] && (
        <div className="folder-missing" role="alert">
          <span>
            This project's folder isn't at <code>{project.repo_path.replace(/^\/Users\/[^/]+/, "~")}</code> any more.
            Renamed or moved it? Point the project at its new place.
          </span>
          <button className="btn btn-sm" onClick={() => void locateProject(project)}>
            Locate…
          </button>
        </div>
      )}

      {/* Before the project has a tag, only the link to make some. */}
      <div className="thread-chips" role="group" aria-label="Show threads tagged">
        {tags.map((t) => (
          <TagChip
            key={t}
            repo={project.repo_path}
            tag={t}
            on={on.includes(t)}
            title={
              on.includes(t)
                ? on.length > 1
                  ? `Stop narrowing to #${t}`
                  : "Show every thread again"
                : on.length
                  ? `Narrow to threads tagged #${t} too`
                  : `Show only threads tagged #${t}`
            }
            onClick={() => setChips(toggleChip(on, t))}
          >
            <span className="thread-chip-count">{counts.get(t) ?? 0}</span>
          </TagChip>
        ))}
        <button
          className={`link-btn thread-chips-edit${tags.length ? "" : " is-alone"}`}
          title="Add, rename or delete this project's tags for its threads"
          onClick={() => setEditingTags(true)}
        >
          Edit tags…
        </button>
        {tags.length > 0 && project && (
          <button
            className="link-btn thread-chips-edit"
            title="Have the tagging command tag this project's untagged threads now"
            disabled={tagging}
            onClick={() => {
              setTagging(true);
              void tagProjectNow(project.repo_path).finally(() => setTagging(false));
            }}
          >
            {tagging ? "Tagging…" : "Tag untagged"}
          </button>
        )}
      </div>

      <div className="sessions-search">
        <input
          ref={searchBox}
          type="search"
          placeholder="Search tasks"
          aria-label="Search tasks"
          aria-keyshortcuts="Meta+F"
          title="Search tasks by name, prompt, agent, model or branch (⌘F)"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (query) setQuery("");
              else e.currentTarget.blur();
            } else if (e.key === "Enter" && firstMatch) {
              e.preventDefault();
              setState({ selectedSession: firstMatch });
            }
          }}
        />
        {query ? (
          <button
            className="sessions-search-clear"
            title="Clear search (Esc)"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              searchBox.current?.focus();
            }}
          >
            ×
          </button>
        ) : (
          <kbd>⌘F</kbd>
        )}
      </div>

      <PicksContext.Provider value={picks}>
      <div className="bands" ref={bandsRef} onMouseOver={preview.onMouseOver} onMouseLeave={preview.onMouseLeave}>
        {worktrees.map((wt) => (
          <Band key={wt.id} worktree={wt} filter={filter} onNewTask={onNewTask} onMenu={onMenu} />
        ))}
        {on.length > 0 && !firstMatch ? (
          <p className="sessions-no-match">
            No threads tagged {on.map((t) => `#${t}`).join(" and ")}
            {terms.length > 0 && <> match “{query.trim()}”</>}.{" "}
            <button className="link-btn" onClick={() => setChips([])}>
              Show all
            </button>
          </p>
        ) : (
          terms.length > 0 && !firstMatch && <p className="sessions-no-match">No tasks match “{query.trim()}”.</p>
        )}
      </div>
      </PicksContext.Provider>
      {picked.length > 1 && <PickBar agents={picked} onClear={clearPicks} />}
      {rowMenu.element}
      {preview.element}
      {editingTags && <TagListDialog repo={project.repo_path} onClose={() => setEditingTags(false)} />}
    </section>
  );
}

type OpenMenu = ReturnType<typeof useRowMenu>["openFor"];

function Band({
  worktree,
  filter,
  onNewTask,
  onMenu,
}: {
  worktree: Worktree;
  filter: Filter;
  onNewTask: NewTask;
  onMenu: OpenMenu;
}) {
  const state = useAppState();
  const [showArchived, setShowArchived] = useState(false);
  // A filtered list is no order to drag rows into.
  const searching = filtering(filter);
  const reorder = useReorder((id, to, seen) => {
    const a = getState().agents[id];
    if (a) void moveTask(a, to, seen);
  }, !searching);
  // Mid-drag, rows keep the order the drag began with.
  const sorted = worktreeAgents(state, worktree.id);
  const ordered = reorder.frozen
    ? [...sorted].sort((a, b) => rank(reorder.frozen!, a.id) - rank(reorder.frozen!, b.id))
    : sorted;
  const agents = searching ? ordered.filter((a) => agentMatches(a, worktree, filter)) : ordered;
  const allArchived = worktreeAgents(state, worktree.id, true);
  const archived = searching ? allArchived.filter((a) => agentMatches(a, worktree, filter)) : allArchived;
  const allTerminals = worktreeTerminals(state, worktree.id);
  const terminals = searching ? allTerminals.filter((t) => terminalMatches(t, worktree, filter)) : allTerminals;
  // Picking an archived task elsewhere (the follow-up list) shows it here;
  // archiving the open one leaves the list as it was.
  const selectedId = state.selectedSession && "Agent" in state.selectedSession ? state.selectedSession.Agent : null;
  const selectedArchived = archived.some((a) => a.id === selectedId);
  useEffect(() => {
    if (selectedArchived) setShowArchived(true);
    // Only on a pick (each makes a new selection, even of the same task),
    // not when the open task becomes archived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedSession]);
  const git = state.git[worktree.id];

  if (searching && !agents.length && !archived.length && !terminals.length) return null;
  // A search or chip shows the archived tasks it finds without being asked.
  const archivedOpen = showArchived || searching;

  return (
    <section className="band">
      <header className="band-head">
        <span className="band-title">
          <span className="band-branch" title={worktree.path}>
            <BranchGlyph />
            <span className="band-branch-name" dir="auto">{worktree.branch}</span>
          </span>
          {worktree.is_main && <span className="band-note">main checkout</span>}
          <CompareLink worktreeId={worktree.id} />
          <BandCost worktreeId={worktree.id} />
        </span>
        <span className="band-actions">
          {git && !("error" in git) && <ShipButton worktree={worktree} git={git} />}
          {!worktree.is_main && <BandRunButton worktree={worktree} />}
          <EditorButton worktree={worktree} />
          <button
            className="icon-btn"
            title="New shell in this checkout"
            aria-label={`New shell in ${worktree.branch}`}
            onClick={() =>
              request("CreateTerminal", { worktree: worktree.id, name: null }).then((c) => {
                if (c && "Terminal" in c) setState({ selectedSession: { Terminal: c.Terminal } });
              })
            }
          >
            <ShellGlyph />
          </button>
          <button
            className="icon-btn"
            title={`New task on ${worktree.branch}`}
            aria-label={`New task on ${worktree.branch}`}
            onClick={() => onNewTask(worktree.id)}
          >
            +
          </button>
        </span>
      </header>
      {git && <GitLine git={git} worktree={worktree} />}
      {git && !("error" in git) && <PrLine worktree={worktree} git={git} />}
      <BandRunLine worktree={worktree} />

      <ul className="rows" ref={reorder.list}>
        {agents.map((a, i) => (
          <li key={a.id} {...reorder.item(a.id)}>
            <AgentRow
              agent={a}
              onMenu={onMenu}
              onKeyDown={searching ? undefined : (e) => reorderKey(e, i, agents.length, (to) => void moveTask(a, to))}
            />
          </li>
        ))}
        {terminals.map((t) => (
          <li key={t.id}>
            <TerminalRow tab={t} onMenu={onMenu} />
          </li>
        ))}
        {!searching && agents.length === 0 && terminals.length === 0 && (
          <li className="rows-empty">
            <button className="link-btn" onClick={() => onNewTask(worktree.id)}>
              Start a task on this branch
            </button>
          </li>
        )}
      </ul>

      {archived.length > 0 && (
        <>
          {!searching && (
            <button className="archived-toggle" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide" : "Show"} {archived.length} archived
            </button>
          )}
          {archivedOpen && (
            <ul className="rows rows-archived">
              {archived.map((a) => (
                <li key={a.id}>
                  <AgentRow agent={a} onMenu={onMenu} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** What can be done to the picked tasks, and how many there are. */
function PickBar({ agents, onClear }: { agents: Agent[]; onClear: () => void }) {
  const live = agents.filter((a) => !a.archived);
  const gone = agents.filter((a) => a.archived);
  const [busy, setBusy] = useState(false);
  const [tagging, setTagging] = useState(false);
  const run = (which: Agent[], archived: boolean) => {
    setBusy(true);
    void setArchived(which, archived).then(() => {
      setBusy(false);
      onClear();
    });
  };
  return (
    <div className="pick-bar" role="toolbar" aria-label="Selected tasks">
      <span className="pick-count">{agents.length} selected</span>
      {live.length > 0 && (
        <button className="btn btn-sm" disabled={busy} onClick={() => run(live, true)}>
          Archive{gone.length ? ` ${live.length}` : ""}
        </button>
      )}
      {gone.length > 0 && (
        <button className="btn btn-sm" disabled={busy} onClick={() => run(gone, false)}>
          Unarchive{live.length ? ` ${gone.length}` : ""}
        </button>
      )}
      <button className="btn btn-sm" onClick={() => setTagging(true)} title="Tag or untag them all at once">
        Tags…
      </button>
      <button className="btn btn-sm" onClick={onClear} title="Clear selection (Esc)">
        Clear
      </button>
      {tagging && <ThreadTagsDialog agents={agents} onClose={() => setTagging(false)} />}
    </div>
  );
}

/** Where `id` stands in `ids`; those missing go last. */
function rank(ids: string[], id: string): number {
  const i = ids.indexOf(id);
  return i < 0 ? ids.length : i;
}

/** What this branch's tasks have cost (30 days), from local agent logs. */
function BandCost({ worktreeId }: { worktreeId: string }) {
  const state = useAppState();
  const costs = useSessionCosts();
  let total = 0;
  for (const a of Object.values(state.agents)) {
    if (a.worktree_id === worktreeId && a.session_id) total += costs.get(sessionKey(a.kind, a.session_id)) ?? 0;
  }
  if (total < 0.01) return null;
  return (
    <span className="band-cost" title="Known estimated cost for this branch’s tasks over the last 30 days">
      {money(total)}
    </span>
  );
}

/** A fanned-out attempt links to the comparison of its group. */
function CompareLink({ worktreeId }: { worktreeId: string }) {
  const state = useAppState();
  const group = fanOutOf(state, worktreeId);
  if (!group) return null;
  const n = group.worktrees.filter((id) => state.worktrees[id]).length;
  return (
    <button className="band-compare" onClick={() => openCompare(group.id)} title={`One of ${n} attempts at: ${group.prompt}`}>
      1 of {n} · Compare
    </button>
  );
}

/** A checkout whose folder was deleted outside nebula: git can't say
 *  anything about it, so offer to take it off the list instead. */
function MissingLine({ worktree }: { worktree: Worktree }) {
  const [dialog, setDialog] = useState<ConfirmDialogSpec | null>(null);
  const remove = () =>
    setDialog({
      kind: "confirm",
      title: `Remove ${worktree.branch} from the list?`,
      message: `Its folder at ${worktree.path} is already gone. The sessions in it are removed too. The branch stays.`,
      confirm: "Remove",
      onConfirm: () => request("DeleteWorktree", { id: worktree.id, force: true }).then(() => {}),
    });
  return (
    <>
      <p className="git-line" title={worktree.path}>
        <span className="git-warn">The folder is gone</span>
        <button className="link-btn" onClick={remove}>
          Remove from list
        </button>
      </p>
      {dialog && <ConfirmDialog d={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Where the branch's code stands, in the order it matters: conflicts, then
 *  uncommitted work, then commits that aren't on the remote yet. */
function GitLine({ git, worktree }: { git: GitState; worktree: Worktree }) {
  if ("error" in git && git.missing) return <MissingLine worktree={worktree} />;
  if ("error" in git) {
    return (
      <p className="git-line" title={git.error}>
        <span className="git-muted">git: {git.error.split("\n")[0]}</span>
      </p>
    );
  }
  const files = changedFiles(git);
  const commits = (n: number) => `${n} ${n === 1 ? "commit" : "commits"}`;
  const parts: React.ReactNode[] = [];
  if (!git.branch) parts.push(<span className="git-muted">Detached HEAD</span>);
  if (git.conflicted > 0) parts.push(<span className="git-warn">{git.conflicted} in conflict</span>);
  if (files > 0)
    parts.push(
      <span title={`${git.staged} staged, ${git.unstaged} modified, ${git.untracked} untracked`}>
        {files} {files === 1 ? "file" : "files"} changed
        {(git.insertions > 0 || git.deletions > 0) && (
          <>
            {" "}
            <span className="git-add" aria-hidden>
              +{git.insertions}
            </span>{" "}
            <span className="git-del" aria-hidden>
              −{git.deletions}
            </span>
            <span className="sr-only">
              , {git.insertions} lines added, {git.deletions} removed
            </span>
          </>
        )}
      </span>,
    );
  if (git.ahead > 0 && !git.upstreamGone)
    parts.push(
      <span className="git-push">
        <span aria-hidden>↑{git.ahead} to push</span>
        <span className="sr-only">{commits(git.ahead)} to push</span>
      </span>,
    );
  if (neverPushed(git, worktree))
    parts.push(<span className="git-push">{commits(git.baseAhead ?? 0)}, never pushed</span>);
  if (git.upstreamGone)
    parts.push(
      <span className="git-muted" title={`${git.upstream} no longer exists on the remote`}>
        Remote branch deleted, merged?
      </span>,
    );
  if (git.behind > 0 && !git.upstreamGone)
    parts.push(
      <span title={`${git.upstream} has commits this branch lacks`}>
        <span aria-hidden>↓{git.behind} behind</span>
        <span className="sr-only">
          {commits(git.behind)} behind {git.upstream}
        </span>
      </span>,
    );
  if (parts.length === 0)
    parts.push(<span className="git-muted">{git.upstream ? "Clean, pushed" : "Clean"}</span>);
  const reviewable = files > 0 || (!worktree.is_main && (git.baseAhead ?? 0) > 0);
  if (reviewable)
    parts.push(
      <button
        className="link-btn git-review"
        onClick={() => openReview(worktree.id)}
        title={files > 0 ? "Review the uncommitted changes" : "Review what this branch changed"}
      >
        Review
      </button>,
    );

  return (
    <p className="git-line">
      {parts.map((p, i) => (
        <span key={i} className="git-part">
          {p}
        </span>
      ))}
      {git.lastCommit && (
        <span className="git-last" title={git.lastCommit.subject}>
          {git.lastCommit.subject}
          <span className="git-age">{relativeTime(git.lastCommit.time * 1000)}</span>
        </span>
      )}
    </p>
  );
}

/** One click to get a branch shipped, by an agent on it. */
export function ShipButton({ worktree, git }: { worktree: Worktree; git: GitStatus }) {
  const state = useAppState();
  const [sending, setSending] = useState(false);
  const kind = shipKind(git, worktree);
  if (!kind || !git.branch) return null;
  const branch = git.branch;
  const taker = takerFor(state, worktree.id);
  const blocked = taker.kind === "busy" || sending;
  const why =
    taker.kind === "busy"
      ? taker.agent.status === "fresh"
        ? `${taker.agent.name} is still starting up`
        : `${taker.agent.name} is still working on this branch`
      : taker.kind === "agent"
        ? `Ask ${taker.agent.name} to ${shipWhat(kind, branch)}`
        : `Start an agent to ${shipWhat(kind, branch)}`;

  return (
    <>
      <button
        className={`btn btn-sm btn-ship${kind === "resolve" ? " is-resolve" : ""}`}
        aria-disabled={blocked}
        aria-label={`${SHIP_LABEL[kind]} ${branch}. ${why}`}
        title={why}
        onClick={async () => {
          if (blocked) {
            flash(why);
            return;
          }
          setSending(true);
          try {
            await runOnWorktree(worktree.id, shipPrompt(kind, git), shipWhat(kind, branch));
          } catch (e) {
            flash(e instanceof Error ? e.message : String(e));
          } finally {
            // The agent takes a moment to report it's running; don't double-send.
            setTimeout(() => setSending(false), 2500);
          }
        }}
      >
        <UpGlyph />
        {sending ? "Sending…" : SHIP_LABEL[kind]}
      </button>
      <span className="sr-only" aria-live="polite">
        {sending ? `Sending to ${taker.kind === "agent" ? taker.agent.name : "a new agent"}` : ""}
      </span>
    </>
  );
}

function AgentRow({
  agent,
  onMenu,
  onKeyDown,
}: {
  agent: Agent;
  onMenu: OpenMenu;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const state = useAppState();
  const selected = sameSession(state.selectedSession, { Agent: agent.id });
  const prompt = lastPrompt(agent);
  const detail = prompt || [agent.model, agent.effort].filter(Boolean).join(", ");
  const pinned = !agent.archived && isPinned(state, agent);
  const flagged = isFollowUp(state, agent.id);
  const priority = agent.archived ? undefined : state.prefs.taskPriorities?.[agent.id];
  const colorStyle = useTaskColorStyle(agent);
  const picks = useContext(PicksContext);
  const isPicked = picks?.ids.has(agent.id) ?? false;
  const usual = useMemo(() => usualHarness(Object.values(state.agents)), [state.agents]);
  const safe = useVerdict(agent)?.tone === "done";
  return (
    <button
      className={`row row-${agent.status}${selected ? " is-selected" : ""}${isPicked ? " is-picked" : ""}${agent.unseen ? " is-unseen" : ""}${colorStyle ? " has-color" : ""}`}
      data-agent={agent.id}
      style={colorStyle}
      onClick={(e) => picks?.click(e, agent.id) || setState({ selectedSession: { Agent: agent.id } })}
      onContextMenu={(e) => onMenu(e, { Agent: agent })}
      aria-pressed={picks?.ids.size ? isPicked : undefined}
      onKeyDown={(e) => {
        // F flags the task to come back to, or clears the flag; P steps its priority.
        const bare = e.target === e.currentTarget && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey;
        if (bare && e.key === "f") {
          e.preventDefault();
          void toggleFlag(agent);
        } else if (bare && e.key === "p" && !agent.archived) {
          e.preventDefault();
          void cyclePriority(agent);
        } else onKeyDown?.(e);
      }}
      aria-current={selected ? "true" : undefined}
      aria-keyshortcuts={agent.archived ? "F" : "F P Alt+ArrowUp Alt+ArrowDown"}
    >
      <span
        className={`sdot has-plate dot-${agent.status}${agent.unseen ? " is-unseen" : ""}`}
        title={statusLabel(agent)}
        aria-label={statusLabel(agent)}
      >
        <Plate seed={agent.id} work={agent.recent_prompts.length} tone={plateTone(agent)} size={18} drift={agent.status === "running"} />
      </span>
      <span className="row-main">
        <span className="row-name">
          <PriorityMark priority={priority} />
          {agent.name}
        </span>
        <span className="row-detail" title={agentSpec(agent)}>
          {/* The usual harness goes without saying; another one is named. */}
          {usual !== harnessLabel(agent) && (
            <>
              <span className="row-agent">{harnessLabel(agent)}</span>
              {detail && <span className="row-detail-separator" aria-hidden>·</span>}
            </>
          )}
          {detail && <span className="row-prompt">{detail}</span>}
        </span>
      </span>
      <span className="row-age">
        <AgentServerMark agentId={agent.id} />
        <TagMarks agent={agent} />
        {safe && (
          <span className="row-mark mark-safe" role="img" title="Its last reply says it's safe to close" aria-label="Safe to close">
            ✓
          </span>
        )}
        {flagged && (
          <span className="row-mark mark-flag" role="img" title="Flagged for follow-up (F)" aria-label="Flagged for follow-up">
            <FlagGlyph />
          </span>
        )}
        {pinned && (
          <span className="row-mark" role="img" title="Pinned: stays where you put it. Unpin from its menu." aria-label="Pinned">
            <PinGlyph />
          </span>
        )}
        {relativeTime(agent.status_changed_at)}
      </span>
    </button>
  );
}

function TerminalRow({ tab, onMenu }: { tab: TerminalTab; onMenu: OpenMenu }) {
  const selected = sameSession(useAppState().selectedSession, { Terminal: tab.id });
  return (
    <button
      className={`row row-terminal${selected ? " is-selected" : ""}`}
      onClick={() => setState({ selectedSession: { Terminal: tab.id } })}
      onContextMenu={(e) => onMenu(e, { Terminal: tab })}
    >
      <span className="row-glyph" aria-hidden>
        <ShellGlyph />
      </span>
      <span className="row-main">
        <span className="row-name">{tab.name}</span>
        <span className="row-prompt">
          {tab.run_command ?? (tab.alive ? "Shell" : "Shell, not running")}
        </span>
      </span>
    </button>
  );
}

function BranchGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M5 3.25a1.75 1.75 0 1 1-2.5 1.58v6.34a1.75 1.75 0 1 1 1.5 0V9.5c0-1.38 1.12-2.5 2.5-2.5h2A1.5 1.5 0 0 0 10 5.5v-.67a1.75 1.75 0 1 1 1.5 0v.67a3 3 0 0 1-3 3h-2A1 1 0 0 0 5.5 9.5v1.67A1.75 1.75 0 0 1 5 3.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function UpGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 13V3.5M3.5 8 8 3.5 12.5 8"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShellGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        d="m3 4.5 3.5 3.5L3 11.5M8.5 12H13"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The project's plate: moved by every prompt across its threads, and
 *  drifting while any of them runs. */
function ProjectPlate({ projectId, seed }: { projectId: string; seed: string }) {
  const agents = projectAgents(useAppState(), projectId);
  return (
    <Plate
      className="sessions-plate"
      seed={seed}
      work={agents.reduce((n, a) => n + a.recent_prompts.length, 0)}
      tone="sand"
      size={64}
      drift={agents.some((a) => a.status === "running")}
    />
  );
}
