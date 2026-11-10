import { useEffect, useState } from "react";
import { saveLead, useCards, type CardLead, type ProjectCard } from "../nebula/cards";
import { dollars } from "../nebula/budgetHold";
import { useSessionCosts } from "../nebula/budget";
import { DEFAULT_LEAD_MODEL, defaultNotes, leadModelOptions, leadName, leadState, MAX_INSTRUCTIONS, MAX_PERSONALITY } from "../nebula/lead";
import { setLeadActs, setLeadMaxTasks, setLeadModel, setLeadVoice, startedTasks, startProjectLead } from "../nebula/leadRunner";
import { DEFAULT_MAX_TASKS, useLeadActs } from "../nebula/leadActions";
import { sessionKey } from "../nebula/usageData";
import { flash, setState, useAppState } from "../nebula/store";
import { PET_CHOICES, personalityPresets, petFromKey, petKey, petOf, type LeadPet } from "../nebula/leadChat";
import { PetSprite } from "./Pet";
import { openLeadChat } from "../nebula/leadCalls";
import { Switch } from "./Settings";

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
                flash(`${projectName} has no lead now${state === "running" ? "; its thread is still there to archive" : ""}`);
              }}
            >
              Remove
            </button>
          )}
        </div>
        {lead && (
          <div className="card-row lead-acts">
            <Switch
              id={`lead-acts-${projectId}`}
              on={lead.acts === true}
              onChange={(on) => {
                setLeadActs(projectId, lead, on);
                flash(on ? `${projectName}'s lead can start and nudge threads` : `${projectName}'s lead's action lines are ignored now`);
              }}
            />
            <label htmlFor={`lead-acts-${projectId}`} className="dialog-note card-flat">
              Let the lead start and nudge threads
            </label>
          </div>
        )}
        {lead?.acts === true && (
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
        {lead && <LeadVoiceFields projectId={projectId} projectName={projectName} lead={lead} />}
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
                  lead?.acts === true
                    ? "It starts and nudges threads itself, within Dispatch's caps, and asks you before it merges or archives."
                    : "Anything it starts or follows up on opens for you to send."
                }`}
        </span>
      </div>
    </div>
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

/** What Settings and the chat say about a lead's personality and
 *  instructions: where they go, and that they can't override the app. */
export const VOICE_HELP =
  "Both go in the lead's prompt after the app's own rules: its notes file, how it handles events, what it may do, and which project it leads. Those come first and can't be overridden. A change takes effect on the lead's next start; a running lead is also told the new text now.";

/** A project lead's personality (a line, with presets that suit its pet)
 *  and your instructions to it. Each is saved when you leave it. */
export function LeadVoiceFields({ projectId, projectName, lead, help = true }: { projectId: string; projectName: string; lead: CardLead; help?: boolean }) {
  const { agents } = useAppState();
  const running = leadState(lead, agents) === "running";
  const pet = petOf(lead, projectName);
  const [personality, setPersonality] = useState(lead.personality ?? "");
  const [instructions, setInstructions] = useState(lead.instructions ?? "");
  // Changed from another place (the chat, or Settings): show what's saved.
  useEffect(() => setPersonality(lead.personality ?? ""), [lead.personality]);
  useEffect(() => setInstructions(lead.instructions ?? ""), [lead.instructions]);
  const save = (what: "personality" | "instructions", text: string) => {
    if (!setLeadVoice(projectId, lead, what, text)) return;
    flash(
      running
        ? `Told ${leadName(projectName)} its new ${what}, and saved it for its next start`
        : `${projectName}'s lead gets its new ${what} when it next starts`,
    );
  };
  const id = `lead-voice-${projectId}`;
  return (
    <div className="lead-voice">
      <label className="card-cap lead-voice-cap" htmlFor={`${id}-p`}>
        personality
      </label>
      <input
        id={`${id}-p`}
        className="setting-input lead-voice-line"
        value={personality}
        maxLength={MAX_PERSONALITY}
        placeholder="How it talks, e.g. dry and brief"
        spellCheck={false}
        onChange={(e) => setPersonality(e.target.value)}
        onBlur={() => save("personality", personality)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <div className="chips lead-voice-presets" role="group" aria-label={`Personalities that suit a ${pet.kind}`}>
        {personalityPresets(pet.kind).map((p) => (
          <button
            key={p}
            type="button"
            className={`chip${p === personality.trim() ? " is-on" : ""}`}
            aria-pressed={p === personality.trim()}
            onClick={() => {
              setPersonality(p);
              save("personality", p);
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <label className="card-cap lead-voice-cap" htmlFor={`${id}-i`}>
        instructions
      </label>
      <textarea
        id={`${id}-i`}
        className="lead-voice-text"
        rows={3}
        value={instructions}
        maxLength={MAX_INSTRUCTIONS}
        placeholder={"Added to its prompt, e.g.\nalways run checks on the pc\nnever touch the release"}
        onChange={(e) => setInstructions(e.target.value)}
        onBlur={() => save("instructions", instructions)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey) e.currentTarget.blur();
        }}
      />
      {help && <span className="dialog-note lead-voice-help">{VOICE_HELP}</span>}
    </div>
  );
}
