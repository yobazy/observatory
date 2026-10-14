import { useEffect, useRef, useState } from "react";
import { useOverlayKeys } from "./Overlay";
import { ProjectDot, selectAgent } from "./Sidebar";
import { followUp } from "../nebula/actions";
import { openReview } from "../nebula/diff";
import { getState, setState, useAppState } from "../nebula/store";
import { relativeTime, statusLabel } from "../nebula/status";
import { commitPrompt, dirtyWorktrees, loadUncommitted, type BranchWork } from "../nebula/uncommitted";

/** Every uncommitted file across the checkouts, under the thread that left
 *  it, so nothing a thread finished gets lost. */
export function UncommittedView() {
  const state = useAppState();
  const [work, setWork] = useState<BranchWork[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(() => new Set());
  const controls = useRef<HTMLDivElement>(null);
  useOverlayKeys(controls);

  // Read again when a dirty checkout's git state moves: a commit, an edit.
  const dirty = dirtyWorktrees(state);
  const key = dirty
    .map(({ worktree, files }) => {
      const g = state.git[worktree.id];
      return `${worktree.id}:${files}:${g && !("error" in g) ? `${g.head}:${g.insertions}:${g.deletions}` : ""}`;
    })
    .join("|");
  useEffect(() => {
    let live = true;
    loadUncommitted(getState())
      .then((w) => live && (setWork(w), setError(null)))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [key]);

  const files = work ? new Set(work.flatMap((w) => w.groups.flatMap((g) => g.files.map((f) => `${w.worktree.id}:${f.file.path}`)))).size : 0;
  const threads = work ? work.reduce((n, w) => n + w.groups.filter((g) => g.agentId).length, 0) : 0;

  return (
    <section className="usage uncommitted" aria-labelledby="uncommitted-title">
      <header className="usage-head" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 id="uncommitted-title">Uncommitted work</h1>
          <p className="usage-sub">
            {work && files > 0
              ? `${files} ${files === 1 ? "file" : "files"} on ${work.length} ${work.length === 1 ? "branch" : "branches"}, from ${threads} ${threads === 1 ? "thread" : "threads"}. Each file sits under the thread that last changed it.`
              : "Each uncommitted file, under the thread that last changed it."}
          </p>
        </div>
        <div className="usage-controls" ref={controls}>
          <button className="btn btn-sm" onClick={() => setState({ view: "sessions" })} title="Back to sessions (Esc)">
            Done
          </button>
        </div>
      </header>

      {error ? (
        <p className="usage-empty" role="alert">
          Couldn't read the changes: {error}
        </p>
      ) : !work ? (
        <p className="usage-empty">Reading the changes…</p>
      ) : work.length === 0 ? (
        <p className="usage-empty">Everything is committed.</p>
      ) : (
        <div className="usage-body">
          {work.map(({ worktree, project, groups }) => (
            <section key={worktree.id} className="uc-branch" aria-label={`${project?.name ?? ""} ${worktree.branch}`}>
              <h2 className="uc-branch-head">
                <ProjectDot project={project} />
                <span>{project?.name}</span>
                <span className="uc-branch-name">{worktree.branch}</span>
                {worktree.is_main && <span className="uc-muted">main checkout</span>}
                <button className="link-btn uc-review" onClick={() => openReview(worktree.id)}>
                  Review all
                </button>
              </h2>
              {groups.map((g) => {
                const agent = g.agentId ? state.agents[g.agentId] : undefined;
                const busy = agent && (agent.status === "running" || agent.status === "needs_feedback");
                const add = g.files.reduce((n, f) => n + f.file.insertions, 0);
                const del = g.files.reduce((n, f) => n + f.file.deletions, 0);
                return (
                  <article key={g.agentId ?? "none"} className="uc-thread">
                    <div className="uc-thread-head">
                      <span className={agent ? `sdot dot-${agent.status}${agent.unseen ? " is-unseen" : ""}` : "uc-none"} aria-hidden />
                      <h3>{agent ? agent.name : "Not from a thread"}</h3>
                      <span className="uc-muted">
                        {agent
                          ? `${statusLabel(agent)}${agent.archived ? ", archived" : ""}${g.lastEdit ? ` · last change ${relativeTime(g.lastEdit * 1000)}` : ""}`
                          : "Changed by you, another tool, or an agent through the shell"}
                      </span>
                      <span className="uc-stat">
                        {add > 0 && <span className="git-add">+{add}</span>} {del > 0 && <span className="git-del">−{del}</span>}
                      </span>
                    </div>
                    <ul className="uc-files">
                      {g.files.map(({ file, alsoBy }) => (
                        <li key={file.path}>
                          <span className="uc-path" title={file.path}>
                            {file.path}
                          </span>
                          {alsoBy.length > 0 && (
                            <span
                              className="uc-shared"
                              title="More than one thread changed this file; committing it takes all their changes"
                            >
                              also changed by {alsoBy.map((id) => state.agents[id]?.name ?? "another thread").join(", ")}
                            </span>
                          )}
                          {file.insertions > 0 && <span className="git-add">+{file.insertions}</span>}
                          {file.deletions > 0 && <span className="git-del">−{file.deletions}</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="uc-actions">
                      {agent && (
                        <button className="btn btn-sm" onClick={() => selectAgent(agent)}>
                          Open thread
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => openReview(worktree.id)}>
                        Review diff
                      </button>
                      {agent &&
                        (asked.has(agent.id) ? (
                          <span className="uc-done">Asked {agent.name} to commit its changes.</span>
                        ) : busy ? (
                          <span className="uc-muted">
                            {agent.status === "running" ? "Still working; commit when it's done." : "Waiting on you; commit after you answer."}
                          </span>
                        ) : (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              void followUp(agent, commitPrompt(g.files.map((f) => f.file.path)), { select: false });
                              setAsked((s) => new Set(s).add(agent.id));
                            }}
                          >
                            Ask it to commit
                          </button>
                        ))}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** The sidebar's way in: shown while any checkout has uncommitted changes. */
export function UncommittedEntry() {
  const state = useAppState();
  const dirty = dirtyWorktrees(state);
  if (dirty.length === 0) return null;
  const files = dirty.reduce((n, d) => n + d.files, 0);
  return (
    <button
      className={`uc-entry${state.view === "uncommitted" ? " is-on" : ""}`}
      onClick={() => setState((s) => ({ view: s.view === "uncommitted" ? "sessions" : "uncommitted" }))}
      title="See uncommitted work, by the thread that left it"
    >
      <span className="uc-entry-title">Uncommitted</span>
      <span className="uc-entry-sub">
        {files} {files === 1 ? "file" : "files"} on {dirty.length} {dirty.length === 1 ? "branch" : "branches"}
      </span>
    </button>
  );
}
