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
  setThreadTagColor,
  tagPicked,
  toggleFlag,
} from "../nebula/organize";
import { PRIORITIES, priorityLabel, type Priority } from "../nebula/priority";
import { tagColor, tagCounts, tagList, tagShare, threadTagsOf } from "../nebula/threadtags";
import type { DesktopPrefs } from "../nebula/theme";
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

/** Which of their project's tags one thread, or several picked ones, carry:
 *  a checkbox each (mixed when only some of the threads do), and a field
 *  that adds a new one to the project and to the threads. Each change saves
 *  as you make it, as yours. */
export function ThreadTagsDialog({ agents, onClose }: { agents: Agent[]; onClose: () => void }) {
  const state = useAppState();
  const repo = agents[0] && projectOfWorktree(state, agents[0].worktree_id)?.repo_path;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEscape(onClose, false);
  useEffect(() => field.current?.focus(), [editing]);
  if (!repo) return null;
  if (editing) return <TagListDialog repo={repo} onClose={onClose} />;
  const list = tagList(state.prefs, repo);
  // Picks only ever come from one project's list; any from another are left out.
  const ids = agents.filter((a) => projectOfWorktree(state, a.worktree_id)?.repo_path === repo).map((a) => a.id);
  const one = ids.length === 1;

  const add = async () => {
    const tag = cleanTag(name);
    if (!(await addThreadTag(repo, name))) return;
    setName("");
    if (tagShare(getState().prefs, ids, tag) !== "all") await tagPicked(ids, tag, true);
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-narrow thread-tags" role="dialog" aria-modal="true" aria-labelledby="thread-tags-title">
        <h2 id="thread-tags-title">Tags on {one ? agents[0].name : `${ids.length} threads`}</h2>
        {list.length > 0 ? (
          <ul className="tt-list" aria-labelledby="thread-tags-title">
            {list.map((t) => {
              const share = tagShare(state.prefs, ids, t);
              return (
                <li key={t}>
                  <label className="tt-check" title={share === "some" ? "Some of them carry it: check to tag them all" : undefined}>
                    <MixedCheckbox share={share} onChange={(on) => void tagPicked(ids, t, on)} />
                    <TagDot repo={repo} tag={t} />#{t}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="dialog-note">
            This project has no tags yet. Add one below, and it goes on {one ? "this thread" : "these threads"} too.
          </p>
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

/** A checkbox for a tag on several threads: checked when they all carry it,
 *  mixed when some do. Checking a mixed one tags them all. */
function MixedCheckbox({ share, onChange }: { share: "all" | "some" | "none"; onChange: (on: boolean) => void }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = share === "some";
  }, [share]);
  return (
    <input
      ref={box}
      type="checkbox"
      checked={share === "all"}
      aria-checked={share === "some" ? "mixed" : share === "all"}
      onChange={() => onChange(share !== "all")}
    />
  );
}

/** A tag's color as `--pc` (its hue), or nothing when it has none. */
export function tagColorStyle(prefs: DesktopPrefs, repo: string, tag: string): React.CSSProperties | undefined {
  const name = tagColor(prefs, repo, tag);
  const hue = PROJECT_COLORS.find((c) => c.name === name)?.hue;
  return hue === undefined ? undefined : ({ "--pc": hue } as React.CSSProperties);
}

/** A tag's color as a small dot; nothing when it has none. */
export function TagDot({ repo, tag }: { repo: string; tag: string }) {
  const style = tagColorStyle(useAppState().prefs, repo, tag);
  return style ? <span className="tag-dot" style={style} aria-hidden /> : null;
}

/** A chip for one of a project's thread tags, in its color when it has one:
 *  `#tag`, then whatever's passed (a count). */
export function TagChip({
  repo,
  tag,
  on,
  title,
  onClick,
  children,
}: {
  repo: string;
  tag: string;
  on: boolean;
  title: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  const style = tagColorStyle(useAppState().prefs, repo, tag);
  return (
    <button
      className={`tag-chip${on ? " is-on" : ""}${style ? " has-color" : ""}`}
      style={style}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      #{tag} {children}
    </button>
  );
}

/** The tags a thread carries, on its row: a dot in each one's color. */
export function TagMarks({ agent }: { agent: Agent }) {
  const state = useAppState();
  const tags = threadTagsOf(state.prefs, agent.id);
  const repo = tags.length ? projectOfWorktree(state, agent.worktree_id)?.repo_path : undefined;
  if (!repo) return null;
  const label = tags.map((t) => `#${t}`).join(" ");
  return (
    <span className="row-mark row-tags" role="img" title={label} aria-label={`Tagged ${label}`}>
      {tags.map((t) => (
        <span key={t} className="row-tag" style={tagColorStyle(state.prefs, repo, t)} />
      ))}
    </span>
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
  const prefs = useAppState().prefs;
  const [value, setValue] = useState(tag);
  const [coloring, setColoring] = useState(false);
  useEffect(() => setValue(tag), [tag]);
  const commit = () => {
    if (cleanTag(value) === tag) return setValue(tag);
    void renameThreadTag(repo, tag, value).then((ok) => ok || setValue(tag));
  };
  const color = tagColor(prefs, repo, tag);
  const labelId = `tt-color-${tag}`;
  return (
    <li className="tt-item">
      <div className="tt-row">
        <button
          type="button"
          id={labelId}
          className={`tt-color${color ? "" : " is-none"}`}
          style={tagColorStyle(prefs, repo, tag)}
          aria-expanded={coloring}
          title={color ? `#${tag} is ${color}: pick another color` : `Pick a color for #${tag}`}
          aria-label={`Color for #${tag}`}
          onClick={() => setColoring(!coloring)}
        />
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
      </div>
      {coloring && (
        <ColorRow
          value={color}
          labelledBy={labelId}
          onPick={(name) => {
            void setThreadTagColor(repo, tag, name).catch((e) => flash(`Couldn't save the color: ${e}`));
            setColoring(false);
          }}
        />
      )}
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

/** How many flagged tasks show before "N more". */
const FOLLOW_UP_ROWS = 2;

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
    <section className="side-card followups" aria-label="Flagged for follow-up">
      <h2
        className="side-card-head"
        title="Tasks to come back to: those you flagged, and those that finished while you weren't looking. ✓ clears one; replying or archiving clears it too."
      >
        <FlagGlyph />
        <span className="side-card-title">Follow up</span> <span className="side-card-count">{flagged.length}</span>
      </h2>
      <ul>
        {shown.map(({ agent, at }) => {
          const project = projectOfWorktree(state, agent.worktree_id);
          return (
            <li key={agent.id}>
              <button
                className="side-row"
                onClick={() => selectAgent(agent)}
                title={`${agent.name}, in ${project?.name ?? "its project"}${agent.archived ? " (archived)" : ""}.\nClick to open it; ✓ when you're done with it.`}
              >
                <span className="side-row-name">{agent.name}</span>
                <span
                  className="side-row-age"
                  title={`${isAutoFollowUp(state, agent.id) ? "Finished while you were away," : "Flagged"} ${new Date(at).toLocaleString()}`}
                >
                  {relativeTime(at)}
                </span>
                <span className="side-row-sub">
                  <ProjectDot project={project} />
                  <span className="side-row-text">
                    {project?.name}
                    {agent.archived && " · archived"}
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
          className="link-btn side-card-more"
          onClick={() => setAll((v) => !v)}
          title={all ? "Back to the two oldest" : "Every task flagged to come back to"}
        >
          {all ? (
            "Show fewer"
          ) : (
            <>
              {flagged.length - FOLLOW_UP_ROWS} more
              <span className="side-card-more-note"> · newest {relativeTime(flagged[flagged.length - 1].at)}</span>
            </>
          )}
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

export function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
