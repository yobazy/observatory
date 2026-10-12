import { useEffect, useRef, useState } from "react";
import { readCardSources } from "../nebula/client";
import {
  cardFor,
  clearHome,
  draftCard,
  homeCard,
  isFolderKey,
  saveCard,
  splitList,
  withConcurrency,
  withPolicy,
  type CardSources,
  type ProjectCard,
} from "../nebula/cards";
import { flash, getState } from "../nebula/store";
import { Switch } from "./Settings";

/** Which card to edit: a project's (keyed by its id), or a plain folder's
 *  Home card (`folder:<path>`). `makeHome` opens it flagged as Home. */
export interface CardTarget {
  cardKey: string;
  name: string;
  folder: string;
  makeHome?: boolean;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a card's draft was read from, for the note under the description. */
const draftedFrom = (s: CardSources) =>
  s.files.some((f) => !f.path.startsWith(".claude/"))
    ? `Drafted from ${s.files
        .filter((f) => !f.path.startsWith(".claude/"))
        .map((f) => f.path)
        .join(", ")}.`
    : "No CLAUDE.md, AGENTS.md or README to draft from.";

/** A project's card: what lives there and how tasks run, for Dispatch to
 *  route against. Opened with a saved card, or a draft from the folder. */
export function CardDialog({ target, onClose }: { target: CardTarget; onClose: () => void }) {
  const { cardKey, folder } = target;
  const folderHome = isFolderKey(cardKey);
  const saved = useRef(cardFor(cardKey)).current;
  const [card, setCard] = useState<ProjectCard | null>(() =>
    saved && target.makeHome ? { ...saved, isHome: true } : saved,
  );
  const [skills, setSkills] = useState(saved?.skills.join(", ") ?? "");
  const [kinds, setKinds] = useState(saved?.taskKinds.join(", ") ?? "");
  // As typed, so the field can be cleared on the way to a new number.
  const [cap, setCap] = useState(String(saved?.concurrency ?? 1));
  const [sources, setSources] = useState<CardSources | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);

  const redraft = (draft: ProjectCard) => {
    setCard((c) => ({ ...(c ?? draft), description: draft.description, skills: draft.skills, skillNotes: draft.skillNotes }));
    setSkills(draft.skills.join(", "));
  };

  // Read the folder every time: a saved card needs to know whether
  // worktrees are possible, and Redraft needs the files.
  useEffect(() => {
    let live = true;
    readCardSources(folder)
      .then((s) => {
        if (!live) return;
        setSources(s);
        if (!saved) {
          const draft = draftCard(s);
          setCard(target.makeHome ? { ...withPolicy(draft, s.isGitRepo ? draft.policy : "shared"), isHome: true } : draft);
          setSkills(draft.skills.join(", "));
        }
      })
      .catch((e) => {
        if (!live) return;
        setReadError(errText(e));
        if (!saved) setCard({ ...draftCard({ files: [], isGitRepo: !folderHome }), isHome: !!target.makeHome || folderHome });
      });
    return () => {
      live = false;
    };
  }, [folder, saved, target.makeHome, folderHome]);

  // Focus the description once, when the card first shows.
  const ready = card !== null;
  useEffect(() => {
    if (ready) first.current?.focus();
  }, [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A folder with no git can't have worktrees, so it runs everything Shared.
  const canIsolate = !folderHome && sources?.isGitRepo !== false;
  const home = homeCard();
  const takingHome = card?.isHome && home && home.key !== cardKey;
  const homeName = home && (isFolderKey(home.key) ? home.card.homeFolder : getState().projects[home.key]?.name);

  function save() {
    if (!card) return;
    const names = splitList(skills);
    const next: ProjectCard = {
      ...withConcurrency(canIsolate ? card : withPolicy(card, "shared"), Number(cap)),
      skills: names,
      skillNotes: Object.fromEntries(Object.entries(card.skillNotes).filter(([k]) => names.includes(k))),
      taskKinds: splitList(kinds),
      homeFolder: card.isHome ? folder : null,
    };
    saveCard(cardKey, next);
    flash(next.isHome ? `${target.name} is Home` : `Saved ${target.name}'s card`);
    onClose();
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog card-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-title"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2 id="card-title">{folderHome ? "Home" : `${target.name} card`}</h2>
        <p className="dialog-note card-folder" title={folder}>
          {folder}
        </p>

        {!card ? (
          <p className="dialog-body">Reading the project…</p>
        ) : (
          <>
            <div className="field field-top">
              <label htmlFor="card-desc">Description</label>
              <div className="card-stack">
                <textarea
                  ref={first}
                  id="card-desc"
                  className="task-box card-desc"
                  rows={3}
                  value={card.description}
                  onChange={(e) => setCard({ ...card, description: e.target.value })}
                  placeholder="What lives here, so the router knows which tasks belong."
                />
                <span className="dialog-note">
                  {readError ? `Couldn't read the folder: ${readError}` : sources ? draftedFrom(sources) : ""}{" "}
                  {sources && saved && (
                    <button type="button" className="link-btn" onClick={() => redraft(draftCard(sources))}>
                      Redraft from files
                    </button>
                  )}
                </span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="card-skills">Skills</label>
              <input id="card-skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="apply, tracker" spellCheck={false} />
            </div>

            <div className="field">
              <label htmlFor="card-kinds">Task kinds</label>
              <input id="card-kinds" value={kinds} onChange={(e) => setKinds(e.target.value)} placeholder="job applications, outreach" />
            </div>

            <div className="field">
              <span className="field-label" id="card-policy">
                Tasks run
              </span>
              <div className="card-row">
                <div className="segmented" role="radiogroup" aria-labelledby="card-policy">
                  {(["isolated", "shared"] as const).map((p) => (
                    <button
                      type="button"
                      key={p}
                      role="radio"
                      aria-checked={card.policy === p}
                      className={card.policy === p ? "is-on" : ""}
                      disabled={p === "isolated" && !canIsolate}
                      onClick={() => setCard(withPolicy(card, p))}
                    >
                      {p === "isolated" ? "Isolated" : "Shared"}
                    </button>
                  ))}
                </div>
                {card.policy === "shared" && (
                  <label className="card-cap">
                    at most
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={cap}
                      onChange={(e) => setCap(e.target.value)}
                      onBlur={() => setCap(String(withConcurrency(card, Number(cap)).concurrency))}
                      aria-label="Tasks at once"
                    />
                    at once
                  </label>
                )}
              </div>
            </div>
            <p className="dialog-note card-indent">
              {card.policy === "isolated"
                ? "Each task gets its own worktree."
                : canIsolate
                  ? "Tasks run side by side in the main checkout. Pick this when the project keeps its own locks."
                  : "This folder isn't a git repo, so tasks run in it side by side."}
            </p>

            <div className="field">
              <label htmlFor="card-home">Home</label>
              {folderHome ? (
                <span className="dialog-note card-flat">Errands and scheduling run in this folder.</span>
              ) : (
                <div className="card-row">
                  <Switch id="card-home" on={card.isHome} onChange={(on) => setCard({ ...card, isHome: on })} />
                  <span className="dialog-note card-flat">Errands and scheduling run here.</span>
                </div>
              )}
            </div>
            {takingHome && <p className="dialog-note card-indent">Home moves here from {homeName ?? "another project"}.</p>}

            {card.isHome && (
              <div className="field field-top">
                <label htmlFor="card-sched">Scheduling</label>
                <div className="card-stack">
                  <textarea
                    id="card-sched"
                    className="task-box card-sched"
                    rows={3}
                    value={card.schedulingInstruction}
                    onChange={(e) => setCard({ ...card, schedulingInstruction: e.target.value })}
                    placeholder="Check my calendar, ask me for a time, then book it."
                  />
                  <span className="dialog-note">
                    How Home books time for tasks that are yours. Empty: they wait on the board as checkboxes.
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        <footer className="dialog-foot">
          {folderHome && cardFor(cardKey) ? (
            <button
              type="button"
              className="link-btn hint"
              onClick={() => {
                clearHome();
                flash("No Home set");
                onClose();
              }}
            >
              Stop using as Home
            </button>
          ) : (
            <span className="hint" />
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!card}>
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}
