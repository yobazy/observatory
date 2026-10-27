import { useEffect, useRef, useState, type RefObject } from "react";
import { findAll } from "../nebula/transcript";

// Highlights where the browser has them (CSS Custom Highlight API); without
// them, finding still moves you from one match to the next.
const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
const Mark = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** Every match of `query` in the thread's text, as ranges in reading order. */
function rangesIn(root: HTMLElement, query: string): Range[] {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    // Buttons say what they do; they aren't the thread.
    acceptNode: (n) => (n.parentElement?.closest("button, .rd-copy") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const out: Range[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    for (const at of findAll(n.textContent ?? "", query)) {
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + query.length);
      out.push(r);
    }
  }
  return out;
}

/** Find in the thread (⌘F in the Read view): a bar over the top of it, Enter
 *  for the next match and ⇧Enter for the one before, Esc to close. */
export function ReaderFind({
  scroller,
  version,
  onClose,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  /** Changes when the thread does, so the matches are found again. */
  version: unknown;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // After the replies' own effects (code coloring, PR links) have changed
    // their text, so the matches point at what's there.
    const frame = requestAnimationFrame(() => {
      const root = scroller.current?.querySelector<HTMLElement>(".rd-col");
      setRanges(root && query.trim() ? rangesIn(root, query) : []);
    });
    return () => cancelAnimationFrame(frame);
  }, [query, version]);
  useEffect(() => setAt(0), [query]);

  // Show the current match: open what folds it away, and scroll to it, but
  // only when you search or step; new replies arriving leave you where you are.
  const shownFor = useRef("");
  useEffect(() => {
    const r = ranges[Math.min(at, ranges.length - 1)];
    if (highlights && Mark) {
      highlights.set("rd-find", new Mark(...ranges));
      if (r) highlights.set("rd-find-now", new Mark(r));
      else highlights.delete("rd-find-now");
    }
    const el = scroller.current;
    const asked = `${query}\0${at}`;
    if (!r || !el || shownFor.current === asked) return;
    shownFor.current = asked;
    for (let d = r.startContainer.parentElement?.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
    const box = r.getBoundingClientRect();
    const view = el.getBoundingClientRect();
    if (box.top < view.top + 48 || box.bottom > view.bottom - 16) el.scrollTop += box.top - view.top - view.height / 3;
  }, [ranges, at]);
  useEffect(
    () => () => {
      highlights?.delete("rd-find");
      highlights?.delete("rd-find-now");
    },
    [],
  );

  const step = (by: number) => ranges.length && setAt((i) => (i + by + ranges.length) % ranges.length);
  return (
    <div className="rd-find" role="search">
      <input
        ref={input}
        autoFocus
        value={query}
        placeholder="Find in this thread"
        aria-label="Find in this thread"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "f" && e.metaKey) {
            e.preventDefault();
            input.current?.select();
          }
        }}
      />
      <span className="rd-find-count">{query.trim() ? (ranges.length ? `${Math.min(at, ranges.length - 1) + 1} of ${ranges.length}` : "None") : ""}</span>
      <button className="link-btn" onClick={() => step(-1)} disabled={!ranges.length} aria-label="Previous match">
        ↑
      </button>
      <button className="link-btn" onClick={() => step(1)} disabled={!ranges.length} aria-label="Next match">
        ↓
      </button>
      <button className="link-btn" onClick={onClose} aria-label="Close find">
        ×
      </button>
    </div>
  );
}
