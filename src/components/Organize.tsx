import { useEffect, useRef, useState } from "react";
import { PROJECT_COLORS } from "../nebula/icons";
import { cleanTag } from "../nebula/folders";
import {
  addThreadTag,
  deleteThreadTag,
  followUpAgents,
  isAutoFollowUp,
  renameThreadTag,
  setTaskColor,
  tagThread,
  toggleFlag,
} from "../nebula/organize";
import { PRIORITIES, priorityLabel, type Priority } from "../nebula/priority";
import { tagCounts, tagList, threadTagsOf } from "../nebula/threadtags";
import { relativeTime } from "../nebula/status";
import { flash, getState, projectOfWorktree, projectWorktrees, useAppState } from "../nebula/store";
import type { Agent } from "../nebula/types";
import { useEscape } from "./Dialogs";
import { ProjectDot, selectAgent } from "./Sidebar";

/** The eight colors and "none", as a radio row. */
export function ColorRow({
  value,
  onPick,
  labelledBy,
}: {
  value: string | null;
  onPick: (name: string | null) => void;
  labelledBy: string;
}) {
  return (
    <div className="color-row" role="radiogroup" aria-labelledby={labelledBy}>
      <button
        role="radio"
        aria-checked={!value}
        className={`color-swatch color-none${!value ? " is-on" : ""}`}
        onClick={() => onPick(null)}
        title="No color"
        aria-label="No color"
      />
      {PROJECT_COLORS.map((c) => (
        <button
          key={c.name}
          role="radio"
          aria-checked={value === c.name}
          className={`color-swatch${value === c.name ? " is-on" : ""}`}
          style={{ "--pc": c.hue } as React.CSSProperties}
          onClick={() => onPick(c.name)}
          title={c.name}
          aria-label={c.name}
        />
      ))}
    </div>
  );
}

/** A task's color as `--pc` (its hue), or nothing when it has none. */
export function useTaskColorStyle(agent: Agent): React.CSSProperties | undefined {
  const name = useAppState().prefs.taskColors?.[agent.id];
  const hue = PROJECT_COLORS.find((c) => c.name === name)?.hue;
  return hue === undefined ? undefined : ({ "--pc": hue } as React.CSSProperties);
}

/** Pick a color for a task: one click picks and closes. */
export function TaskColorDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const color = useAppState().prefs.taskColors?.[agent.id] ?? null;
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="dialog dialog-narrow task-color" role="dialog" aria-modal="true" aria-labelledby="task-color-title">
        <h2 id="task-color-title">Color {agent.name}</h2>
        <ColorRow
          value={color}
          labelledBy="task-color-title"
          onPick={(name) => {
            void setTaskColor(agent.id, name).catch((e) => flash(`Couldn't save the color: ${e}`));
            onClose();
          }}
        />
      </div>
    </div>
  );
}

/** Which of its project's tags a thread carries: a checkbox each, and a
 *  field that adds a new one to the project and to the thread. Each change
 *  saves as you make it, as yours. */
export function ThreadTagsDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const state = useAppState();
  const repo = projectOfWorktree(state, agent.worktree_id)?.repo_path;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEscape(onClose, false);
  useEffect(() => field.current?.focus(), [editing]);
  if (!repo) return null;
  if (editing) return <TagListDialog repo={repo} onClose={onClose} />;
  const list = tagList(state.prefs, repo);
  const carried = threadTagsOf(state.prefs, agent.id);

  const toggle = (tag: string, on: boolean) =>
    void tagThread(agent.id, on ? [...carried, tag] : carried.filter((t) => t !== tag));
  const add = async () => {
    const tag = cleanTag(name);
    if (!(await addThreadTag(repo, name))) return;
    setName("");
    const now = threadTagsOf(getState().prefs, agent.id);
    if (!now.includes(tag)) await tagThread(agent.id, [...now, tag]);
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-narrow thread-tags" role="dialog" aria-modal="true" aria-labelledby="thread-tags-title">
        <h2 id="thread-tags-title">Tags on {agent.name}</h2>
        {list.length > 0 ? (
          <ul className="tt-list" aria-labelledby="thread-tags-title">
            {list.map((t) => (
              <li key={t}>
                <label className="tt-check">
                  <input type="checkbox" checked={carried.includes(t)} onChange={(e) => toggle(t, e.target.checked)} />#{t}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dialog-note">This project has no tags yet. Add one below, and it goes on this thread too.</p>
        )}
        <form
          className="tt-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            ref={field}
            className="setting-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New tag"
            aria-label="New tag"
            spellCheck={false}
          />
          <button type="submit" className="btn" disabled={!cleanTag(name)}>
            Add
          </button>
        </form>
        <footer className="dialog-foot">
          <span className="hint">
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              Edit tags…
            </button>
          </span>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Pick a priority for a task or project: one click picks and closes. */
export function PriorityDialog({
  name,
  value,
  onPick,
  onClose,
}: {
  name: string;
  value: Priority | undefined;
  onPick: (priority: Priority | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (p: Priority | null) => {
    void onPick(p).catch((e) => flash(`Couldn't save the priority: ${e}`));
    onClose();
  };
  const choices: { id: Priority | null; label: string }[] = [...PRIORITIES, { id: null, label: "None" }];
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="dialog dialog-narrow task-color" role="dialog" aria-modal="true" aria-labelledby="priority-title">
        <h2 id="priority-title">Priority for {name}</h2>
        <div className="priority-row" role="radiogroup" aria-labelledby="priority-title">
          {choices.map((c) => (
            <button
              key={c.label}
              role="radio"
              aria-checked={(value ?? null) === c.id}
              className={`priority-choice${(value ?? null) === c.id ? " is-on" : ""}`}
              onClick={() => pick(c.id)}
            >
              {c.id ? <PriorityGlyph priority={c.id} /> : <span className="priority-none" aria-hidden />}
              {c.label}
            </button>
          ))}
        </div>
        <p className="priority-note">Urgent and high sort to the top of their list, low to the bottom. On a selected task, P steps through them.</p>
      </div>
    </div>
  );
}

/** The project's own tags for its threads: add, rename and delete them.
 *  A rename or delete reaches every thread that carries the tag. */
export function TagListDialog({ repo, onClose }: { repo: string; onClose: () => void }) {
  const state = useAppState();
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEscape(onClose, false);
  useEffect(() => field.current?.focus(), []);
  const list = tagList(state.prefs, repo);
  const project = Object.values(state.projects).find((p) => p.repo_path === repo);
  const wts = new Set(project ? projectWorktrees(state, project.id).map((w) => w.id) : []);
  const counts = tagCounts(
    Object.values(state.agents).filter((a) => wts.has(a.worktree_id)),
    state.prefs,
    repo,
  );

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-narrow thread-tags" role="dialog" aria-modal="true" aria-labelledby="tag-list-title">
        <h2 id="tag-list-title">Tags for {project?.name ?? "this project"}’s threads</h2>
        {list.length > 0 && (
          <ul className="tt-list">
            {list.map((t) => (
              <TagListRow key={t} repo={repo} tag={t} count={counts.get(t) ?? 0} />
            ))}
          </ul>
        )}
        <form
          className="tt-add"
          onSubmit={(e) => {
            e.preventDefault();
            void addThreadTag(repo, name).then((ok) => ok && setName(""));
          }}
        >
          <input
            ref={field}
            className="setting-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New tag"
            aria-label="New tag"
            spellCheck={false}
          />
          <button type="submit" className="btn" disabled={!cleanTag(name)}>
            Add
          </button>
        </form>
        <p className="dialog-note">Tag a thread from its menu (Tags…), then pick a tag above the list to see only its threads.</p>
        <footer className="dialog-foot">
          <span className="hint" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/** One tag in the editor: its name, renamed when you leave the field or
 *  press Enter, and a delete button. */
function TagListRow({ repo, tag, count }: { repo: string; tag: string; count: number }) {
  const [value, setValue] = useState(tag);
  useEffect(() => setValue(tag), [tag]);
  const commit = () => {
    if (cleanTag(value) === tag) return setValue(tag);
    void renameThreadTag(repo, tag, value).then((ok) => ok || setValue(tag));
  };
  return (
    <li className="tt-row">
      <span className="tt-hash" aria-hidden>
        #
      </span>
      <input
        className="setting-input"
        value={value}
        aria-label={`Rename #${tag}`}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <span className="tt-count" title={`${count} ${count === 1 ? "thread carries" : "threads carry"} it`}>
        {count}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => void deleteThreadTag(repo, tag)}
        title={count ? `Delete #${tag} and take it off ${count} ${count === 1 ? "thread" : "threads"}` : `Delete #${tag}`}
      >
        Delete
      </button>
    </li>

  );
}

/** A priority's mark: an exclamation for urgent, chevrons for the rest. */
export function PriorityGlyph({ priority }: { priority: string }) {
  if (priority === "urgent") {
    return (
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden className="prio prio-urgent">
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="currentColor" />
        <path d="M8 4.5v4.2M8 11.3v.2" stroke="var(--panel)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  // Chevrons, not bars: bars already mean the project's load (LoadMeter).
  const d = priority === "high" ? "M3.5 8 8 3.5 12.5 8M3.5 13 8 8.5l4.5 4.5" : "M3.5 6 8 10.5 12.5 6";
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden className={`prio prio-${priority}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The mark beside a task's or project's name, when it has a priority. */
export function PriorityMark({ priority }: { priority: string | undefined }) {
  const label = priorityLabel(priority);
  if (!label || !priority) return null;
  return (
    <span className="priority-mark" role="img" title={`${label} priority (P to change)`} aria-label={`${label} priority`}>
      <PriorityGlyph priority={priority} />
    </span>
  );
}

/** How many flagged tasks show before "Show all". */
const FOLLOW_UP_ROWS = 3;

/** Tasks flagged to come back to, across projects: those you flagged, and
 *  those whose turn ended while you were away, until you act on them.
 *  Those waiting on you are left to the list above, which already shows
 *  them. */
export function FollowUps() {
  const state = useAppState();
  const [all, setAll] = useState(false);
  const flagged = followUpAgents(state).filter(({ agent }) => agent.status !== "needs_feedback" || agent.archived);
  if (flagged.length === 0) return null;
  const shown = all ? flagged : flagged.slice(0, FOLLOW_UP_ROWS);
  return (
    <section className="followups" aria-label="Flagged for follow-up">
      <h2
        className="followups-title"
        title="Tasks to come back to: those you flagged, and those that finished while you weren't looking. ✓ clears one; replying or archiving clears it too."
      >
        <FlagGlyph />
        Follow up <span className="followups-count">{flagged.length}</span>
      </h2>
      <ul>
        {shown.map(({ agent, at }) => {
          const project = projectOfWorktree(state, agent.worktree_id);
          return (
            <li key={agent.id}>
              <button
                className="followup-row"
                onClick={() => selectAgent(agent)}
                title={`${agent.name}, in ${project?.name ?? "its project"}${agent.archived ? " (archived)" : ""}.\nClick to open it; ✓ when you're done with it.`}
              >
                <span className="followup-name">{agent.name}</span>
                <span className="followup-where">
                  <span className="followup-project">
                    <ProjectDot project={project} />
                    {project?.name}
                    {agent.archived && " · archived"}
                  </span>
                  <span
                    className="followup-age"
                    title={`${isAutoFollowUp(state, agent.id) ? "Finished while you were away," : "Flagged"} ${new Date(at).toLocaleString()}`}
                  >
                    {relativeTime(at)}
                  </span>
                </span>
              </button>
              <button
                className="followup-clear"
                onClick={() => void toggleFlag(agent)}
                aria-label={`Clear the flag on ${agent.name}`}
                title="Done: clear the flag"
              >
                <CheckGlyph />
              </button>
            </li>
          );
        })}
      </ul>
      {flagged.length > FOLLOW_UP_ROWS && (
        <button
          className="link-btn followups-more"
          onClick={() => setAll((v) => !v)}
          title={all ? "Back to the three most recent" : "Every task flagged to come back to"}
        >
          {all ? "Show fewer" : `Show all ${flagged.length}`}
        </button>
      )}
    </section>
  );
}

export function FlagGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 14.5V2m0 .5h8.2l-1.9 3.2 1.9 3.3H3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function PinGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6 2h4M6.5 2v4.2L4 9h8L9.5 6.2V2M8 9v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
