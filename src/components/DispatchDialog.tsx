import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearChecked,
  parseList,
  pasteList,
  removeItem,
  toggleItem,
  useDispatchItems,
  type DispatchItem,
} from "../nebula/dispatch";
import { isDispatched, routableItems, useBatches } from "../nebula/batch";
import { batchSummary, dispatchedLine } from "../nebula/board";
import { setState, useAppState } from "../nebula/store";
import { RouteReview } from "./RouteReview";

/** What's been dispatched, in a line, and why any task couldn't start;
 *  the board (DispatchBoard.tsx) tracks each task. */
function DispatchedSummary({ onBoard }: { onBoard: () => void }) {
  const batches = useBatches();
  const { agents, queue } = useAppState();
  const tasks = useMemo(() => batches.filter((b) => !b.dismissed).flatMap((b) => b.tasks), [batches]);
  if (!tasks.length) return null;
  // The board's counts, so a session stopped at its plan says it needs you.
  const line = dispatchedLine(batchSummary(tasks, agents, (id) => queue[id]?.length ?? 0));
  const stuck = tasks.filter((t) => (t.state === "blocked" || t.state === "failed") && t.note);
  return (
    <div className="dialog-note dispatched" role="status">
      <p>
        Dispatched: {line}{" "}
        <button type="button" className="link-btn" onClick={onBoard}>
          Open the board
        </button>
      </p>
      {stuck.length > 0 && (
        <ul className="dispatch-context">
          {stuck.map((t) => (
            <li key={t.id}>
              “{t.text}”: {t.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The day's to-do list: paste it in, check items off as they're done, and
 *  route what's left to projects (RouteReview). */
export function DispatchDialog({ initialText = "", onClose }: { initialText?: string; onClose: () => void }) {
  const items = useDispatchItems();
  const batches = useBatches();
  const [text, setText] = useState(initialText);
  const pending = useMemo(() => parseList(text).length, [text]);
  const done = items.filter((i) => i.checked).length;
  // Items out in a batch still on the board aren't routed again: that
  // could launch them twice. Dismissing the batch frees the unchecked ones.
  const routable = useMemo(() => routableItems(items, batches), [items, batches]);
  const open = routable.length;
  const openBoard = () => {
    setState({ view: "dispatch" });
    onClose();
  };
  const box = useRef<HTMLTextAreaElement>(null);
  // The items being routed, as they were when Route was pressed.
  const [routing, setRouting] = useState<DispatchItem[] | null>(null);

  useEffect(() => {
    if (!routing) box.current?.focus();
  }, [routing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function add() {
    if (pasteList(text)) setText("");
  }

  if (routing) {
    return (
      <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <RouteReview items={routing} onBack={() => setRouting(null)} onClose={onClose} />
      </div>
    );
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog dispatch"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-title"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <h2 id="dispatch-title">Dispatch</h2>

        <textarea
          ref={box}
          className="task-box"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              e.preventDefault();
              add();
            }
          }}
          placeholder={"Paste your to-do list, one item per line.\n  Indented lines add detail to the item above."}
          rows={items.length ? 3 : 6}
          aria-label="To-do list"
        />

        {items.length > 0 && (
          <ul className="dispatch-list" aria-label="Items">
            {items.map((i) => (
              <li key={i.id} className={`dispatch-item${i.checked ? " is-done" : ""}`}>
                <label>
                  <input type="checkbox" checked={i.checked} onChange={() => toggleItem(i.id)} />
                  <span className="dispatch-text">{i.text}</span>
                  {!i.checked && isDispatched(i, batches) && (
                    <span className="dispatch-tag" title="Out in a batch on the board; it won't be routed again until that batch is dismissed">
                      Dispatched
                    </span>
                  )}
                </label>
                {i.context.length > 0 && (
                  <ul className="dispatch-context">
                    {i.context.map((c, n) => (
                      <li key={n}>{c}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className="icon-btn dispatch-remove"
                  onClick={() => removeItem(i.id)}
                  title="Remove"
                  aria-label={`Remove ${i.text}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <DispatchedSummary onBoard={openBoard} />

        <footer className="dialog-foot">
          {done > 0 ? (
            <button type="button" className="link-btn hint" onClick={clearChecked}>
              Clear {done} done
            </button>
          ) : (
            <span className="hint">
              <kbd>⌘</kbd>
              <kbd>↵</kbd> to add
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {open > 0 && !pending ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setRouting(routable)}
              title="Propose where each item not yet dispatched goes; nothing starts until you dispatch"
            >
              Route {open === 1 ? "1 item" : `${open} items`}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!pending}>
              {pending > 1 ? `Add ${pending} items` : "Add item"}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
