import { useState } from "react";
import { saveLead, useCards, type ProjectCard } from "../nebula/cards";
import { dollars } from "../nebula/budgetHold";
import { useSessionCosts } from "../nebula/budget";
import { DEFAULT_LEAD_MODEL, defaultNotes, leadModelOptions, leadName, leadState } from "../nebula/lead";
import { levelFlash, setLeadLevel, setLeadMaxTasks, setLeadModel, startedTasks, startProjectLead, unguardLead } from "../nebula/leadRunner";
import { LEVELS, levelOf, type LeadLevel } from "../nebula/leadLevel";
import { DEFAULT_MAX_TASKS, useLeadActs } from "../nebula/leadActions";
import { sessionKey } from "../nebula/usageData";
import { flash, setState, useAppState } from "../nebula/store";
import { PET_CHOICES, petFromKey, petKey, petOf, type LeadPet } from "../nebula/leadChat";
import { PetSprite } from "./Pet";
import { openLeadChat } from "../nebula/leadCalls";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The lead's part of a project's card: Start a lead, or the running lead's
 *  model, notes and cost, or "Lead stopped" with Restart. `base` is the card
 *  as the dialog has it, saved with the lead when there's none saved yet. */
export function LeadSection({ projectId, projectName, base }: { projectId: string; projectName: string; base: ProjectCard }) {
  const lead = useCards()[projectId]?.lead;
  const app = useAppState();
  const { agents } = app;
  const costs = useSessionCosts();
  const state = leadState(lead, agents);
  const [model, setModel] = useState(lead?.model || DEFAULT_LEAD_MODEL);
  const [notes, setNotes] = useState(lead?.notes || defaultNotes(projectName));
  const [busy, setBusy] = useState(false);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  const agent = lead ? agents[lead.agentId] : undefined;
  useLeadActs();
  const started = lead ? startedTasks(projectId, app) : [];

  const start = () => {
    setBusy(true);
    startProjectLead(projectId, { model, notes: notes.trim() || defaultNotes(projectName), base })
      .then(() => flash(`Started ${projectName}'s lead as ${leadName(projectName)}`))
      .catch((e) => flash(`Couldn't start the lead: ${errText(e)}`))
      .finally(() => setBusy(false));
  };
  const pickModel = (next: string) => {
    setModel(next);
    if (!lead || !next.trim() || next.trim() === lead.model) return;
    setLeadModel(projectId, lead, next)
      .then(() => flash(state === "running" ? `Restarted the lead on ${next.trim()}` : `The lead will use ${next.trim()}`))
      .catch((e) => flash(`Couldn't switch the lead's model: ${errText(e)}`));
  };

  return (
    <div className="field field-top">
      <span className="field-label">Lead</span>
      <div className="card-stack lead-card">
        {state !== "none" && (
          <div className="card-row">
            <span className={`lead-mark${state === "stopped" ? " is-stopped" : ""}`}>{state === "running" ? "Lead" : "Lead stopped"}</span>
            {state === "running" && agent && (
              <>
                <button type="button" className="link-btn" onClick={() => openLeadChat(agent.id)}>
                  Open its chat
                </button>
                <span className="dialog-note card-flat">{dollars(agent.session_id ? (costs.get(sessionKey(agent.kind, agent.session_id)) ?? 0) : 0)} so far</span>
              </>
            )}
          </div>
        )}
        <div className="card-row">
          <ModelPicker model={model} label="The lead's model" onPick={pickModel} />
          {state === "none" ? (
            <button type="button" className="btn" disabled={busy} onClick={start}>
              {busy ? "Starting…" : "Start a lead"}
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={start}
              title={state === "running" ? "Archive its thread and start a fresh one from its notes" : undefined}
            >
              {busy ? "Starting…" : "Restart"}
            </button>
          )}
          {state !== "none" && (
            <button
              type="button"
              className="link-btn hint"
              onClick={() => {
                saveLead(projectId, undefined);
                void unguardLead(projectId);
                flash(`${projectName} has no lead now${state === "running" ? "; its thread is still there to archive" : ""}`);
              }}
            >
              Remove
            </button>
          )}
        </div>
        {lead && (
          <div className="card-row lead-acts">
            <LevelPicker
              id={`lead-level-${projectId}`}
              level={levelOf(lead)}
              onPick={(level) => {
                setLeadLevel(projectId, lead, level);
                flash(levelFlash(projectName, level));
              }}
            />
          </div>
        )}
        {lead && levelOf(lead) >= 3 && (
          <div className="card-row">
            {/* Its own row, so it never wraps beside the switch. */}
            <label className="card-cap lead-max-cap">
              at most
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
              at once
            </label>
          </div>
        )}
        {started.length > 0 && (
          <ul className="lead-tasks" aria-label="Tasks the lead started">
            {started.slice(0, 8).map((t) => (
              <li key={t.rec.taskId}>
                {t.agent ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setState({ view: "sessions", selectedProject: projectId, selectedSession: { Agent: t.agent!.id } })}
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
        )}
        {lead && (
          <PetPicker
            pet={petOf(lead, projectName)}
            label="The lead's animal"
            onPick={(pet) => {
              saveLead(projectId, { ...lead, pet });
              flash(`${projectName}'s lead is a ${pet.kind} now`);
            }}
          />
        )}
        <label className="card-cap lead-notes">
          notes
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={state === "running"}
            spellCheck={false}
            aria-label="The lead's notes file"
          />
        </label>
        <span className="dialog-note">
          {state === "none"
            ? "A thread in the main checkout that hears when this project's tasks finish, fail, need you or open a PR, and keeps the project's notes. Nothing runs until you start it."
            : state === "stopped"
              ? "Its thread was archived or deleted, so it hears nothing. Restart starts a fresh one from its notes."
              : `It hears of every task here and answers their questions about facts and past decisions as ${leadName(projectName)}. ${
                  LEVELS[levelOf(lead) - 1].what
                } It stays in this project: the app refuses anything it aims elsewhere.`}
        </span>
      </div>
    </div>
  );
}

/** A project lead's level (leadLevel.ts), 1 to 4, with what the picked one
 *  lets it do. The app refuses anything above it. */
export function LevelPicker({ id, level, onPick, compact }: { id: string; level: LeadLevel; onPick: (level: LeadLevel) => void; compact?: boolean }) {
  const info = LEVELS[level - 1];
  return (
    <span className={`lead-level${compact ? " is-compact" : ""}`}>
      <select
        id={id}
        className="setting-input"
        value={String(level)}
        onChange={(e) => onPick(Number(e.target.value) as LeadLevel)}
        aria-label="What the lead may do on its own"
        title={compact ? info.what : undefined}
      >
        {LEVELS.map((l) => (
          <option key={l.level} value={l.level}>
            {l.level} · {l.name}
          </option>
        ))}
      </select>
      {!compact && <span className="dialog-note card-flat">{info.what}</span>}
    </span>
  );
}

/** A lead's model, picked from Haiku, Sonnet and Opus (a saved model that
 *  isn't one of them shows as "Custom: <model>"). Picking one on a running
 *  lead restarts it on that model (#189). */
export function ModelPicker({ model, label, onPick }: { model: string; label: string; onPick: (model: string) => void }) {
  const options = leadModelOptions(model);
  return (
    <label className="card-cap lead-model-pick">
      model
      <select className="lead-model" value={model.trim()} onChange={(e) => onPick(e.target.value)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.hint ? `${o.label} · ${o.hint}` : o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Which pixel-pets animal a lead is (S27): what its pet looks like in the
 *  sidebar and when you talk to it. */
export function PetPicker({ pet, label, onPick }: { pet: LeadPet; label: string; onPick: (pet: LeadPet) => void }) {
  const kinds = [...new Set(PET_CHOICES.map((c) => c.kind))];
  return (
    <label className="card-cap lead-pet-pick">
      pet
      <span className="lead-pet" aria-hidden>
        <PetSprite kind={pet.kind} coat={pet.coat} width={34} />
      </span>
      <select
        value={petKey(pet)}
        onChange={(e) => {
          const next = petFromKey(e.target.value);
          if (next) onPick(next);
        }}
        aria-label={label}
      >
        {kinds.map((k) => (
          <optgroup key={k} label={k[0].toUpperCase() + k.slice(1)}>
            {PET_CHOICES.filter((c) => c.kind === k).map((c) => (
              <option key={petKey(c)} value={petKey(c)}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
