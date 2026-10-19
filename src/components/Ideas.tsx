import { useMemo, useRef, useState } from "react";
import { parseTags } from "../nebula/folders";
import {
  dueLabel,
  due,
  filterIdeas,
  groupIdeas,
  isOpen,
  localDay,
  PRIORITIES,
  PRIORITY_LABEL,
  sortIdeas,
  type Idea,
  type Priority,
  type SortBy,
} from "../nebula/ideaList";
import { addIdea, deleteIdeas, openIdeas, setDone, setIdeasFocus, updateIdea, useIdeasFocus } from "../nebula/ideas";
import { relativeTime } from "../nebula/status";
import { setState, sortedProjects, useAppState } from "../nebula/store";
import { ConfirmDialog, type ConfirmDialogSpec } from "./Dialogs";
import { useOverlayKeys } from "./Overlay";

const UNSORTED = "unsorted";

/** Where an idea came from, said in a few words. */
function sourceLabel(i: Idea, agentName: (id: string) => string | undefined): string | null {
  if (!i.source) return null;
  if (i.source.kind === "thread") {
    const name = i.source.agent ? agentName(i.source.agent) : undefined;
    return name ? `from ${name}` : "from a thread";
  }
  return { capture: "from quick capture", dispatch: "from Dispatch", ideas: null }[i.source.kind] ?? null;
}

/** Things to do that you don't want to start yet, by project, with a
 *  priority and a deadline: write them down, sort them, start one as a task
 *  or send several to Dispatch. */
export function IdeasView({ onStart, onDispatch }: { onStart: (idea: Idea) => void; onDispatch: (ideas: Idea[]) => void }) {
  const state = useAppState();
  const ideas = state.prefs.ideas ?? [];
  const projects = useMemo(() => sortedProjects(state), [state]);
  const byRepo = useMemo(() => new Map(projects.map((p) => [p.repo_path, p])), [projects]);
  const focus = useIdeasFocus();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"open" | "done">("open");
  const [sort, setSort] = useState<SortBy>("priority");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<ConfirmDialogSpec | null>(null);
  const controls = useRef<HTMLDivElement>(null);
  useOverlayKeys(controls);
  const today = localDay();

  const shown = sortIdeas(filterIdeas(ideas, { query, project: focus, show }, today), sort, today);
  const groups = groupIdeas(shown, projects.map((p) => p.repo_path));
  const open = ideas.filter(isOpen);
  const late = open.filter((i) => due(i, today) === "overdue").length;
  const soon = open.filter((i) => due(i, today) === "soon").length;
  const picked = ideas.filter((i) => selected.has(i.id));
  const nameOf = (repo: string | null) => (repo === null ? "Unsorted" : (byRepo.get(repo)?.name ?? repo.split("/").pop() ?? repo));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <section className="usage ideas" aria-labelledby="ideas-title">
      <header className="usage-head" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 id="ideas-title">Ideas</h1>
          <p className="usage-sub">
            {open.length
              ? [`${open.length} to start`, late && `${late} overdue`, soon && `${soon} due soon`].filter(Boolean).join(" · ")
              : "Nothing waiting to start. Write ideas here, or save them from quick capture or a thread."}
          </p>
        </div>
        <div className="usage-controls" ref={controls}>
          <input
            className="ideas-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ideas, or #tag"
            aria-label="Search ideas"
            title="Find ideas by their words, or #tag for a tag"
            spellCheck={false}
          />
          <select
            value={focus ?? ""}
            onChange={(e) => setIdeasFocus(e.target.value || undefined)}
            aria-label="Project"
            title="Show the ideas of one project, or Unsorted"
          >
            <option value="">Every project</option>
            <option value={UNSORTED}>Unsorted</option>
            {projects.map((p) => (
              <option key={p.id} value={p.repo_path}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Sort by">
            {(["priority", "deadline", "newest"] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={sort === s}
                className={sort === s ? "is-on" : ""}
                onClick={() => setSort(s)}
                title={
                  s === "priority"
                    ? "Overdue first, then High to none, the nearest deadline breaking ties"
                    : s === "deadline"
                      ? "Overdue first, then the nearest deadline; ideas without one last"
                      : "The newest ideas first"
                }
              >
                {s === "priority" ? "Priority" : s === "deadline" ? "Deadline" : "Newest"}
              </button>
            ))}
          </div>
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Show">
            {(["open", "done"] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={show === s}
                className={show === s ? "is-on" : ""}
                onClick={() => setShow(s)}
                title={s === "open" ? "Ideas still to start" : "Ideas you've marked done or started as tasks"}
              >
                {s === "open" ? "To start" : "Done"}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={() => setState({ view: "sessions" })} title="Back to sessions (Esc)">
            Done
          </button>
        </div>
      </header>

      <div className="usage-body">
        {show === "open" && <NewIdea projects={projects} focus={focus} />}

        {groups.map((g) => (
          <section key={g.project ?? UNSORTED} className="ideas-group" aria-label={nameOf(g.project)}>
            <h2>
              {nameOf(g.project)} <span className="ideas-count">{g.ideas.length}</span>
            </h2>
            <ul>
              {g.ideas.map((i) => (
                <IdeaRow
                  key={i.id}
                  idea={i}
                  today={today}
                  projects={projects}
                  selected={selected.has(i.id)}
                  onSelect={() => toggle(i.id)}
                  onStart={() => onStart(i)}
                  source={sourceLabel(i, (id) => state.agents[id]?.name)}
                  startedName={i.startedAs && i.startedAs !== "dispatch" ? state.agents[i.startedAs]?.name : undefined}
                  onDelete={() =>
                    setDialog({
                      kind: "confirm",
                      title: "Delete this idea?",
                      message: `“${i.text.length > 120 ? `${i.text.slice(0, 120)}…` : i.text}” goes for good.`,
                      confirm: "Delete",
                      onConfirm: async () => void (await deleteIdeas([i.id])),
                    })
                  }
                />
              ))}
            </ul>
          </section>
        ))}
        {!shown.length && (ideas.length > 0 || show === "done") && (
          <p className="usage-empty">{query || focus ? "No idea matches." : show === "done" ? "Nothing done yet." : ""}</p>
        )}
      </div>

      {picked.length > 0 && (
        <footer className="ideas-bar" role="toolbar" aria-label="Selected ideas">
          <span>{picked.length} selected</span>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              onDispatch(picked);
              setSelected(new Set());
            }}
            title="Send them to Dispatch as a list: it suggests a project for each and starts the agents a few at a time"
          >
            Dispatch them
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              void setDone([...selected], show === "open");
              setSelected(new Set());
            }}
            title={show === "open" ? "Mark them done without starting them" : "Back to the ideas to start"}
          >
            {show === "open" ? "Mark done" : "Reopen"}
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              setDialog({
                kind: "confirm",
                title: `Delete ${picked.length} ${picked.length === 1 ? "idea" : "ideas"}?`,
                message: "They go for good.",
                confirm: "Delete",
                onConfirm: async () => {
                  await deleteIdeas([...selected]);
                  setSelected(new Set());
                },
              })
            }
          >
            Delete
          </button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </footer>
      )}
      {dialog && <ConfirmDialog d={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

/** The line at the top for writing one down. */
function NewIdea({ projects, focus }: { projects: { id: string; name: string; repo_path: string }[]; focus: string | undefined }) {
  const [text, setText] = useState("");
  const [project, setProject] = useState<string>(focus && focus !== UNSORTED ? focus : "");
  const [priority, setPriority] = useState<Priority | "">("");
  const [deadline, setDeadline] = useState("");
  const add = async () => {
    if (!text.trim()) return;
    const made = await addIdea(text, project || null, { kind: "ideas" }, { priority: priority || null, deadline: deadline || null });
    if (made) {
      setText("");
      setDeadline("");
    }
  };
  return (
    <form
      className="ideas-new"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write an idea down…"
        aria-label="New idea"
        title="Something to do later. Return saves it."
        spellCheck={false}
      />
      <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" title="The project it's for, or Unsorted">
        <option value="">Unsorted</option>
        {projects.map((p) => (
          <option key={p.id} value={p.repo_path}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")} aria-label="Priority" title="How much it matters">
        <option value="">No priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
      <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Deadline" title="When it should be done by (optional)" />
      <button className="btn btn-sm" type="submit" disabled={!text.trim()}>
        Add
      </button>
    </form>
  );
}

function IdeaRow({
  idea,
  today,
  projects,
  selected,
  onSelect,
  onStart,
  onDelete,
  source,
  startedName,
}: {
  idea: Idea;
  today: string;
  projects: { id: string; name: string; repo_path: string }[];
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onDelete: () => void;
  source: string | null;
  startedName: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [dating, setDating] = useState(false);
  const [text, setText] = useState(idea.text);
  const [tags, setTags] = useState((idea.tags ?? []).join(", "));
  const when = due(idea, today);
  const open = isOpen(idea);
  const save = () => {
    void updateIdea(idea.id, { text: text.trim() || idea.text, tags: parseTags(tags) });
    setEditing(false);
  };

  return (
    <li className={`idea${selected ? " is-selected" : ""}${open ? "" : " is-done"}`}>
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select “${idea.text}”`} title="Select it, to dispatch or mark several at once" />
      <div className="idea-main">
        {editing ? (
          <div className="idea-edit">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(6, Math.max(2, text.split("\n").length))}
              aria-label="Idea"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) save();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setText(idea.text);
                  setEditing(false);
                }
              }}
            />
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags: ui, docs" aria-label="Tags" spellCheck={false} />
            <div className="idea-edit-foot">
              <button className="btn btn-sm btn-primary" onClick={save} title="Save the changes (⌘↵)">
                Save
              </button>
              <button className="btn btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="link-btn idea-delete" onClick={onDelete}>
                Delete idea
              </button>
            </div>
          </div>
        ) : (
          <button className="idea-text" onClick={() => setEditing(true)} title="Edit it: its words and tags">
            {idea.text}
          </button>
        )}
        <div className="idea-meta">
          <select
            className={`idea-prio${idea.priority ? ` is-${idea.priority}` : ""}`}
            value={idea.priority ?? ""}
            onChange={(e) => void updateIdea(idea.id, { priority: (e.target.value as Priority) || null })}
            aria-label="Priority"
            title="How much it matters"
          >
            <option value="">No priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          {idea.deadline || dating ? (
            <label className={`idea-due${when ? ` is-${when}` : ""}`} title="When it should be done by. Clear the date to have none.">
              <input
                type="date"
                value={idea.deadline ?? ""}
                autoFocus={dating && !idea.deadline}
                onChange={(e) => void updateIdea(idea.id, { deadline: e.target.value || null })}
                onBlur={() => setDating(false)}
                aria-label="Deadline"
              />
              {idea.deadline && open && <span>{dueLabel(idea.deadline, today)}</span>}
            </label>
          ) : (
            open && (
              <button className="link-btn idea-add-due" onClick={() => setDating(true)} title="Give it a date to be done by">
                Add deadline
              </button>
            )
          )}
          <select
            className="idea-project"
            value={idea.project ?? ""}
            onChange={(e) => void updateIdea(idea.id, { project: e.target.value || null })}
            aria-label="Project"
            title="Move it to another project, or Unsorted"
          >
            <option value="">Unsorted</option>
            {projects.map((p) => (
              <option key={p.id} value={p.repo_path}>
                {p.name}
              </option>
            ))}
          </select>
          {(idea.tags ?? []).map((t) => (
            <span key={t} className="idea-tag">
              #{t}
            </span>
          ))}
          {source && <span className="idea-source">{source}</span>}
          <span className="idea-age" title={new Date(idea.createdAt).toLocaleString()}>
            {relativeTime(idea.createdAt)}
          </span>
          {!open && (
            <span className="idea-source">
              {idea.startedAs === "dispatch" ? "sent to Dispatch" : idea.startedAs ? `started as ${startedName ?? "a task"}` : "done"}
            </span>
          )}
        </div>
      </div>
      <div className="idea-actions">
        {open ? (
          <>
            <button className="btn btn-sm" onClick={onStart} title="Start it as a task: the new-task box opens with it written in">
              Start
            </button>
            <button className="icon-btn" onClick={() => void setDone([idea.id], true)} aria-label="Mark done" title="Done, without starting it">
              ✓
            </button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={() => void setDone([idea.id], false)} title="Back to the ideas to start">
            Reopen
          </button>
        )}
      </div>
    </li>
  );
}

/** The sidebar's way in, beside Uncommitted: how many ideas wait, and how
 *  many are late. Always there, so there's somewhere to write the first one. */
export function IdeasEntry() {
  const state = useAppState();
  const open = (state.prefs.ideas ?? []).filter(isOpen);
  const today = localDay();
  const late = open.filter((i) => due(i, today) === "overdue").length;
  const on = state.view === "ideas";
  return (
    <button
      className={`uc-entry${on ? " is-on" : ""}`}
      onClick={() => (on ? setState({ view: "sessions" }) : openIdeas())}
      title="Ideas: things written down to start later, by project, with a priority and a deadline (⌘I)"
    >
      <span className="uc-entry-title">
        <BulbGlyph />
        Ideas
      </span>
      <span className="uc-entry-sub">
        {open.length ? `${open.length} to start` : "None yet"}
        {late > 0 && <span className="ideas-late"> · {late} overdue</span>}
      </span>
    </button>
  );
}

/** A light bulb, in outline: Ideas. */
function BulbGlyph() {
  return (
    <svg className="bulb-glyph" width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6 12.25h4M6.5 14.5h3M6 10.5c0-1.2-.6-1.9-1.3-2.7A4.25 4.25 0 1 1 11.3 7.8c-.7.8-1.3 1.5-1.3 2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A project's "Ideas (N)" in its task list, when it has any. */
export function ProjectIdeas({ repo }: { repo: string }) {
  const n = (useAppState().prefs.ideas ?? []).filter((i) => isOpen(i) && i.project === repo).length;
  if (!n) return null;
  return (
    <button className="link-btn sessions-ideas" onClick={() => openIdeas(repo)} title="This project's ideas, written down to start later">
      Ideas ({n})
    </button>
  );
}
