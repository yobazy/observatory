import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { getState, setState } from "./store";
import { fixPrompt, jobProject, runNow, track, type AutomationsReport, type Job, type RunDeps, type Watches } from "./automations";

const WATCH_KEY = "observatory.automations.watch";

function loadWatches(): Watches {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveWatches(w: Watches) {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(w));
  } catch {
    // Without it the app starts watching afresh next launch: no false stale.
  }
}

let loading = false;
/** Asked for mid-read (a Refresh click): read again once this one lands. */
let again = false;

export async function refreshAutomations() {
  if (loading) {
    again = true;
    return;
  }
  loading = true;
  try {
    const report = isPreview()
      ? (await import("./mock")).mockAutomations()
      : await invoke<AutomationsReport>("automations_report");
    const watches = track(loadWatches(), report.jobs, Date.now());
    saveWatches(watches);
    setState({ automations: report, automationsError: null, automationWatch: watches });
  } catch (e) {
    setState({ automationsError: String(e) });
  } finally {
    loading = false;
  }
  if (again) {
    again = false;
    void refreshAutomations();
  }
}

/** Mount once: keeps `state.automations` fresh — every 30 s while the view
 *  is open, every five minutes otherwise (the sidebar's health dot). */
export function useAutomationsPolling() {
  useEffect(() => {
    void refreshAutomations();
    let last = Date.now();
    const t = setInterval(() => {
      if (document.hidden) return;
      const every = getState().view === "automations" ? 30_000 : 300_000;
      if (Date.now() - last >= every) {
        last = Date.now();
        void refreshAutomations();
      }
    }, 5_000);
    return () => clearInterval(t);
  }, []);
}

let burst: ReturnType<typeof setInterval> | null = null;

/** Read again every 2 s for 30 s: a job just started shows its new run. */
export function refreshBurst() {
  if (burst) clearInterval(burst);
  let left = 15;
  burst = setInterval(() => {
    void refreshAutomations();
    if (--left <= 0 && burst) {
      clearInterval(burst);
      burst = null;
    }
  }, 2_000);
}

/** Run now (or Restart, after `confirm`), then watch for the new run. */
export async function runJob(job: Job, confirm: RunDeps["confirm"]): Promise<void> {
  const started = await runNow(job, {
    confirm,
    invoke: (cmd, args) => (isPreview() ? Promise.resolve() : invoke(cmd, args)),
  });
  if (started) refreshBurst();
}

/** The path Open log shows: the log itself, or, past the preview's 2 MB,
 *  a copy of its last 2 MB (automations.rs). */
export async function logForPreview(path: string): Promise<string> {
  if (isPreview()) return path;
  return invoke<string>("automations_log_preview", { path });
}

/** A job's own status command output, run now (automations.rs). */
export async function readStatus(label: string): Promise<string> {
  if (isPreview()) return "trigger url: set\ntoken: set\nlast fired: 2 h ago";
  return invoke<string>("automations_status", { label });
}

const FIX_PROJECT_KEY = "observatory.automations.fixProject";

/** Where "Fix with an agent" starts its task: the project the job's code is
 *  in, else the one you sent the last fix to, else the one you're in. */
export function fixProject(job: Job): string | null {
  const s = getState();
  const own = jobProject(job, Object.values(s.projects));
  if (own) return own;
  let last: string | null = null;
  try {
    last = localStorage.getItem(FIX_PROJECT_KEY);
  } catch {
    // Falls back to where you are.
  }
  if (last && s.projects[last]) return last;
  return s.selectedProject && s.projects[s.selectedProject] ? s.selectedProject : null;
}

/** Start an agent on a job in `projectId`'s main checkout, with what the
 *  panel shows about it, and stay on the panel. */
export async function fixJob(job: Job, projectId: string): Promise<void> {
  try {
    localStorage.setItem(FIX_PROJECT_KEY, projectId);
  } catch {
    // Not remembered next time; that's all.
  }
  const s = getState();
  const project = s.projects[projectId];
  const main = Object.values(s.worktrees).find((w) => w.project_id === projectId && w.is_main);
  if (!project || !main) throw new Error("that project has no main checkout");
  const { createAgent, defaultKind } = await import("./actions");
  const { readSettings } = await import("./client");
  const settings = await readSettings();
  const id = await createAgent({ worktree: main.id, kind: defaultKind(settings), settings, prompt: fixPrompt(job), select: false });
  if (!id) throw new Error("the daemon didn't start it");
  setState({ automationFixes: { ...getState().automationFixes, [job.label]: id } });
}
