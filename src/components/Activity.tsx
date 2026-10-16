import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useOverlayKeys } from "./Overlay";
import { ConfirmDialog, type ConfirmDialogSpec } from "./Dialogs";
import { openLink } from "./Run";
import { ProjectDot, selectAgent } from "./Sidebar";
import { setState, useAppState, type State } from "../nebula/store";
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
import { remember, settle, smooth, type Margin, type Ordering } from "../nebula/calm";

type Sort = "cpu" | "memory";

/** Too small to list by default: an idle shell, a helper. */
const small = (p: Proc) => p.cpu < 0.5 && p.memory < 30 * 1024 ** 2 && !p.ports.length;

/** What it takes to move a row up: CPU in points of one core, memory in bytes. */
const MARGIN: Record<Sort, Margin> = { cpu: { rel: 0.2, abs: 3 }, memory: { rel: 0.1, abs: 50 * 1024 ** 2 } };

// The view's memory across reads, and across opening it again: smoothed
// numbers, each list's order, and each project's recent CPU.
const calm = {
  /** Read this pass, "<at>:<sort>:<paused>", so a re-render doesn't count as a read. */
  read: "",
  cpu: new Map<string, number>(),
  memory: new Map<string, number>(),
  orders: new Map<string, Ordering>(),
  spark: new Map<string, number[]>(),
};

const OPEN_KEY = "observatory.activity.open";
function readOpen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function writeOpen(open: Set<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // Remembering it is a nicety.
  }
}

interface Group {
  id: string;
  checkouts: Map<string, Proc[]>;
  count: number;
  ports: number[];
  left: number;
}

/** Projects and their processes by checkout, as the daemon's worktrees
 *  place them. */
function grouped(s: State, processes: Proc[]): Map<string, Group> {
  const byPath = new Map(Object.values(s.worktrees).map((w) => [w.path, w]));
  const out = new Map<string, Group>();
  for (const p of processes) {
    const wt = byPath.get(p.worktree);
    if (!wt) continue;
    const g: Group = out.get(wt.project_id) ?? { id: wt.project_id, checkouts: new Map(), count: 0, ports: [], left: 0 };
    g.count++;
    g.ports.push(...p.ports);
    if (leftRunning(s, p)) g.left++;
    g.checkouts.set(wt.id, [...(g.checkouts.get(wt.id) ?? []), p]);
    out.set(wt.project_id, g);
  }
  return out;
}

/** `prev`'s order kept as it is, gone rows dropped and new ones at the end:
 *  the list while you're looking at it. */
const held = (prev: Ordering | undefined, keys: string[]): Ordering => {
  const kept = (prev?.order ?? []).filter((k) => keys.includes(k));
  return { order: [...kept, ...keys.filter((k) => !kept.includes(k))], ahead: prev?.ahead ?? new Map() };
};

/** After each render, rows marked `data-flip` that moved slide from where
 *  they were to where they are, so a re-sort reads as motion, not a jump. */
function useFlip(box: RefObject<HTMLElement | null>) {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = el.getBoundingClientRect().top - el.scrollTop;
    const next = new Map<string, number>();
    for (const node of el.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = node.dataset.flip!;
      // Where it sits without any slide still under way.
      const shift = node.style.transform ? new DOMMatrix(getComputedStyle(node).transform).m42 : 0;
      const top = node.getBoundingClientRect().top - shift - origin;
      next.set(key, top);
      const was = tops.current.get(key);
      if (still || was === undefined || Math.abs(was - top) < 1) continue;
      node.style.transition = "none";
      node.style.transform = `translateY(${was - top}px)`;
      requestAnimationFrame(() => {
        node.style.transition = "transform 220ms cubic-bezier(0.2, 0, 0, 1)";
        node.style.transform = "";
      });
    }
    tops.current = next;
  });
}

/** A project's CPU over the last reads, as a quiet line. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="act-spark" aria-hidden />;
  const top = Math.max(10, ...values);
  const w = 56;
  const h = 14;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 1 - (v / top) * (h - 2)).toFixed(1)}`).join(" ");
  return (
    <svg className="act-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** What's running in your projects, like Activity Monitor: one row per
 *  project, open to see its processes by checkout, what each costs and
 *  serves, and a way to stop it. Read every few seconds, so the numbers
 *  are smoothed and the order only changes when a row is clearly ahead. */
export function ActivityView() {
  const state = useAppState();
  const { processes, error, at } = useActivity();
  const [sort, setSort] = useState<Sort>("cpu");
  const [dialog, setDialog] = useState<ConfirmDialogSpec | null>(null);
  const [open, setOpen] = useState<Set<string>>(readOpen);
  const [smallShown, setSmallShown] = useState<Set<string>>(new Set());
  const [looking, setLooking] = useState(false);
  const controls = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useOverlayKeys(controls);
  useFlip(body);

  const groups = useMemo(() => grouped(state, processes ?? []), [state, processes]);

  // A new read (or a new sort, or letting go of the list): smooth the
  // numbers, then settle each list's order.
  const read = `${at}:${sort}:${looking}`;
  if (processes && calm.read !== read) {
    const fresh = calm.read.split(":")[0] !== String(at);
    calm.read = read;
    const raw = { cpu: new Map<string, number>(), memory: new Map<string, number>() };
    for (const p of processes) {
      raw.cpu.set(String(p.pid), p.cpu);
      raw.memory.set(String(p.pid), p.memory);
    }
    for (const g of groups.values()) {
      const all = [...g.checkouts.values()].flat();
      raw.cpu.set(`p:${g.id}`, all.reduce((t, p) => t + p.cpu, 0));
      raw.memory.set(`p:${g.id}`, all.reduce((t, p) => t + p.memory, 0));
    }
    if (fresh) {
      calm.cpu = smooth(calm.cpu, raw.cpu);
      calm.memory = smooth(calm.memory, raw.memory);
      calm.spark = remember(
        calm.spark,
        new Map([...groups.keys()].map((id) => [id, raw.cpu.get(`p:${id}`) ?? 0])),
      );
    }
    const values = calm[sort];
    const place = (list: string, keys: string[]) => {
      const prev = calm.orders.get(`${list}:${sort}`);
      const next =
        looking && prev
          ? held(prev, keys)
          : settle(prev ?? { order: [], ahead: new Map() }, new Map(keys.map((k) => [k, values.get(k) ?? 0])), MARGIN[sort]);
      calm.orders.set(`${list}:${sort}`, next);
    };
    place("projects", [...groups.keys()].map((id) => `p:${id}`));
    for (const g of groups.values()) for (const [wt, list] of g.checkouts) place(`wt:${wt}`, list.map((p) => String(p.pid)));
  }
  const ordered = <T,>(list: string, items: T[], key: (t: T) => string) => {
    const order = calm.orders.get(`${list}:${sort}`)?.order ?? [];
    return [...items].sort((a, b) => order.indexOf(key(a)) - order.indexOf(key(b)));
  };
  const cpu = (k: string) => calm.cpu.get(k) ?? 0;
  const mem = (k: string) => calm.memory.get(k) ?? 0;

  const projects = ordered("projects", [...groups.values()], (g) => `p:${g.id}`);
  const busiest = Math.max(1, ...projects.map((g) => (sort === "cpu" ? cpu(`p:${g.id}`) : mem(`p:${g.id}`))));
  const total = projects.reduce((t, g) => ({ cpu: t.cpu + cpu(`p:${g.id}`), memory: t.memory + mem(`p:${g.id}`) }), { cpu: 0, memory: 0 });
  const count = processes?.length ?? 0;

  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (!n.delete(id)) n.add(id);
      writeOpen(n);
      return n;
    });

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

  const portLink = (port: number) => (
    <button key={port} className="link-btn act-port" onClick={() => void openLink(`http://localhost:${port}`)} title={`Open localhost:${port} in the browser`}>
      :{port}
    </button>
  );

  const row = (p: Proc) => {
    const session = sessionOf(state, p);
    const left = leftRunning(state, p);
    const k = String(p.pid);
    return (
      <tr key={p.pid} data-flip={`pid:${p.pid}`} className={left ? "is-left" : undefined}>
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
              <span className="act-left" title="Running here while no session or terminal in this project is: likely a dev server or test browser left behind">
                Left running
              </span>
            ) : session ? (
              <button className="link-btn" onClick={() => selectAgent(session)} title="Open the session that started it">
                {session.name}
              </button>
            ) : p.nebula ? (
              <span className="act-muted" title="Started by one of this checkout's sessions; there's more than one, so which isn't known">
                a session
              </span>
            ) : null}
            {p.ports.map(portLink)}
          </div>
        </td>
        <td className="num" title="CPU, as a share of one core, smoothed over the last few reads">
          {percent(cpu(k))}
        </td>
        <td className="num" title="Memory it holds (resident)">
          {bytes(mem(k))}
        </td>
        <td className="num act-muted" title="How long it has been running">
          {uptime(p.elapsed)}
        </td>
        <td className="act-actions">
          <button className="btn btn-sm" onClick={() => confirmStop(p, false)} title={`Ask ${p.name} to quit (pid ${p.pid})`}>
            Stop
          </button>
          <button className="btn btn-sm btn-rare" onClick={() => confirmStop(p, true)} title={`End ${p.name} at once, without letting it save (pid ${p.pid})`}>
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
              ? `Your projects: ${bytes(total.memory)} · ${percent(total.cpu)} CPU · ${count} ${count === 1 ? "process" : "processes"}`
              : "Reading what's running in your projects…"}
          </p>
        </div>
        <div className="usage-controls" ref={controls}>
          <span className={`act-paused${looking ? " is-on" : ""}`} aria-live="polite">
            {looking ? "Order paused while you look" : ""}
          </span>
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Sort by">
            {(["cpu", "memory"] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={sort === s}
                className={sort === s ? "is-on" : ""}
                onClick={() => setSort(s)}
                title={s === "cpu" ? "Busiest first: CPU, as a share of one core" : "Largest first: the memory each holds"}
              >
                {s === "cpu" ? "CPU" : "Memory"}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={() => void refreshActivity()} title="Read what's running now, instead of waiting for the next read">
            Refresh
          </button>
          <button className="btn btn-sm" onClick={() => setState({ view: "sessions" })} title="Back to sessions (Esc)">
            Done
          </button>
        </div>
      </header>

      <div className="usage-body" ref={body} onMouseEnter={() => setLooking(true)} onMouseLeave={() => setLooking(false)}>
        {error && <p className="usage-empty" role="alert">Couldn't read what's running: {error}</p>}
        {processes && !projects.length && <p className="usage-empty">Nothing is running in your projects' folders.</p>}
        {projects.length > 0 && (
          <ul className="act-projects">
            {projects.map((g) => {
              const project = state.projects[g.id];
              const key = `p:${g.id}`;
              const unfolded = open.has(g.id);
              const share = (sort === "cpu" ? cpu(key) : mem(key)) / busiest;
              const ports = [...new Set(g.ports)].sort((a, b) => a - b);
              return (
                <li key={g.id} data-flip={key} className={`act-project${unfolded ? " is-open" : ""}`}>
                  <div className="act-head">
                    <button
                      className="act-toggle"
                      onClick={() => toggle(g.id)}
                      aria-expanded={unfolded}
                      title={unfolded ? "Hide its processes" : "Show its processes, by checkout"}
                    >
                      <span className="act-chev" aria-hidden>
                        {unfolded ? "▾" : "▸"}
                      </span>
                      <ProjectDot project={project} />
                      <span className="act-pname">{project?.name ?? "Unknown project"}</span>
                      <span className="act-count">
                        {g.count} {g.count === 1 ? "process" : "processes"}
                      </span>
                      {g.left > 0 && (
                        <span className="act-left" title="Processes running here while no session or terminal in this project is">
                          {g.left} left running
                        </span>
                      )}
                    </button>
                    <span className="act-ports">{ports.slice(0, 3).map(portLink)}</span>
                    <span className="act-trend" title="CPU over the last minute or so">
                      <Spark values={calm.spark.get(g.id) ?? []} />
                    </span>
                    <span className="act-bar" title={`${Math.round(share * 100)}% of the busiest project's ${sort === "cpu" ? "CPU" : "memory"}`}>
                      <span style={{ width: `${Math.max(2, share * 100)}%` }} />
                    </span>
                    <span className="act-num" title="CPU, as a share of one core">
                      {percent(cpu(key))}
                    </span>
                    <span className="act-num" title="Memory its processes hold">
                      {bytes(mem(key))}
                    </span>
                  </div>
                  {unfolded &&
                    [...g.checkouts.entries()].map(([id, list]) => {
                      const wt = state.worktrees[id];
                      const all = smallShown.has(id);
                      const shown = ordered(`wt:${id}`, all ? list : list.filter((p) => !small(p)), (p) => String(p.pid));
                      const hidden = list.length - shown.length;
                      return (
                        <div key={id} className="act-checkout">
                          {g.checkouts.size > 1 && <h3>{wt?.is_main ? "Main checkout" : `on ${wt?.branch}`}</h3>}
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
                          {(hidden > 0 || all) && list.some(small) && (
                            <button
                              className="link-btn act-more"
                              onClick={() =>
                                setSmallShown((o) => {
                                  const n = new Set(o);
                                  if (!n.delete(id)) n.add(id);
                                  return n;
                                })
                              }
                              title="Idle shells and helpers, using next to nothing"
                            >
                              {all ? "Hide the small ones" : `${hidden} small ${hidden === 1 ? "process" : "processes"}`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                </li>
              );
            })}
          </ul>
        )}
        {at > 0 && (
          <p className="usage-note">
            Read every few seconds while this is open. Numbers are smoothed, and a row moves up only when it's clearly ahead, so
            the list stays put while you read it. CPU is a share of one core.
          </p>
        )}
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
    <span
      className={`load-meter is-${level}`}
      title={`What's running in this project: ${text}. Activity (⌥⌘U) shows each process.`}
      aria-label={text}
    >
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
