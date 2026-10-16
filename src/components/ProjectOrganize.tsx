import { useEffect, useRef, useState } from "react";
import { allTags, parseTags } from "../nebula/folders";
import { createFolder, moveToFolder, setProjectAlias, setProjectTags } from "../nebula/organize";
import { daemonName, useAppState } from "../nebula/store";
import type { Project } from "../nebula/types";
import { useEscape } from "./Dialogs";

/** A project's name here and its tags: what the sidebar and its filter go by. */
export function ProjectDetailsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { prefs, projects } = useAppState();
  const real = daemonName(project);
  const [alias, setAlias] = useState(prefs.projectAliases?.[project.repo_path] ?? "");
  const [tags, setTags] = useState((prefs.projectTags?.[project.repo_path] ?? []).join(", "));
  const field = useRef<HTMLInputElement>(null);
  useEscape(onClose, false);
  useEffect(() => field.current?.focus(), []);

  const typed = parseTags(tags);
  // Tags other projects have, to add with a click.
  const others = allTags(
    prefs,
    Object.values(projects).map((p) => p.repo_path),
  ).filter((t) => !typed.includes(t));

  const save = async () => {
    await setProjectAlias(project.repo_path, alias);
    await setProjectTags(project.repo_path, typed);
    onClose();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog dialog-narrow project-details"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-details-title"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="project-details-title">Name and tags</h2>
        <label className="pd-field">
          <span>Name in Observatory</span>
          <input
            ref={field}
            className="setting-input"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder={real}
            spellCheck={false}
          />
        </label>
        <p className="dialog-note">
          Leave it empty to use “{real}”, the name nebula and the TUI use. Changing it here changes nothing else.
        </p>
        <label className="pd-field">
          <span>Tags</span>
          <input
            className="setting-input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="work, client, side-project"
            spellCheck={false}
          />
        </label>
        {others.length > 0 && (
          <div className="pd-suggest" aria-label="Tags other projects have">
            {others.slice(0, 12).map((t) => (
              <button key={t} type="button" className="tag-chip" onClick={() => setTags([...typed, t].join(", "))}>
                #{t}
              </button>
            ))}
          </div>
        )}
        <p className="dialog-note">Filter the sidebar by a tag with #tag, or click it above the list.</p>
        <footer className="dialog-foot">
          <span className="hint" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}

/** Which folder a project sits in: one of them, a new one, or none. */
export function FolderDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { prefs } = useAppState();
  const folders = prefs.projectFolders ?? [];
  const current = folders.find((f) => f.projects.includes(project.repo_path))?.id ?? null;
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEscape(onClose, false);
  useEffect(() => {
    if (!folders.length) field.current?.focus();
  }, [folders.length]);

  const pick = async (id: string | null) => {
    await moveToFolder(project.repo_path, id);
    onClose();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog dialog-narrow folder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-dialog-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void createFolder(name.trim(), project.repo_path).then(onClose);
        }}
      >
        <h2 id="folder-dialog-title">Put {project.name} in a folder</h2>
        {folders.length > 0 && (
          <ul className="fd-list" role="radiogroup" aria-labelledby="folder-dialog-title">
            {folders.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={f.id === current}
                  className={`fd-pick${f.id === current ? " is-on" : ""}`}
                  onClick={() => void pick(f.id)}
                >
                  <FolderGlyph />
                  <span>{f.name}</span>
                  <span className="fd-count">{f.projects.length}</span>
                </button>
              </li>
            ))}
            {current && (
              <li>
                <button type="button" role="radio" aria-checked={false} className="fd-pick" onClick={() => void pick(null)}>
                  <span className="fd-none" aria-hidden>
                    –
                  </span>
                  <span>No folder</span>
                </button>
              </li>
            )}
          </ul>
        )}
        <label className="pd-field">
          <span>New folder</span>
          <input
            ref={field}
            className="setting-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Clients"
            spellCheck={false}
          />
        </label>
        <footer className="dialog-foot">
          <span className="hint" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Create and move
          </button>
        </footer>
      </form>
    </div>
  );
}

export function FolderGlyph({ open = false }: { open?: boolean }) {
  return (
    <svg className="folder-glyph" width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      {open ? (
        <path
          d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.5 1.5h5.9c.55 0 1 .45 1 1v1H4.6c-.45 0-.84.3-.96.73L1.75 13V4.25Zm1.85 3.25h10.9l-1.6 5.25H2l1.6-5.25Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.5 1.5h5.9c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
