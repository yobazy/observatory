import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cardFor, draftCard, saveLead, useCards } from "../nebula/cards";
import { readCardSources } from "../nebula/client";
import { dollars } from "../nebula/budgetHold";
import { useSessionCosts } from "../nebula/budget";
import { DEFAULT_LEAD_MODEL, defaultNotes, leadModelOptions, leadName, leadState } from "../nebula/lead";
import { levelFlash, setLeadLevel, setLeadMaxTasks, setLeadModel, startedTasks, startProjectLead, unguardLead } from "../nebula/leadRunner";
import { DEFAULT_LEVEL, LEVELS, levelOf, type LeadLevel } from "../nebula/leadLevel";
import { DEFAULT_MAX_TASKS, useLeadActs } from "../nebula/leadActions";
import { sessionKey } from "../nebula/usageData";
import { flash, setState, useAppState } from "../nebula/store";
import { petOf, type LeadPet } from "../nebula/leadChat";
import { openLeadChat } from "../nebula/leadCalls";
import { LeadAvatar } from "./LeadAvatar";
import { LeadVoiceFields, ModelPicker, PetPicker } from "./LeadCard";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Which project's lead settings are open, from anywhere: the project's
// menu or card, its chat, Settings › Leads. One at a time; LeadDialogHost
// shows it. Focus goes back to what opened it on close.
let openId: string | null = null;
let returnTo: HTMLElement | null = null;
const listeners = new Set<() => void>();
const watch = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const setOpen = (id: string | null) => {
  openId = id;
  listeners.forEach((l) => l());
};
/** Called when the dialog closes to show something else (a chat, a
 *  thread): a project card it was opened over closes too. */
const leaving = new Set<() => void>();
export const onLeadDialogLeave = (l: () => void) => {
  leaving.add(l);
  return () => void leaving.delete(l);
};
/** Close; `away` when it closes to show something else, so focus doesn't
 *  go back to what opened it and the card under it closes too. */
const close = (away = false) => {
  setOpen(null);
  const back = returnTo;
  returnTo = null;
  if (away) leaving.forEach((l) => l());
  else if (back?.isConnected) back.focus();
};

/** Open a project's lead settings. */
export function openLeadSettings(projectId: string) {
  if (!openId) returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setOpen(projectId);
}

/** The lead settings dialog, when one is open. Mounted once, in App. */
export function LeadDialogHost() {
  const id = useSyncExternalStore(watch, () => openId);
  const { projects } = useAppState();
  const project = id ? projects[id] : undefined;
  // A project removed while its lead's dialog was open: forget it, so it
  // doesn't pop up again if the project comes back.
  useEffect(() => {
    if (id && !project) setOpen(null);
  }, [id, project]);
  if (!id || !project) return null;
  return <LeadDialog key={id} projectId={id} projectName={project.name} folder={project.repo_path} />;
}

/** A project's lead, on its own: start it, or set what the running one may
 *  do, how it talks and what it runs on. Every change saves as it's made,
 *  except a new model on a running lead, which waits for Restart. */
function LeadDialog({ projectId, projectName, folder }: { projectId: string; projectName: string; folder: string }) {
  const lead = useCards()[projectId]?.lead;
  const app = useAppState();
  const { agents } = app;
  const costs = useSessionCosts();
  const state = leadState(lead, agents);
  // The model the lead runs on: "" in a lead saved before models were
  // picked means the default.
  const savedModel = lead?.model || DEFAULT_LEAD_MODEL;
  const [model, setModel] = useState(savedModel);
  const [notes, setNotes] = useState(lead?.notes || defaultNotes(projectName));
  // Picked before the lead starts; a lead's own once it has one.
  const [newLevel, setNewLevel] = useState<LeadLevel>(DEFAULT_LEVEL);
  const [newPet, setNewPet] = useState<LeadPet>(() => petOf(undefined, projectName));
  const [busy, setBusy] = useState(false);
  // Remove, or Restart of a running lead, waiting on a second click.
  const [confirming, setConfirming] = useState<"remove" | "restart" | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  const agent = lead ? agents[lead.agentId] : undefined;
  useLeadActs();
  const started = lead ? startedTasks(projectId, app) : [];
  const level = lead ? levelOf(lead) : newLevel;
  const pet = lead ? petOf(lead, projectName) : newPet;
  const name = leadName(projectName);
  const box = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;
  const done = useRef<HTMLButtonElement>(null);
  const levelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Picked on a running lead, but not restarted on yet.
  const modelPending = state === "running" && model.trim() !== savedModel;
  // A lead restarted or switched elsewhere while this is open: show what
  // it runs on now.
  useEffect(() => setModel(lead?.model || DEFAULT_LEAD_MODEL), [lead?.agentId, lead?.model]);

  useEffect(() => done.current?.focus(), []);
  // A confirm answered or put away: its buttons are gone, so focus goes to
  // Done rather than out of the dialog.
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirming && !box.current?.contains(document.activeElement)) done.current?.focus();
    wasConfirming.current = !!confirming;
  }, [confirming]);
  useEffect(() => {
    // Escape closes this dialog, not the view under it (Settings, a chat,
    // the project's card). An overlay opened on top (the palette) keeps it.
    // Tab stays inside it, as in any modal.
    const onKey = (e: KeyboardEvent) => {
      const at = document.activeElement;
      if (at && at !== document.body && !box.current?.contains(at)) return;
      if (e.key === "Tab" && box.current) {
        const all = [...box.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]")].filter(
          (el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0,
        );
        const first = all[0];
        const last = all[all.length - 1];
        // From nowhere (a button that went away), or off either end: wrap.
        if (!box.current.contains(at) || (e.shiftKey ? at === first : at === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
        return;
      }
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (confirmingRef.current) return setConfirming(null);
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const start = async () => {
    setConfirming(null);
    setBusy(true);
    try {
      // A project with no card yet gets one drafted from its folder, saved
      // with the lead.
      const had = !!cardFor(projectId);
      const base = cardFor(projectId) ?? draftCard(await readCardSources(folder).catch(() => ({ files: [], isGitRepo: false })));
      await startProjectLead(projectId, { model, notes: notes.trim() || defaultNotes(projectName), base, level: newLevel, pet: newPet });
      flash(
        state === "none"
          ? `Started ${projectName}'s lead as ${name}${had ? "" : ", and drafted the project's card from its files"}`
          : `Restarted ${name}${model.trim() !== savedModel ? ` on ${model.trim()}` : ""}`,
      );
    } catch (e) {
      flash(`Couldn't start the lead: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const pickModel = (next: string) => {
    setModel(next);
    // A running lead switches on Restart; a stopped one just remembers it.
    if (!lead || state === "running" || !next.trim() || next.trim() === lead.model) return;
    setLeadModel(projectId, lead, next)
      .then(() => flash(`The lead will use ${next.trim()}`))
      .catch((e) => flash(`Couldn't switch the lead's model: ${errText(e)}`));
  };
  const pickLevel = (next: LeadLevel) => {
    if (next === level) return;
    if (!lead) return setNewLevel(next);
    setLeadLevel(projectId, lead, next);
    flash(levelFlash(projectName, next));
  };
  const pickPet = (next: LeadPet) => {
    if (!lead) return setNewPet(next);
    saveLead(projectId, { ...lead, pet: next });
    flash(`${projectName}'s lead is a ${next.kind} now`);
  };
  const remove = () => {
    if (!lead) return;
    saveLead(projectId, undefined);
    void unguardLead(projectId);
    flash(`${projectName} has no lead now${state === "running" ? "; its thread is still there to archive" : ""}`);
    close();
  };
  // Arrow keys move the level, as in any radio group; Tab leaves it.
  const levelKeys = (e: React.KeyboardEvent, at: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (at + step + LEVELS.length) % LEVELS.length;
    pickLevel(LEVELS[next].level);
    levelRefs.current[next]?.focus();
  };
  const cost = agent?.session_id ? (costs.get(sessionKey(agent.kind, agent.session_id)) ?? 0) : 0;
  const modelLabel = leadModelOptions(model).find((o) => o.value === model.trim())?.label ?? model.trim();

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={box} className="dialog card-dialog lead-dialog" role="dialog" aria-modal="true" aria-labelledby="lead-dialog-title">
        <header className="lead-dialog-head">
          <LeadAvatar pet={pet} size={48} />
          <div className="lead-dialog-title">
            <h2 id="lead-dialog-title">{projectName} lead</h2>
            <p className="lead-dialog-meta">
              <LeadStateMark state={state} />
              {state !== "none" && <span>{name}</span>}
              {state === "running" && <span>{dollars(cost)} so far</span>}
              {state === "running" && agent && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    close(true);
                    openLeadChat(agent.id);
                  }}
                >
                  Open its chat
                </button>
              )}
            </p>
          </div>
        </header>

        <p className="dialog-note lead-dialog-about">
          {state === "none"
            ? `A thread in ${projectName}'s main checkout that hears when its tasks finish, fail, need you or open a PR, answers their questions about facts and past decisions, and keeps the project's notes. Set it up below; nothing runs until you start it.`
            : state === "stopped"
              ? "Its thread was archived or deleted, so it hears nothing. Restart starts a fresh one from its notes, keeping everything below."
              : `It hears of every task in ${projectName} and answers their questions as ${name}. It stays in this project: the app refuses anything it aims elsewhere. Changes save as you make them.`}
        </p>

        <section className="lead-sec" aria-labelledby="lead-sec-level">
          <h3 id="lead-sec-level">What it may do</h3>
          <div className="lead-levels-pick" role="radiogroup" aria-labelledby="lead-sec-level">
            {LEVELS.map((l, i) => (
              <button
                key={l.level}
                ref={(el) => {
                  levelRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={level === l.level}
                tabIndex={level === l.level ? 0 : -1}
                className={`lead-level-opt${level === l.level ? " is-on" : ""}`}
                onClick={() => pickLevel(l.level)}
                onKeyDown={(e) => levelKeys(e, i)}
              >
                <span className="lead-level-name">
                  {l.level} · {l.name}
                </span>
                <span className="lead-level-what">{l.what}</span>
              </button>
            ))}
          </div>
          {lead && level >= 3 && (
            <label className="card-cap lead-max-cap">
              Runs at most
              <input
                type="number"
                min={1}
                max={9}
                className="lead-max"
                value={maxDraft ?? String(lead.maxTasks ?? DEFAULT_MAX_TASKS)}
                // Empty while you type; a whole 1 to 9 is saved on Enter or
                // leaving the field, anything else goes back to what was saved.
                onChange={(e) => setMaxDraft(e.target.value)}
                onBlur={() => {
                  const n = Number(maxDraft);
                  if (maxDraft !== null && Number.isInteger(n) && n >= 1 && n <= 9) setLeadMaxTasks(projectId, lead, n);
                  setMaxDraft(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                aria-label="Tasks the lead may run at once"
              />
              tasks at once
            </label>
          )}
          {started.length > 0 && (
            <>
              <span className="lead-sub">Tasks it started</span>
              <ul className="lead-tasks" aria-label="Tasks the lead started">
                {started.slice(0, 8).map((t) => (
                  <li key={t.rec.taskId}>
                    {t.agent ? (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          close(true);
                          setState({ view: "sessions", selectedProject: projectId, selectedSession: { Agent: t.agent!.id } });
                        }}
                      >
                        {t.rec.branch}
                      </button>
                    ) : (
                      <span>{t.rec.branch}</span>
                    )}
                    <span className={`lead-task-state is-${t.label.startsWith("PR") ? "pr" : t.label}`}>{t.label}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="lead-sec" aria-labelledby="lead-sec-voice">
          <h3 id="lead-sec-voice">Personality</h3>
          <PetPicker pet={pet} label="What the lead looks like" onPick={pickPet} />
          {lead ? (
            <LeadVoiceFields projectId={projectId} projectName={projectName} lead={lead} />
          ) : (
            <span className="dialog-note">How it talks and your instructions to it can be set once it has started.</span>
          )}
        </section>

        <section className="lead-sec" aria-labelledby="lead-sec-run">
          <h3 id="lead-sec-run">Model and notes</h3>
          <ModelPicker model={model} label="The lead's model" onPick={pickModel} />
          <label className="card-cap lead-notes">
            notes
            <input
              className="setting-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={state === "running"}
              spellCheck={false}
              aria-label="The lead's notes file"
              title={notes}
            />
          </label>
          {modelPending ? (
            <span className="dialog-note lead-pending">
              Restart to switch it to {modelLabel}. Until then it stays on {savedModel}.
            </span>
          ) : state === "running" ? (
            <span className="dialog-note">Its notes file is set when it starts.</span>
          ) : null}
        </section>

        <footer className="dialog-foot">
          {confirming ? (
            <span className="hint lead-confirm" role="group" aria-label="Confirm">
              {confirming === "remove" ? `Remove ${projectName}'s lead?` : "Archive its thread and start a fresh one?"}
            </span>
          ) : lead ? (
            <button type="button" className="link-btn hint lead-remove" onClick={() => setConfirming("remove")}>
              Remove lead…
            </button>
          ) : (
            <span className="hint" />
          )}
          {confirming ? (
            <>
              {/* Focus on the safe answer, so a held Enter keeps it. */}
              <button type="button" className="btn" autoFocus onClick={() => setConfirming(null)}>
                Keep it
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => (confirming === "remove" ? remove() : void start())}
              >
                {confirming === "remove" ? "Remove" : "Restart"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={state === "none" || modelPending ? "btn btn-primary" : "btn"}
                disabled={busy}
                // A running lead's thread is archived on Restart, so it asks
                // first; a model switch says so on the button already.
                onClick={() => (state === "running" && !modelPending ? setConfirming("restart") : void start())}
                title={state === "running" ? "Archive its thread and start a fresh one from its notes" : undefined}
              >
                {busy ? "Starting…" : state === "none" ? "Start the lead" : modelPending ? `Restart on ${modelLabel}` : "Restart…"}
              </button>
              <button ref={done} type="button" className={state === "none" || modelPending ? "btn" : "btn btn-primary"} onClick={() => close()}>
                {state === "none" ? "Cancel" : "Done"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Whether a lead runs: a green Running, a grey Stopped or Not started. */
export function LeadStateMark({ state, small }: { state: "none" | "running" | "stopped"; small?: boolean }) {
  return (
    <span className={`lead-mark${state === "running" ? " is-running" : " is-stopped"}${small ? " is-small" : ""}`}>
      {state === "running" ? "Running" : state === "stopped" ? "Stopped" : "Not started"}
    </span>
  );
}
