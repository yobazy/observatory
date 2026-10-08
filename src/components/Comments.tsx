import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../nebula/store";
import {
  addComment,
  clearComments,
  recipients,
  removeComment,
  sendComments,
  type Target,
} from "../nebula/comments";
import type { PreviewFile } from "../nebula/preview";

/** Where the picked element is on screen, viewport px. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BOX_W = 300;
const BOX_H = 130;

/** "What should change?" beside the element just picked. Enter adds the
 *  comment, Shift+Enter is a new line, Esc leaves it. */
export function CommentBox({
  path,
  target,
  spot,
  onDone,
}: {
  path: string;
  target: Target;
  spot: Spot;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  const add = () => {
    if (note.trim()) addComment(path, target, note);
    onDone();
  };
  // Below the element, or above it when there's no room; inside the window.
  const left = Math.max(12, Math.min(spot.x, window.innerWidth - BOX_W - 12));
  const below = spot.y + spot.h + 8 + BOX_H < window.innerHeight;
  const top = below ? spot.y + spot.h + 8 : Math.max(12, spot.y - BOX_H - 8);
  return (
    <div
      className="comment-box"
      style={{ left, top, width: BOX_W }}
      role="dialog"
      aria-label="Comment"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <p className="comment-target" title={target.selector || undefined}>
        &lt;{target.tag}&gt; {target.text || "(no text)"}
      </p>
      <textarea
        ref={field}
        rows={2}
        value={note}
        placeholder="What should change?"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            add();
          }
        }}
      />
      <div className="comment-box-foot">
        <span className="hint">Enter to add</span>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={add} disabled={!note.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

/** The comments on a file so far, and Send: who gets them, and when. */
export function CommentPanel({ file }: { file: PreviewFile }) {
  const state = useAppState();
  const list = state.comments[file.path] ?? [];
  const who = useMemo(() => recipients(file.from), [file.from, state.agents, state.selectedSession]);
  const [to, setTo] = useState<string | null>(null);
  const agent = who.find((a) => a.id === to) ?? who[0];
  const unsent = list.filter((c) => !c.sent).length;
  const [busy, setBusy] = useState(false);
  if (!list.length) return null;
  const doc = file.kind === "markdown";

  return (
    <section className="comment-panel" aria-label="Comments">
      <ol>
        {list.map((c, i) => (
          <li key={c.id} className={c.sent ? "is-sent" : undefined}>
            <span className="comment-n">{i + 1}</span>
            <span className="comment-on" title={c.target.selector || undefined}>
              {c.target.text || `<${c.target.tag}>`}
            </span>
            <span className="comment-note">{c.note}</span>
            {c.sent && <span className="comment-sent">sent</span>}
            <button className="icon-btn" aria-label="Remove comment" title="Remove" onClick={() => removeComment(file.path, c.id)}>
              ×
            </button>
          </li>
        ))}
      </ol>
      <footer className="comment-foot">
        {who.length > 0 ? (
          <label className="comment-to">
            To
            <select value={agent?.id ?? ""} onChange={(e) => setTo(e.target.value)}>
              {who.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.id === file.from ? " (made this)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="hint">No task in this project to send to.</span>
        )}
        <button className="btn btn-sm" onClick={() => clearComments(file.path)} disabled={busy}>
          Clear
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={!agent || !unsent || busy}
          onClick={async () => {
            if (!agent) return;
            setBusy(true);
            try {
              await sendComments(file.path, doc, agent);
            } finally {
              setBusy(false);
            }
          }}
        >
          {unsent ? `Send ${unsent} ${unsent === 1 ? "comment" : "comments"}` : "All sent"}
        </button>
      </footer>
    </section>
  );
}
