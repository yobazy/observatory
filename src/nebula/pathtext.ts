// Finding paths in a line of terminal text (termpaths.ts makes them links).
// Kept free of the app so its tests run under plain Node.

export interface Found {
  /** Offset into the text, and the path as written. */
  start: number;
  text: string;
}

/** Text that may be a path: `~/`, `/`, `./` or `../` and segments, or bare
 *  segments ending in a file name with an extension. */
const CANDIDATE = /(?:~\/|\.{1,2}\/|\/)?(?:[\w@%+=,.-]+\/)*[\w@%+=,-][\w@%+=,.-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?![\w/])/g;
/** URLs are someone else's links; their paths aren't files here. */
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/** The path-like runs in `text`. A bare name with no slash counts only with
 *  an extension worth previewing, so prose like "v1.2" or "e.g." stays put. */
export function findPaths(text: string): Found[] {
  const masked = text.replace(URL, (m) => " ".repeat(m.length));
  const found: Found[] = [];
  for (const m of masked.matchAll(CANDIDATE)) {
    let path = m[0];
    // A sentence's full stop or a closing quote is not part of the name.
    path = path.replace(/[.,]+$/, "");
    if (!path.includes("/") && !WORTH.test(path)) continue;
    found.push({ start: m.index!, text: path });
  }
  return found;
}

export const WORTH = /\.(html?|md|markdown|mdx|png|jpe?g|gif|webp|svg|pdf)$/i;

// ---- lines a terminal app wrapped ----

/** One terminal row: each cell's text ("" for the second half of a wide
 *  character), and whether the terminal itself wrapped it from the row
 *  above. */
export interface Row {
  cells: string[];
  wrapped: boolean;
}

export interface Logical {
  text: string;
  /** Each character's cell, 1-based, as xterm's ranges want them. */
  at: { x: number; y: number }[];
}

/** The rows at most this far from the right edge still count as full. */
const EDGE = 4;
const PATHISH = /[\w./~@%+=,-]/;

/** The logical line row `y` belongs to. Rows the terminal wrapped join as
 *  they are. So do rows an app wrapped itself, as Claude Code does when a
 *  path is too long for the width: a row that runs to the right edge on a
 *  run with a `/` in it, followed by a row that goes on with a path
 *  character after its indent, is one line, the indent left out. Prose
 *  wrapped at a space ends on a plain word, so it stays apart. */
export function logicalLine(row: (i: number) => Row | undefined, y: number, cols: number): Logical {
  const end = (r: Row) => {
    let n = r.cells.length;
    while (n > 0 && (r.cells[n - 1] === " " || r.cells[n - 1] === "")) n--;
    return n;
  };
  const indent = (r: Row) => {
    let n = 0;
    while (n < r.cells.length && r.cells[n] === " ") n++;
    return n;
  };
  /** Whether the row after `i` carries on row `i`'s line. */
  const goesOn = (i: number) => {
    const here = row(i);
    const next = row(i + 1);
    if (!here || !next) return false;
    if (next.wrapped) return true;
    const last = end(here);
    if (last < cols - EDGE || !PATHISH.test(here.cells[last - 1] ?? "")) return false;
    const tail = here.cells.slice(0, last).join("").split(" ").pop() ?? "";
    if (!tail.includes("/")) return false;
    const first = next.cells[indent(next)] ?? "";
    return PATHISH.test(first);
  };
  let first = y;
  while (first > 0 && goesOn(first - 1)) first--;
  let last = y;
  while (goesOn(last)) last++;

  let text = "";
  const at: Logical["at"] = [];
  for (let i = first; i <= last; i++) {
    const r = row(i);
    if (!r) break;
    const from = i === first || r.wrapped ? 0 : indent(r);
    const to = i === last ? end(r) : row(i + 1)?.wrapped ? r.cells.length : end(r);
    for (let c = from; c < to; c++) {
      const ch = r.cells[c];
      if (ch === "") continue;
      for (const part of ch) {
        text += part;
        at.push({ x: c + 1, y: i + 1 });
      }
    }
  }
  return { text, at };
}
