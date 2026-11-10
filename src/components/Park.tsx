import { useState } from "react";
import { relativeTime } from "../nebula/status";
import { confirmPark, declinePark, dismissParked, undoLastPark, useParkStatus } from "../nebula/parkRunner";
import { parkedLine } from "../nebula/park";
import { openIdeas } from "../nebula/ideas";
import { useEscape } from "./Dialogs";

/** The first time parking is on and threads are due: the list, every one
 *  ticked, for you to untick any before they're filed away. */
export function ParkConfirm() {
  const { confirm } = useParkStatus();
  if (!confirm?.length) return null;
  return <ParkList key={confirm.map((t) => t.id).join(",")} />;
}

function ParkList() {
  const { confirm } = useParkStatus();
  const list = confirm ?? [];
  const [ticked, setTicked] = useState(() => new Set(list.map((t) => t.id)));
  const [busy, setBusy] = useState(false);
  useEscape(declinePark, busy);
  const toggle = (id: string) =>
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const n = ticked.size;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && declinePark()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="park-title"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void confirmPark(ticked);
        }}
      >
        <h2 id="park-title">Park {list.length} idle threads in Ideas?</h2>
        <p className="dialog-note">
          Each one becomes an idea in its project, with a brief of what was asked and where it got to, and its session
          is archived. Nothing is deleted: Resume in Ideas brings a thread back as it was, and Undo in the sidebar
          brings back the whole park. Untick any to keep open; they stay until they change. After this, threads idle as
          long park on their own.
        </p>
        <ul className="park-list">
          {list.map((t) => (
            <li key={t.id}>
              <label className="field-check">
                <input type="checkbox" checked={ticked.has(t.id)} onChange={() => toggle(t.id)} />
                <span className="park-name">{t.thread}</span>
                <span className="park-meta">
                  {t.project} · idle {relativeTime(t.status_changed_at)}
                  {t.unseen || t.label === "review" ? " · high priority" : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <footer className="dialog-foot">
          <button type="button" className="btn" onClick={declinePark} disabled={busy} title="Ask again next time the app starts">
            Not now
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Parking…" : n ? `Park ${n}` : "Park none"}
          </button>
        </footer>
      </form>
    </div>
  );
}

/** The sidebar's line after a park: how many, with Undo. */
export function ParkNotice() {
  const { last } = useParkStatus();
  if (!last?.items.length) return null;
  return (
    <div className="park-notice" role="status">
      <button className="link-btn" onClick={() => openIdeas()} title={last.items.map((i) => i.name).join("\n")}>
        {parkedLine(last)}
      </button>
      <span className="park-notice-actions">
        <button className="link-btn" onClick={() => void undoLastPark()} title="Unarchive every thread from this park and remove its ideas">
          Undo
        </button>
        <button className="icon-btn" onClick={dismissParked} aria-label="Dismiss" title="Dismiss">
          ×
        </button>
      </span>
    </div>
  );
}
