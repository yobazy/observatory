import { useMemo, useRef, useState } from "react";
import { useOverlayKeys } from "./Overlay";
import { ConfirmDialog, type ConfirmDialogSpec } from "./Dialogs";
import { openLink } from "./Run";
import { ProjectDot, selectAgent } from "./Sidebar";
import { setState, useAppState } from "../nebula/store";
import {
  busy,
  bytes,
  leftRunning,
  percent,
  projectLoad,
  refreshActivity,
  sessionOf,
  stopProcess,
  uptime,
  useActivity,
  type Proc,
} from "../nebula/activity";

type Sort = "cpu" | "memory";

/** Too small to list by default: an idle shell, a helper. */
const small = (p: Proc) => p.cpu < 0.5 && p.memory < 30 * 1024 ** 2 && !p.ports.length;

/** What's running in your projects, like Activity Monitor, by project and
 *  checkout: what each process is, what it costs, what it serves, and a
 *  way to stop it. */
export function ActivityView() {
  const state = useAppState();
  const { processes, error, at } = useActivity();
  const [sort, setSort] = useState<Sort>("cpu");
  const [dialog, setDialog] = useState<ConfirmDialogSpec | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const controls = useRef<HTMLDivElement>(null);
  useOverlayKeys(controls);

  const groups = useMemo(() => {
    const byPath = new Map(Object.values(state.worktrees).map((w) => [w.path, w]));
    const projects = new Map<string, { id: string; checkouts: Map<string, Proc[]>; cpu: number; memory: number }>();
    for (const p of processes ?? []) {
      const wt = byPath.get(p.worktree);
      if (!wt) continue;
      const g = projects.get(wt.project_id) ?? { id: wt.project_id, checkouts: new Map(), cpu: 0, memory: 0 };
      g.cpu += p.cpu;
      g.memory += p.memory;
      g.checkouts.set(wt.id, [...(g.checkouts.get(wt.id) ?? []), p]);
      projects.set(wt.project_id, g);
    }
    const key = (x: { cpu: number; memory: number }) => (sort === "cpu" ? x.cpu : x.memory);
    for (const g of projects.values()) for (const list of g.checkouts.values()) list.sort((a, b) => key(b) - key(a));
    return [...projects.values()].sort((a, b) => key(b) - key(a));
  }, [processes, state.worktrees, sort]);

  const total = (processes ?? []).reduce((t, p) => ({ cpu: t.cpu + p.cpu, memory: t.memory + p.memory }), { cpu: 0, memory: 0 });

  const confirmStop = (p: Proc, force: boolean) =>
    setDialog({
      kind: "confirm",
      title: force ? `Force quit ${p.name}?` : `Stop ${p.name}?`,
      message: force
        ? `It ends at once, without a chance to save anything. ${p.command}`
        : `It's asked to quit, the way closing its terminal would. If it doesn't, Force quit ends it. ${p.command}`,
      confirm: force ? "Force quit" : "Stop",
      onConfirm: () => stopProcess(p.pid, force),
    });

  const row = (p: Proc) => {
    const session = sessionOf(state, p);
    const left = leftRunning(state, p);
    return (
      <tr key={p.pid} className={left ? "is-left" : undefined}>
        <td>
          <div className="act-what">
            <span className="act-name">{p.name}</span>
            <span className="act-cmd" title={p.command}>
              {p.command}
            </span>
          </div>
        </td>
        <td>
          <div className="act-from">
            {left ? (
              <span className="act-left" title="Running here while no session or terminal in this project is">
                Left running
              </span>
            ) : session ? (
              <button className="link-btn" onClick={() => selectAgent(session)} title="Open the session that started it">
                {session.name}
              </button>
            ) : p.nebula ? (
              <span className="act-muted">a session</span>
            ) : null}
            {p.ports.map((port) => (
              <button key={port} className="link-btn act-port" onClick={() => void openLink(`http://localhost:${port}`)} title={`Open localhost:${port}`}>
                :{port}
              </button>
            ))}
          </div>
        </td>
        <td className="num">{percent(p.cpu)}</td>
        <td className="num">{bytes(p.memory)}</td>
        <td className="num act-muted">{uptime(p.elapsed)}</td>
        <td className="act-actions">
          <button className="btn btn-sm" onClick={() => confirmStop(p, false)} title={`Ask ${p.name} to quit (pid ${p.pid})`}>
            Stop
          </button>
          <button className="btn btn-sm btn-rare" onClick={() => confirmStop(p, true)} title={`End ${p.name} at once (pid ${p.pid})`}>
            Force quit
          </button>
        </td>
      </tr>
    );
  };

  return (
    <section className="usage activity" aria-labelledby="activity-title">
      <header className="usage-head" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 id="activity-title">Activity</h1>
          <p className="usage-sub">
            {processes
              ? `Your projects: ${bytes(total.memory)} · ${percent(total.cpu)} CPU · ${processes.length} ${processes.length === 1 ? "process" : "processes"}`
              : "Reading what's running in your projects…"}
          </p>
        </div>
        <div className="usage-controls" ref={controls}>
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Sort by">
            {(["cpu", "memory"] as const).map((s) => (
              <button key={s} role="radio" aria-checked={sort === s} className={sort === s ? "is-on" : ""} onClick={() => setSort(s)}>
                {s === "cpu" ? "CPU" : "Memory"}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={() => void refreshActivity()}>
            Refresh
          </button>
          <button className="btn btn-sm" onClick={() => setState({ view: "sessions" })} title="Back to sessions (Esc)">
            Done
          </button>
        </div>
      </header>

      <div className="usage-body">
        {error && <p className="usage-empty" role="alert">Couldn't read what's running: {error}</p>}
        {processes && !groups.length && <p className="usage-empty">Nothing is running in your projects' folders.</p>}
        {groups.map((g) => {
          const project = state.projects[g.id];
          const many = g.checkouts.size > 1;
          return (
            <section key={g.id} className="act-project" aria-label={project?.name}>
              <h2>
                <ProjectDot project={project} />
                {project?.name ?? "Unknown project"}
                <span className="act-sum">
                  {percent(g.cpu)} · {bytes(g.memory)}
                </span>
              </h2>
              {[...g.checkouts.entries()].map(([id, list]) => {
                const wt = state.worktrees[id];
                const open = opened.has(id);
                const shown = open ? list : list.filter((p) => !small(p));
                const hidden = list.length - shown.length;
                return (
                  <div key={id} className="act-checkout">
                    {many && <h3>{wt?.is_main ? "Main checkout" : `on ${wt?.branch}`}</h3>}
                    <table className="task-table act-table">
                      <colgroup>
                        <col />
                        <col className="act-col-from" />
                        <col className="act-col-num" />
                        <col className="act-col-num" />
                        <col className="act-col-num" />
                        <col className="act-col-actions" />
                      </colgroup>
                      <thead className="sr-only">
                        <tr>
                          <th>Process</th>
                          <th>From</th>
                          <th>CPU</th>
                          <th>Memory</th>
                          <th>Running for</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>{shown.map(row)}</tbody>
                    </table>
                    {(hidden > 0 || open) && list.some(small) && (
                      <button
                        className="link-btn act-more"
                        onClick={() =>
                          setOpened((o) => {
                            const n = new Set(o);
                            if (open) n.delete(id);
                            else n.add(id);
                            return n;
                          })
                        }
                      >
                        {open ? "Hide the small ones" : `${hidden} small ${hidden === 1 ? "process" : "processes"}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
        {at > 0 && <p className="usage-note">Read every few seconds while this is open. CPU is a share of one core.</p>}
      </div>
      {dialog && <ConfirmDialog d={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

/** A project's processes, as a quiet meter on its sidebar row when it's
 *  using a fair share of the machine. */
export function LoadMeter({ projectId }: { projectId: string }) {
  const state = useAppState();
  const { processes } = useActivity();
  const load = useMemo(() => (processes ? projectLoad(state, processes).get(projectId) : undefined), [processes, state, projectId]);
  if (!load || !busy(load)) return null;
  const level = load.cpu >= 80 || load.memory >= 1.5 * 1024 ** 3 ? 3 : load.cpu >= 30 || load.memory >= 1024 ** 3 ? 2 : 1;
  const text = `${load.count} ${load.count === 1 ? "process" : "processes"} · ${percent(load.cpu)} CPU · ${bytes(load.memory)}`;
  return (
    <span className={`load-meter is-${level}`} title={text} aria-label={text}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={n <= level ? "is-on" : undefined} />
      ))}
    </span>
  );
}

export function ActivityGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path d="M1.5 8.5h3l1.8-4.5 3.2 8.5 1.9-4h3.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
