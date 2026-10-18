import { useEffect, useMemo, useRef, useState } from "react";
import { PRIORITIES, PRIORITY_LABEL, type Priority } from "../nebula/ideaList";
import { addIdea, openIdeas } from "../nebula/ideas";
import { flash, sortedProjects, useAppState } from "../nebula/store";

/** ⌘I: write an idea down without leaving what you're doing. It's filed
 *  under the project you're in unless you pick another, or Unsorted; ↵
 *  saves it and the dialog goes. The Ideas view (⇧⌘I) has the whole list. */
export function IdeaDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const projects = useMemo(() => sortedProjects(state), [state]);
  const here = state.selectedProject ? state.projects[state.selectedProject]?.repo_path : undefined;
  const [text, setText] = useState("");
  const [project, setProject] = useState(here ?? "");
  const [priority, setPriority] = useState<Priority | "">("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => box.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const made = await addIdea(text, project || null, { kind: "capture" }, { priority: priority || null });
    if (!made) {
      setBusy(false);
      flash("Couldn't save the idea");
      return;
    }
    const where = projects.find((p) => p.repo_path === project)?.name ?? "Unsorted";
    flash(`Idea saved to ${where}`, 2000);
    onClose();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog dialog-narrow idea-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="idea-title"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="idea-title">New idea</h2>
        <textarea
          ref={box}
          className="task-box"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // ↵ saves; ⇧↵ is a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="Something to do later…"
          aria-label="Idea"
        />
        <div className="idea-dialog-row">
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
        </div>
        <footer className="dialog-foot">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              openIdeas(project || undefined);
              onClose();
            }}
          >
            See all ideas (⇧⌘I)
          </button>
          <span className="hint">
            <kbd>↵</kbd> saves
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!text.trim() || busy}>
            Save idea
          </button>
        </footer>
      </form>
    </div>
  );
}
