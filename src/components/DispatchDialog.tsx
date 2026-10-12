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
import { RouteReview } from "./RouteReview";

/** The day's to-do list: paste it in, check items off as they're done, and
 *  route what's left to projects (RouteReview). */
export function DispatchDialog({ initialText = "", onClose }: { initialText?: string; onClose: () => void }) {
  const items = useDispatchItems();
  const [text, setText] = useState(initialText);
  const pending = useMemo(() => parseList(text).length, [text]);
  const done = items.filter((i) => i.checked).length;
  const open = items.length - done;
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
              onClick={() => setRouting(items.filter((i) => !i.checked))}
              title="Propose where each item goes; nothing starts until you dispatch"
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
