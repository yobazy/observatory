// Finding paths and web links in a line of terminal text (termpaths.ts makes
// them links).
// Kept free of the app so its tests run under plain Node.

/** Terminal escape sequences: colors, cursor moves, OSC titles and links. */
// eslint-disable-next-line no-control-regex
export const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g;

export interface Found {
  /** Offset into the text, and the path as written. */
  start: number;
  text: string;
}

/** Text that may be a path: `~/`, `/`, `./` or `../` and segments, or bare
 *  segments ending in a file name with an extension. */
const CANDIDATE = /(?:~\/|\.{1,2}\/|\/)?(?:[\w@%+=,.-]+\/)*[\w@%+=,-][\w@%+=,.-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?![\w/])/g;
/** An absolute or `~/` path with spaces in its names, as a vault note's
 *  ("~/vault/Career/Call - Oct 2026.md"): it runs to the first file name
 *  with an extension. Whether it's a file is checked on disk, so a guess
 *  that swallows prose ("/tmp/x and notes.md") just doesn't become a link. */
const SPACED = /(?:~\/|(?<![\w.~-])\/)(?:[^/\s`'"](?:[^/`'"]*[^/\s`'"])?\/)+[^/\s`'"][^/`'"]*?\.[A-Za-z][A-Za-z0-9]{0,7}(?![\w/])/g;
/** URLs are someone else's links; their paths aren't files here. */
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/** The path-like runs in `text`. A bare name with no slash counts only with
 *  an extension worth previewing, so prose like "v1.2" or "e.g." stays put.
 *  Paths with spaces come first; the shorter runs inside them are only
 *  links when the longer one isn't a file. */
export function findPaths(text: string): Found[] {
  const masked = text.replace(URL, (m) => " ".repeat(m.length));
  const found: Found[] = [];
  for (const m of masked.matchAll(SPACED)) {
    const path = m[0].replace(/[.,]+$/, "");
    if (path.includes(" ")) found.push({ start: m.index!, text: path });
  }
  for (const m of masked.matchAll(CANDIDATE)) {
    let path = m[0];
    // A sentence's full stop or a closing quote is not part of the name.
    path = path.replace(/[.,]+$/, "");
    if (!path.includes("/") && !WORTH.test(path)) continue;
    found.push({ start: m.index!, text: path });
  }
  return found;
}

/** The web links in `text`: http(s) URLs printed as plain text, as an agent
 *  does when it ends a reply with one. A sentence's full stop and the
 *  bracket or quote around the URL are left off. */
export function findUrls(text: string): Found[] {
  const found: Found[] = [];
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    let url = m[0].replace(/[.,;:!?]+$/, "");
    // A closing bracket is the URL's own only when the URL opened it too,
    // as in .../Mercury_(planet). One around it, "(https://x.dev/a)", isn't.
    for (const [open, close] of [["(", ")"], ["[", "]"]]) {
      while (url.endsWith(close) && url.split(close).length > url.split(open).length) {
        url = url.slice(0, -1).replace(/[.,;:!?]+$/, "");
      }
    }
    if (/^https?:\/\/[^/]/i.test(url)) found.push({ start: m.index!, text: url });
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
  /** The last row the line takes, 0-based. */
  last: number;
}

/** The rows at most this far from the right edge still count as full. */
const EDGE = 4;
const PATHISH = /[\w./~@%+=,:?&#-]/;
/** The last absolute or `~/` path a row ends in, still going, and what
 *  follows its first slash. */
const OPEN_PATH = /(?:^|.*[\s(\[`'"])(?:~\/|\/)([^/\s`'"][^`'"]*\/[^/`'"]*)$/;
/** The most rows an app's own wrapping joins into one line, each way. */
const MAX_APP_ROWS = 32;

/** The logical line row `y` belongs to. Rows the terminal wrapped join as
 *  they are. So do rows an app wrapped itself, as Claude Code does when a
 *  path or URL is too long for the width: a row that runs to the right edge
 *  on a run with a `/` in it, followed by a row that goes on with a path
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
  /** Whether the row after `i` carries on row `i`'s line: "glued" when the
   *  app broke it mid-word, "spaced" when it broke a path with spaces at
   *  one of them, so the space goes back in. */
  const goesOn = (i: number): false | "glued" | "spaced" => {
    const here = row(i);
    const next = row(i + 1);
    if (!here || !next) return false;
    if (next.wrapped) return "glued";
    const last = end(here);
    const first = next.cells[indent(next)] ?? "";
    if (!PATHISH.test(here.cells[last - 1] ?? "") || !PATHISH.test(first)) return false;
    const text = here.cells.slice(0, last).join("");
    const tail = text.split(" ").pop() ?? "";
    if (last >= cols - EDGE && tail.includes("/")) return "glued";
    // Wrapped at a space: the next row's first word didn't fit on this one,
    // and this row ends inside a path with spaces that hasn't reached its
    // file name yet.
    const word = next.cells.slice(indent(next)).join("").split(" ")[0];
    if (last + 1 + word.length <= cols - EDGE) return false;
    const open = OPEN_PATH.exec(text);
    return open && open[1].includes(" ") && !/\.[A-Za-z][A-Za-z0-9]{0,7}(?:\s|$)/.test(open[1]) ? "spaced" : false;
  };
  // Rows the app wrapped join only so far: past that it's a block of output
  // (base64, a minified file), and joining all of it would make reading each
  // of its rows cost the whole block.
  let first = y;
  for (let hops = 0; first > 0 && goesOn(first - 1); first--) {
    if (!row(first)?.wrapped && ++hops > MAX_APP_ROWS) break;
  }
  let last = y;
  for (let hops = 0; goesOn(last); last++) {
    if (!row(last + 1)?.wrapped && ++hops > MAX_APP_ROWS) break;
  }

  let text = "";
  const at: Logical["at"] = [];
  for (let i = first; i <= last; i++) {
    const r = row(i);
    if (!r) break;
    // The space an app wrapped at sits on the row above's last cell.
    if (i > first && at.length && goesOn(i - 1) === "spaced") {
      text += " ";
      at.push(at[at.length - 1]);
    }
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
  return { text, at, last };
}
