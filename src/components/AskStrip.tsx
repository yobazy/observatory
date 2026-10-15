import type { Choice, Question } from "../nebula/screen";

/** The choices a session is waiting on, as buttons: the same menu its
 *  terminal shows, answered without clicking into it. */
export function AskChoices({ question, onPick }: { question: Question; onPick: (c: Choice) => void }) {
  return (
    <div className="ask-choices" role="group" aria-label={question.prompt || "Choices"}>
      {question.choices.map((c) => (
        <button key={c.key} className={`qa-choice${c.selected ? " is-current" : ""}`} onClick={() => onPick(c)} title={c.label}>
          <kbd>{c.key}</kbd>
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Above the terminal while a session waits on a menu. */
export function AskStrip({ question, onPick }: { question: Question; onPick: (c: Choice) => void }) {
  return (
    <div className="ask-strip" aria-label="Waiting on your choice">
      {question.prompt && <p className="ask-q">{question.prompt}</p>}
      <AskChoices question={question} onPick={onPick} />
    </div>
  );
}
