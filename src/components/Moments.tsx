import { useEffect, useRef, useState } from "react";
import { dismissMoment, noteMoment, useMark } from "../nebula/moments";

/** After ⇧⌘M (moments.ts): says the moment's saved and its path copied, and
 *  takes a line on what you noticed. ↵ saves it, Esc goes without one. */
export function MomentCard() {
  const mark = useMark();
  const [note, setNote] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mark.kind === "saved") {
      setNote("");
      field.current?.focus();
    }
    if (mark.kind !== "error") return;
    const t = setTimeout(dismissMoment, 5000);
    return () => clearTimeout(t);
  }, [mark]);

  // Nothing while it saves, so the screenshot is what you saw.
  if (mark.kind === "idle" || mark.kind === "saving") return null;
  if (mark.kind === "error")
    return (
      <div className="notice" role="alert">
        Couldn’t mark this moment: {mark.message}
      </div>
    );

  return (
    <form
      className="notice moment-card"
      role="dialog"
      aria-label="Marked moment"
      onSubmit={(e) => {
        e.preventDefault();
        void noteMoment(note);
      }}
    >
      <p>
        <strong>Marked.</strong> Its path is copied: paste it wherever you’re reporting this.
        {mark.noScreenshot && <span className="moment-hint"> {mark.noScreenshot}</span>}
      </p>
      <input
        ref={field}
        className="setting-input"
        value={note}
        placeholder="What did you notice? (optional)"
        aria-label="What did you notice"
        spellCheck={false}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            dismissMoment();
          }
        }}
      />
      <div className="moment-actions">
        <button type="button" className="btn btn-sm" onClick={dismissMoment}>
          Skip
        </button>
        <button type="submit" className="btn btn-sm btn-primary">
          Save note
        </button>
      </div>
    </form>
  );
}
