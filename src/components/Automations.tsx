import { useEffect, useMemo, useRef, useState } from "react";
import { useOverlayKeys } from "./Overlay";
import { setState, useAppState } from "../nebula/store";
import { ago, jobList, toneOf, until, worstHealth, type Job } from "../nebula/automations";
import { refreshAutomations } from "../nebula/automationsLoad";

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

/** Background jobs on this Mac, each with its schedule, last and next run,
 *  health and log tail. Read-only. */
export function AutomationsView() {
  const state = useAppState();
  const list = useJobs();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const controls = useRef<HTMLDivElement>(null);
  useOverlayKeys(controls);
  useEffect(() => void refreshAutomations(), []);

  const jobs = list?.jobs ?? [];
  const failing = jobs.filter((j) => j.health === "failing").length;
  const toggle = (label: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (!n.delete(label)) n.add(label);
      return n;
    });
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
                    onClick={() => toggle(j.label)}
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
                      {until(j.nextRun, now)}
                    </span>
                    <span className={`auto-health is-${toneOf(j.health)}`}>
                      <span className="auto-k">{HEALTH_LABEL[j.health]}</span>
                      <span className="auto-reason" title={j.reason}>{j.reason}</span>
                    </span>
                  </button>
                  {unfolded && (
                    <div className="auto-detail">
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
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
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
