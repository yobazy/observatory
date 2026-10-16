// What's running in your projects (activity.rs): processes whose working
// folder is in a checkout, and what they started. Read every few seconds
// while the Activity view is open, and now and then otherwise, for the
// sidebar's quiet hint on a busy project. Kept out of the app's state: it
// changes often and only two places read it.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { getState, type State } from "./store";
import type { Agent } from "./types";

export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  command: string;
  /** Percent of one core. */
  cpu: number;
  /** Resident memory, bytes. */
  memory: number;
  /** Running for, seconds. */
  elapsed: number;
  /** The checkout's path. */
  worktree: string;
  /** Its own folder is in the checkout; otherwise something there started it. */
  direct: boolean;
  /** Started by one of nebula's sessions. */
  nebula: boolean;
  ports: number[];
}

interface Activity {
  processes: Proc[] | null;
  error: string | null;
  /** When it was last read, ms. */
  at: number;
}

let activity: Activity = { processes: null, error: null, at: 0 };
const listeners = new Set<() => void>();

function set(next: Partial<Activity>) {
  activity = { ...activity, ...next };
  listeners.forEach((l) => l());
}

export function useActivity(): Activity {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => activity,
  );
}

let reading = false;

export async function refreshActivity() {
  if (reading) return;
  reading = true;
  try {
    const s = getState();
    const roots = Object.values(s.worktrees).map((w) => w.path);
    const processes = isPreview()
      ? mockProcesses(s)
      : (await invoke<{ processes: Proc[] }>("activity_report", { roots })).processes;
    set({ processes, error: null, at: Date.now() });
  } catch (e) {
    set({ error: String(e) });
  } finally {
    reading = false;
  }
}

/** Mount once. */
export function useActivityPolling() {
  useEffect(() => {
    let last = 0;
    const tick = () => {
      if (document.hidden || !getState().loaded) return;
      const every = getState().view === "activity" ? 3_000 : 15_000;
      if (Date.now() - last >= every) {
        last = Date.now();
        void refreshActivity();
      }
    };
    tick();
    const t = setInterval(tick, 1_000);
    return () => clearInterval(t);
  }, []);
}

/** Ask a process to quit, or with `force` end it; the scan reads again. */
export async function stopProcess(pid: number, force: boolean) {
  if (!isPreview()) await invoke("stop_process", { pid, force });
  else set({ processes: (activity.processes ?? []).filter((p) => p.pid !== pid) });
  setTimeout(() => void refreshActivity(), 600);
}

export interface Load {
  count: number;
  cpu: number;
  memory: number;
}

/** Each project's processes added up, by project id. */
export function projectLoad(s: State, processes: Proc[]): Map<string, Load> {
  const byPath = new Map(Object.values(s.worktrees).map((w) => [w.path, w.project_id]));
  const out = new Map<string, Load>();
  for (const p of processes) {
    const id = byPath.get(p.worktree);
    if (!id) continue;
    const l = out.get(id) ?? { count: 0, cpu: 0, memory: 0 };
    l.count++;
    l.cpu += p.cpu;
    l.memory += p.memory;
    out.set(id, l);
  }
  return out;
}

/** Busy enough to mention in the sidebar. */
export const busy = (l: Load | undefined) => !!l && (l.cpu >= 10 || l.memory >= 500 * 1024 ** 2);

export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export const percent = (cpu: number) => `${cpu >= 10 ? Math.round(cpu) : cpu.toFixed(1)}%`;

export function uptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86_400)}d ${Math.floor((secs % 86_400) / 3600)}h`;
}

/** The session a process came from, when there's only one it can be. */
export function sessionOf(s: State, p: Proc): Agent | null {
  if (!p.nebula) return null;
  const wt = Object.values(s.worktrees).find((w) => w.path === p.worktree);
  const live = Object.values(s.agents).filter((a) => a.worktree_id === wt?.id && a.alive && !a.archived);
  return live.length === 1 ? live[0] : null;
}

/** Running in a project where nothing is at work: no session busy or
 *  waiting there, no terminal open, and not started by a session. A dev
 *  server or test browser left behind, most likely. */
export function leftRunning(s: State, p: Proc): boolean {
  if (p.nebula) return false;
  const wt = Object.values(s.worktrees).find((w) => w.path === p.worktree);
  if (!wt) return false;
  const checkouts = new Set(Object.values(s.worktrees).filter((w) => w.project_id === wt.project_id).map((w) => w.id));
  const working = Object.values(s.agents).some(
    (a) => checkouts.has(a.worktree_id) && (a.status === "running" || a.status === "needs_feedback"),
  );
  const terminal = Object.values(s.terminals).some((t) => checkouts.has(t.worktree_id) && t.alive);
  return !working && !terminal;
}

// ---- the browser preview's sample ----

function mockProcesses(s: State): Proc[] {
  const path = (id: string) => s.worktrees[id]?.path ?? "";
  const mb = 1024 ** 2;
  let pid = 4100;
  const p = (worktree: string, name: string, command: string, cpu: number, memory: number, elapsed: number, more: Partial<Proc> = {}): Proc => ({
    pid: pid++,
    ppid: 1,
    name,
    command,
    cpu,
    memory,
    elapsed,
    worktree: path(worktree),
    direct: true,
    nebula: false,
    ports: [],
    ...more,
  });
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  // A little drift between reads, so the view looks alive, and a dev
  // server that rebuilds now and then, so the order has a reason to change.
  const j = (n: number) => Math.max(0, n * (0.85 + Math.random() * 0.3));
  const rebuilding = Math.floor(Date.now() / 15_000) % 2 === 1;
  return [
    p("wm3", "Python", "uv run python -m jobs.invoice_worker --watch", j(114), 1680 * mb, 6 * 3600 + 1240),
    p("wm3", "uv", "uv run python -m jobs.invoice_worker --watch", 0, 22 * mb, 6 * 3600 + 1241),
    p("w1", "Google Chrome Helper (Renderer)", `${chrome} Helper (Renderer) --type=renderer --headless`, j(23), 610 * mb, 380, { direct: false, nebula: true }),
    p("w1", "Google Chrome", `${chrome} --headless=new --remote-debugging-pipe`, j(2), 180 * mb, 382, { direct: false, nebula: true }),
    p("w1", "node", "node ~/.npm/_npx/mcp-server-playwright/cli.js", j(0.4), 96 * mb, 900, { direct: false, nebula: true }),
    p("w1", "claude", "claude --model opus", j(3), 380 * mb, 1480, { nebula: true }),
    p("w0", "node", "node node_modules/.bin/vite --port 5173", j(1.2), 214 * mb, 3 * 3600 + 400, { ports: [5173] }),
    p("w0", "esbuild", "esbuild --service=0.25.1 --ping", j(0.1), 18 * mb, 3 * 3600 + 399),
    p("w0", "zsh", "-zsh", 0, 4 * mb, 5 * 3600),
    p("wm0", "node", "node node_modules/.bin/next dev -p 3000", j(rebuilding ? 160 : 8), 450 * mb, 2400, { ports: [3000], nebula: true }),
    p("wm0", "claude", "claude --model sonnet", j(1), 310 * mb, 2500, { nebula: true }),
    p("wm5", "node", "node scripts/watch.js", j(0.3), 64 * mb, 26 * 3600),
  ].filter((x) => x.worktree);
}
