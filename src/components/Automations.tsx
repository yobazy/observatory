import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOverlayKeys } from "./Overlay";
import { ConfirmDialog, type ConfirmDialogSpec } from "./Dialogs";
import { flash, setState, useAppState } from "../nebula/store";
import { ago, jobList, runAction, toneOf, until, worstHealth, type Job, type RestartConfirm } from "../nebula/automations";
import { logForPreview, readStatus, refreshAutomations, runJob } from "../nebula/automationsLoad";
import { baseName, openPreview } from "../nebula/preview";

/** The rows as of this minute; null until the first read lands. */
function useJobs() {
  const state = useAppState();
  return useMemo(
    () => (state.automations ? jobList(state.automations, state.prefs.automationLabels, Date.now(), state.automationWatch) : null),
    // Re-worked each minute too, so "about 5 min ago" and staleness move on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.automations, state.automationWatch, state.prefs.automationLabels, state.minute],
  );
}

const HEALTH_LABEL: Record<Job["health"], string> = {
  ok: "OK",
  running: "Running",
  failing: "Failing",
  stale: "Stale",
  "not loaded": "Not loaded",
};

type Status = { state: "reading" } | { state: "done"; text: string } | { state: "error"; text: string };

/** Background jobs on this Mac, each with its schedule, last and next run,
 *  health and log tail, and a way to run it now. */
export function AutomationsView() {
  const state = useAppState();
  const list = useJobs();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<ConfirmDialogSpec | null>(null);
  const [starting, setStarting] = useState<Set<string>>(new Set());
  /** The job whose Restart confirm is open. */
  const [asking, setAsking] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const controls = useRef<HTMLDivElement>(null);
  useOverlayKeys(controls);
  useEffect(() => void refreshAutomations(), []);

  const jobs = list?.jobs ?? [];
  const failing = jobs.filter((j) => j.health === "failing").length;
  const checkStatus = useCallback((label: string) => {
    setStatus((s) => ({ ...s, [label]: { state: "reading" } }));
    readStatus(label).then(
      (text) => setStatus((s) => ({ ...s, [label]: { state: "done", text } })),
      (e) => setStatus((s) => ({ ...s, [label]: { state: "error", text: String(e) } })),
    );
  }, []);
  const toggle = (j: Job) =>
    setOpen((o) => {
      const n = new Set(o);
      if (!n.delete(j.label)) {
        n.add(j.label);
        if (j.hasStatus) checkStatus(j.label);
      }
      return n;
    });
  /** The in-app confirm Restart waits on; closing it any other way is a no. */
  const confirm = (c: RestartConfirm) =>
    new Promise<boolean>((resolve) => {
      setDialog({
        kind: "confirm",
        ...c,
        onConfirm: async () => resolve(true),
      });
      closeDialog.current = () => resolve(false);
    });
  const closeDialog = useRef<() => void>(() => {});
  const run = async (j: Job) => {
    const mark = () => setStarting((s) => new Set(s).add(j.label));
    // A restart reads "Starting…" only once its confirm is accepted.
    if (!j.alwaysOn) mark();
    try {
      await runJob(j, async (c) => {
        setAsking(j.label);
        const ok = await confirm(c).finally(() => setAsking(null));
        if (ok) mark();
        return ok;
      });
    } catch (e) {
      flash(`Couldn't start ${j.name}: ${e instanceof Error ? e.message : e}`, 6000);
    } finally {
      setStarting((s) => {
        const n = new Set(s);
        n.delete(j.label);
        return n;
      });
    }
  };
  const openLog = async (path: string) => {
    try {
      await openPreview([await logForPreview(path)]);
      setState({ view: "sessions" });
    } catch (e) {
      flash(`Couldn't open ${path}: ${e instanceof Error ? e.message : e}`, 6000);
    }
  };
  const now = Date.now();

  return (
    <section className="usage automations" aria-labelledby="automations-title">
      <header className="usage-head" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 id="automations-title">Automations</h1>
          <p className="usage-sub">
            {list
              ? `Background jobs on this Mac: ${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}${failing ? `, ${failing} failing` : ""}. Last runs are read off each job's log and launchd's run count, so they're approximate.`
              : "Reading your launchd agents…"}
          </p>
        </div>
        <div className="usage-controls" ref={controls}>
          <button className="btn btn-sm" onClick={() => void refreshAutomations()} title="Read every job again now">
            Refresh
          </button>
          <button className="btn btn-sm" onClick={() => setState({ view: "sessions" })} title="Back to sessions (Esc)">
            Done
          </button>
        </div>
      </header>

      <div className="usage-body">
        {state.automationsError && (
          <p className="usage-empty" role="alert">
            Couldn't read your jobs: {state.automationsError}
            {list ? ". Showing the last read." : ""}
          </p>
        )}
        {list?.configError && (
          <p className="usage-empty" role="alert">
            {list.configError}. Names from it aren't shown.
          </p>
        )}
        {list && !jobs.length && (
          <p className="usage-empty">
            No launchd agents match the label prefixes in Settings › Automations.
          </p>
        )}
        {jobs.length > 0 && (
          <ul className="auto-list">
            {jobs.map((j) => {
              const unfolded = open.has(j.label);
              return (
                <li key={j.label} className={`auto-job${unfolded ? " is-open" : ""}`}>
                  <button
                    className="auto-head"
                    onClick={() => toggle(j)}
                    aria-expanded={unfolded}
                    title={unfolded ? "Hide the log tail" : "Show the log tail"}
                  >
                    <span className="act-chev" aria-hidden>{unfolded ? "▾" : "▸"}</span>
                    <span className={`auto-dot is-${toneOf(j.health)}`} aria-hidden />
                    <span className="auto-name">
                      <span className="auto-title">{j.name}</span>
                      {j.name !== j.label && <span className="auto-label">{j.label}</span>}
                    </span>
                    <span className="auto-cell">
                      <span className="auto-k">Schedule</span>
                      {j.schedule}
                    </span>
                    <span className="auto-cell" title={j.lastRun ? new Date(j.lastRun).toLocaleString() : undefined}>
                      <span className="auto-k">Last run</span>
                      {ago(j.lastRun, now)}
                    </span>
                    <span className="auto-cell" title={j.nextRun ? new Date(j.nextRun).toLocaleString() : undefined}>
                      <span className="auto-k">Next run</span>
                      {until(j.nextRun, now, j.health === "stale")}
                    </span>
                    <span className={`auto-health is-${toneOf(j.health)}`}>
                      <span className="auto-k">{HEALTH_LABEL[j.health]}</span>
                      <span className="auto-reason" title={j.reason}>{j.reason}</span>
                    </span>
                  </button>
                  {unfolded && (
                    <div className="auto-detail">
                      <div className="auto-actions">
                        {(() => {
                          const a = runAction(j);
                          return (
                            <button
                              className="btn btn-sm"
                              disabled={a.disabled || starting.has(j.label) || asking === j.label}
                              title={a.title}
                              onClick={() => void run(j)}
                            >
                              {starting.has(j.label) ? "Starting…" : a.label}
                            </button>
                          );
                        })()}
                        {j.logs.map((p) => (
                          <button key={p} className="btn btn-sm" onClick={() => void openLog(p)} title={`Open ${p} in the preview`}>
                            {j.logs.length === 1 ? "Open log" : `Open ${baseName(p)}`}
                          </button>
                        ))}
                      </div>
                      <dl className="auto-facts">
                        <dt>Runs on</dt>
                        <dd>{j.where}{j.pid != null ? `, pid ${j.pid}` : ""}</dd>
                        <dt>Command</dt>
                        <dd className="auto-mono">{j.command || "—"}</dd>
                        <dt>Plist</dt>
                        <dd className="auto-mono">{j.plistPath}</dd>
                        <dt>{j.logs.length === 1 ? "Log" : "Logs"}</dt>
                        <dd className="auto-mono">{j.logs.length ? j.logs.join("\n") : "None set in the plist"}</dd>
                      </dl>
                      {j.tail.length ? (
                        <pre className="auto-tail" aria-label={`Last ${j.tail.length} log lines`}>{j.tail.join("\n")}</pre>
                      ) : (
                        <p className="usage-note">{j.logs.length ? "The log is empty." : "No log to show."}</p>
                      )}
                      {j.hasStatus && (
                        <div className="auto-status">
                          <div className="auto-status-head">
                            <span className="auto-k">Status command</span>
                            <button
                              className="link-btn"
                              disabled={status[j.label]?.state === "reading"}
                              onClick={() => checkStatus(j.label)}
                            >
                              Check again
                            </button>
                          </div>
                          {status[j.label]?.state === "done" ? (
                            <pre className="auto-tail">{(status[j.label] as { text: string }).text || "(no output)"}</pre>
                          ) : status[j.label]?.state === "error" ? (
                            <p className="usage-note" role="alert">{(status[j.label] as { text: string }).text}</p>
                          ) : (
                            <p className="usage-note">Running it…</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {dialog && (
        <ConfirmDialog
          d={dialog}
          onClose={() => {
            closeDialog.current();
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

/** The sidebar footer's way in, with one dot for the worst job's health. */
export function AutomationsButton() {
  const state = useAppState();
  const list = useJobs();
  const on = state.view === "automations";
  const tone = list ? worstHealth(list.jobs.map((j) => j.health)) : null;
  const bad = list?.jobs.filter((j) => toneOf(j.health) === tone && tone !== "green") ?? [];
  const summary = !tone
    ? ""
    : tone === "green"
      ? "all healthy"
      : `${bad.length} ${tone === "red" ? "failing" : "need a look"}: ${bad.map((j) => j.name).join(", ")}`;
  return (
    <button
      className={`icon-btn foot-gear auto-btn${on ? " is-on" : ""}`}
      onClick={() => setState({ view: on ? "sessions" : "automations" })}
      aria-pressed={on}
      aria-label={`Automations${summary ? `, ${summary}` : ""}`}
      title={`Automations: your background jobs and their health${summary ? ` (${summary})` : ""}`}
    >
      <AutomationsGlyph />
      {tone && <span className={`auto-dot auto-btn-dot is-${tone}`} aria-hidden />}
    </button>
  );
}

function AutomationsGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
