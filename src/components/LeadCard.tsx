import { useState } from "react";
import { saveLead, useCards, type ProjectCard } from "../nebula/cards";
import { dollars } from "../nebula/budgetHold";
import { useSessionCosts } from "../nebula/budget";
import { DEFAULT_LEAD_MODEL, defaultNotes, leadState } from "../nebula/lead";
import { setLeadModel, startProjectLead } from "../nebula/leadRunner";
import { sessionKey } from "../nebula/usageData";
import { flash, setState, useAppState } from "../nebula/store";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The lead's part of a project's card: Start a lead, or the running lead's
 *  model, notes and cost, or "Lead stopped" with Restart. `base` is the card
 *  as the dialog has it, saved with the lead when there's none saved yet. */
export function LeadSection({ projectId, projectName, base }: { projectId: string; projectName: string; base: ProjectCard }) {
  const lead = useCards()[projectId]?.lead;
  const { agents } = useAppState();
  const costs = useSessionCosts();
  const state = leadState(lead, agents);
  const [model, setModel] = useState(lead?.model || DEFAULT_LEAD_MODEL);
  const [notes, setNotes] = useState(lead?.notes || defaultNotes(projectName));
  const [busy, setBusy] = useState(false);
  const agent = lead ? agents[lead.agentId] : undefined;

  const start = () => {
    setBusy(true);
    startProjectLead(projectId, { model, notes: notes.trim() || defaultNotes(projectName), base })
      .then(() => flash(`Started ${projectName}'s lead`))
      .catch((e) => flash(`Couldn't start the lead: ${errText(e)}`))
      .finally(() => setBusy(false));
  };
  const applyModel = () => {
    if (!lead || !model.trim() || model.trim() === lead.model) return;
    setLeadModel(projectId, lead, model)
      .then(() => flash(state === "running" ? `Switching the lead to ${model.trim()}` : `The lead will use ${model.trim()}`))
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
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    setState({ view: "sessions", selectedProject: projectId, selectedSession: { Agent: agent.id } })
                  }
                >
                  Open {agent.name}
                </button>
                <span className="dialog-note card-flat">{dollars(agent.session_id ? (costs.get(sessionKey(agent.kind, agent.session_id)) ?? 0) : 0)} so far</span>
              </>
            )}
          </div>
        )}
        <div className="card-row">
          <label className="card-cap">
            model
            <input
              className="lead-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={applyModel}
              onKeyDown={(e) => {
                if (e.key === "Enter" && lead) {
                  e.preventDefault();
                  applyModel();
                }
              }}
              spellCheck={false}
              aria-label="The lead's model"
            />
          </label>
          {state === "none" ? (
            <button type="button" className="btn" disabled={busy} onClick={start}>
              {busy ? "Starting…" : "Start a lead"}
            </button>
          ) : state === "stopped" ? (
            <button type="button" className="btn" disabled={busy} onClick={start}>
              {busy ? "Starting…" : "Restart"}
            </button>
          ) : null}
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
              : "It hears of every task here. Anything it starts or follows up on opens for you to send."}
        </span>
      </div>
    </div>
  );
}
