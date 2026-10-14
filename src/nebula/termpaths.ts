// Paths in a terminal, as links: what an agent says it wrote ("Saved the
// mockup to mockups/checkout.html") lights up on hover with a preview card,
// and a click opens it in the preview (preview.ts). Only a path that is a
// file on disk becomes a link: absolute, `~/`, or relative to the session's
// checkout. A path the terminal wrapped onto the next row is still one path.
// Links an agent's CLI marks itself (OSC 8 `file://`) go the same way. Web
// URLs, marked or printed as plain text, open in the browser.
import type { IBufferRange, ILink, ILinkHandler, Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { hideCard, hoverPath, leavePath, openPreview } from "./preview";
import { findPaths, findUrls, logicalLine, WORTH, type Row } from "./pathtext";

// ---- existence, cached ----

const cache = new Map<string, { abs: string | null; at: number }>();
const TTL_MS = 10_000;

/** Which of `candidates` are files, as absolute paths (else null), cached. */
export async function resolve(candidates: string[], cwd: string | null): Promise<(string | null)[]> {
  if (isPreview()) return candidates.map((c) => (WORTH.test(c) ? c : null));
  const now = Date.now();
  const key = (c: string) => `${cwd ?? ""}\0${c}`;
  const unknown = candidates.filter((c) => {
    const hit = cache.get(key(c));
    return !hit || now - hit.at > TTL_MS;
  });
  if (unknown.length) {
    const abs = await invoke<(string | null)[]>("resolve_paths", { candidates: unknown, cwd }).catch(() =>
      unknown.map(() => null),
    );
    unknown.forEach((c, i) => cache.set(key(c), { abs: abs[i], at: now }));
  }
  return candidates.map((c) => cache.get(key(c))?.abs ?? null);
}

// ---- the link provider ----

/** Row `i` of the buffer as cells, for `logicalLine`. */
function rowOf(t: Terminal, i: number): Row | undefined {
  const line = t.buffer.active.getLine(i);
  if (!line) return undefined;
  const cells: string[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    cells.push(!cell ? " " : cell.getWidth() === 0 ? "" : cell.getChars() || " ");
  }
  return { cells, wrapped: line.isWrapped };
}

/** Open a web link in the browser (a new tab in the preview). */
function openWeb(url: string) {
  if (isPreview()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => {});
}

/** Make paths and web URLs in `t` hoverable and clickable. `cwd` is the
 *  session's checkout, for paths written relative to it. Returns the
 *  disposer. */
export function linkPaths(t: Terminal, cwd: () => string | null, owner: () => string | null = () => null): () => void {
  const provider = t.registerLinkProvider({
    provideLinks(row, callback) {
      const { text, at } = logicalLine((i) => rowOf(t, i), row - 1, t.cols);
      // Each row asks for its own links; a wrapped path or URL answers on
      // every row it covers.
      const rangeOf = (start: number, length: number): IBufferRange | null => {
        const range = { start: at[start], end: at[start + length - 1] };
        return range.end.y < row || range.start.y > row ? null : range;
      };
      const web: ILink[] = [];
      for (const u of findUrls(text)) {
        const range = rangeOf(u.start, u.text.length);
        if (!range) continue;
        web.push({
          range,
          text: u.text,
          decorations: { underline: true, pointerCursor: true },
          activate: () => openWeb(u.text),
        });
      }
      const found = findPaths(text);
      if (!found.length) return callback(web.length ? web : undefined);
      void resolve(
        found.map((f) => f.text),
        cwd(),
      ).then((abs) => {
        const links: ILink[] = [...web];
        found.forEach((f, i) => {
          const path = abs[i];
          if (!path) return;
          const range = rangeOf(f.start, f.text.length);
          if (!range) return;
          links.push({
            range,
            text: f.text,
            decorations: { underline: true, pointerCursor: true },
            activate: () => {
              hideCard();
              void openPreview([path], owner());
            },
            hover: (e) => hoverPath(path, e.clientX, e.clientY, owner()),
            leave: () => leavePath(),
          });
        });
        callback(links.length ? links : undefined);
      });
    },
  });
  return () => provider.dispose();
}

/** OSC 8 links an agent's CLI prints: `file://` ones preview like paths,
 *  web ones open in the browser. Anything else is ignored. */
export const osc8Links: ILinkHandler = {
  allowNonHttpProtocols: true,
  activate(_e, uri) {
    const path = fileOf(uri);
    if (path) {
      hideCard();
      void openPreview([path]);
    } else if (/^https?:\/\//i.test(uri)) {
      openWeb(uri);
    }
  },
  hover(e, uri) {
    const path = fileOf(uri);
    if (path) hoverPath(path, e.clientX, e.clientY);
  },
  leave() {
    leavePath();
  },
};

function fileOf(uri: string): string | null {
  if (!/^file:\/\//i.test(uri)) return null;
  try {
    const path = decodeURIComponent(new globalThis.URL(uri).pathname);
    return path.startsWith("/") ? path : null;
  } catch {
    return null;
  }
}
