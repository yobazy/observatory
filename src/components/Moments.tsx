import { useEffect, useMemo, useRef, useState } from "react";
import { dismissMoment, momentProject, noteMoment, taskMoment, useMark } from "../nebula/moments";
import { getState, sortedProjects, useAppState } from "../nebula/store";

/** After ⇧⌘M (moments.ts): says the moment's saved and its path copied, and
 *  takes a line on what you noticed. ↵ saves it, ⌘↵ starts a task on it in
 *  the background, Esc goes without either. */
export function MomentCard() {
  const mark = useMark();
  const state = useAppState();
  const projects = useMemo(() => sortedProjects(state), [state.projects]);
  const [note, setNote] = useState("");
  const [project, setProject] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mark.kind === "saved") {
      setNote("");
      setProject(momentProject(getState()) ?? "");
      field.current?.focus();
    }
    if (mark.kind !== "error") return;
    const t = setTimeout(dismissMoment, 5000);
    return () => clearTimeout(t);
  }, [mark]);

  // Nothing while it saves, so the screenshot is what you saw.
  if (mark.kind === "idle" || mark.kind === "saving") return null;
  if (mark.kind === "error")
    return (
      <div className="notice" role="alert">
        Couldn’t mark this moment: {mark.message}
      </div>
    );

  return (
    <form
      className="notice moment-card"
      role="dialog"
      aria-label="Marked moment"
      onSubmit={(e) => {
        e.preventDefault();
        void noteMoment(note);
      }}
    >
      <p>
        <strong>Marked.</strong> Its path is copied: paste it wherever you’re reporting this.
        {mark.noScreenshot && <span className="moment-hint"> {mark.noScreenshot}</span>}
      </p>
      <input
        ref={field}
        className="setting-input"
        value={note}
        placeholder="What did you notice? (optional)"
        aria-label="What did you notice"
        spellCheck={false}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey && project) {
            e.preventDefault();
            void taskMoment(project, note);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            dismissMoment();
          }
        }}
      />
      <div className="moment-actions">
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          aria-label="Project for the task"
          title="Where “Start task” starts one"
        >
          <option value="" disabled>
            Project…
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" onClick={dismissMoment}>
          Skip
        </button>
        <button type="submit" className="btn btn-sm">
          Save note
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!project}
          onClick={() => void taskMoment(project, note)}
          title="Start an agent that fixes this in its own worktree and opens a PR for a second agent to review and merge. You stay where you are (⌘↵)"
        >
          Start task
        </button>
      </div>
    </form>
  );
}
