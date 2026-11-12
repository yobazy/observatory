import { useEffect, useState } from "react";
import { type CardLead } from "../nebula/cards";
import { leadModelOptions, leadName, leadState, MAX_INSTRUCTIONS, MAX_PERSONALITY } from "../nebula/lead";
import { setLeadVoice } from "../nebula/leadRunner";
import { LEVELS, type LeadLevel } from "../nebula/leadLevel";
import { flash, useAppState } from "../nebula/store";
import { PET_CHOICES, personalityPresets, petFromKey, petKey, petOf, type LeadPet } from "../nebula/leadChat";
import { LeadAvatar } from "./LeadAvatar";

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
 *  isn't one of them shows as "Custom: <model>"). What a pick does is the
 *  caller's: the lead dialog waits for Restart, the top lead restarts. */
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

/** Which pixel-pets animal a lead is (S27): its face in the sidebar and
 *  its chat (S30). */
export function PetPicker({ pet, label, onPick }: { pet: LeadPet; label: string; onPick: (pet: LeadPet) => void }) {
  const kinds = [...new Set(PET_CHOICES.map((c) => c.kind))];
  return (
    <label className="card-cap lead-pet-pick">
      looks like
      <LeadAvatar pet={pet} size={34} />
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
        ? `Told ${leadName(projectName)} its new ${what}, which it keeps on its next start too`
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
