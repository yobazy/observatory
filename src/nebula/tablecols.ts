// Tables in a reply or a doc. Each sits in its own scroller, so a wide one
// scrolls sideways instead of squeezing its columns, and each column's right
// edge drags to resize it. Double-clicking an edge lets the columns size
// themselves again.

/** The narrowest a dragged column gets, in px. */
export const MIN_COL = 40;

/** Column widths after dragging column `i`'s edge by `dx`; the others keep
 *  theirs, so the table grows or shrinks by what that column did. */
export function resized(widths: number[], i: number, dx: number, min = MIN_COL): number[] {
  return widths.map((w, j) => (j === i ? Math.max(min, Math.round(w + dx)) : w));
}

/** Widths you dragged, by a table's header text, for as long as the app runs,
 *  so a table keeps them when its reply is shown again. */
const kept = new Map<string, number[]>();

const keyOf = (heads: HTMLElement[]) => heads.map((h) => h.textContent?.trim() ?? "").join("␟");

function setWidths(table: HTMLTableElement, heads: HTMLElement[], widths: number[]) {
  table.classList.add("is-sized");
  table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
  heads.forEach((h, i) => (h.style.width = `${widths[i]}px`));
}

function clearWidths(table: HTMLTableElement, heads: HTMLElement[]) {
  table.classList.remove("is-sized");
  table.style.width = "";
  heads.forEach((h) => (h.style.width = ""));
}

/** Make the tables under `root` scroll and resize; returns the undo. */
export function fitTables(root: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  for (const table of root.querySelectorAll("table")) {
    const heads = [...(table.rows[0]?.cells ?? [])] as HTMLElement[];
    if (!heads.length) continue;
    const wrap = document.createElement("div");
    wrap.className = "md-table";
    table.replaceWith(wrap);
    wrap.append(table);
    const key = keyOf(heads);
    const saved = kept.get(key);
    if (saved?.length === heads.length) setWidths(table, heads, saved);

    const grips = heads.map((th, i) => {
      const g = document.createElement("span");
      g.className = "col-grip";
      g.title = "Drag to resize this column. Double-click to fit the columns again";
      g.onclick = (e) => e.stopPropagation();
      g.ondblclick = (e) => {
        e.stopPropagation();
        clearWidths(table, heads);
        kept.delete(key);
      };
      g.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        // The first drag pins every column at the width it has now, so only
        // the dragged one moves.
        const start = heads.map((h) => h.getBoundingClientRect().width);
        setWidths(table, heads, start);
        const x0 = e.clientX;
        let now = start;
        g.setPointerCapture(e.pointerId);
        table.classList.add("is-resizing");
        g.onpointermove = (m) => {
          now = resized(start, i, m.clientX - x0);
          setWidths(table, heads, now);
        };
        g.onpointerup = g.onpointercancel = () => {
          g.onpointermove = g.onpointerup = g.onpointercancel = null;
          table.classList.remove("is-resizing");
          kept.set(key, now);
        };
      };
      th.append(g);
      return g;
    });

    undo.push(() => {
      grips.forEach((g) => g.remove());
      wrap.replaceWith(table);
    });
  }
  return () => undo.forEach((u) => u());
}
