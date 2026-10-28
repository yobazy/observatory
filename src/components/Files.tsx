import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { baseName, dirName, hideCard, hoverPath, leavePath, openPreview } from "../nebula/preview";
import { clearShelf, removeFromShelf, type ShelfItem } from "../nebula/shelf";
import { flash, getState, useAppState } from "../nebula/store";
import { sendInput } from "../nebula/client";
import { shellQuote } from "../nebula/dropfiles";
import { addToDraft, fileTarget, withPath } from "../nebula/drafts";
import { paneMode, setPaneMode } from "../nebula/pane";
import { editQueued } from "../nebula/queue";
import { relativeTime } from "../nebula/status";
import { summarize } from "../nebula/turnsummary";
import type { Agent, Worktree } from "../nebula/types";
import { ContextMenu, type MenuItem } from "./Menu";
import { appLabel, openFileIn } from "./Preview";
import { hasLog, useTurn } from "./TurnStrip";

const KIND_MARK: Record<string, string> = { html: "◧", htm: "◧", md: "¶", markdown: "¶", pdf: "⎘" };
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;

function mark(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return KIND_MARK[ext] ?? (IMAGE.test(path) ? "▣" : VIDEO.test(path) ? "▶" : "≡");
}

/** Where a file sits, said the short way: inside the checkout from its root,
 *  elsewhere from ~. */
function folder(path: string, root: string): string {
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (root && (dir === root || dir.startsWith(`${root}/`))) return dir.slice(root.length + 1) || "top of the checkout";
  return dirName(path);
}

/** Hand `path` to `agent` without typing it: into the reply you're writing
 *  in the Read view, the prompt queued for its next turn, or its prompt line
 *  in the terminal, whichever it would read next (fileTarget). */
export async function sendFile(agent: Agent, path: string) {
  const name = baseName(path);
  // A control character could end the paste early and run the rest as input.
  if (/[\x00-\x1f\x7f]/.test(path)) {
    flash(`${name}'s name has a control character in it, so it wasn't sent`);
    return;
  }
  const canRead = hasLog(agent);
  const queued = getState().queue[agent.id] ?? [];
  let to = fileTarget({ reading: canRead && paneMode() === "read", queued: queued.length, alive: agent.alive });
  // Without a conversation to read, there's no reply box to put it in.
  if (to === "draft" && !canRead) to = "terminal";
  const text = shellQuote(path);
  if (to === "draft") {
    addToDraft(agent.id, text);
    if (paneMode() !== "read") setPaneMode("read");
    flash(`Added ${name} to your reply`);
  } else if (to === "queue") {
    const last = queued[queued.length - 1];
    editQueued(agent.id, last.id, withPath(last.text, text));
    flash(`Added ${name} to the prompt queued for ${agent.name}`);
  } else {
    try {
      // A bracketed paste, as a file dropped on the terminal is: the CLI
      // takes it as pasted text, and nothing goes until you press Enter.
      await sendInput({ Agent: agent.id }, `\x1b[200~${text} \x1b[201~`);
      document.querySelector<HTMLElement>(".column-terminal .xterm-helper-textarea")?.focus();
      flash(`Added ${name} to ${agent.name}'s prompt`);
    } catch (e) {
      flash(`Couldn't send ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** A row in the list: a file, where it came from, and what's left to do
 *  with it besides opening it. */
interface Row {
  path: string;
  /** What to say on the right: when it was shown, or who showed it. */
  note: string;
  /** The session whose file it is: comments on the preview go to it. */
  from: string;
  /** On this session's shelf, so it can come off it. */
  own: boolean;
}

/** The files this task has shown: a chip each for a quick click, and the
 *  whole list, with more to do, behind "All". */
export function ShelfStrip({ agent, worktree, items }: { agent: Agent; worktree: Worktree | undefined; items: ShelfItem[] | undefined }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  if (!items?.length) return null;
  const chipActions = (path: string): MenuItem[] => [
    {
      label: "Open here",
      run: () => void openPreview([path], agent.id),
    },
    { label: `Send to ${agent.name}`, run: () => void sendFile(agent, path) },
    { label: "Remove from the shelf", destructive: true, separated: true, run: () => removeFromShelf(agent.id, path) },
  ];
  return (
    <div className="shelf-strip" aria-label="Files this task has shown">
      <span className="queue-label">Files</span>
      <ul>
        {items.map((item) => (
          <li key={item.path}>
            <button
              className="shelf-chip"
              title={`${dirName(item.path)}/${baseName(item.path)}\nRight-click to send it to ${agent.name}`}
              onClick={() => {
                hideCard();
                void openPreview([item.path], agent.id);
              }}
              onMouseEnter={(e) => hoverPath(item.path, e.clientX, e.clientY + 12, agent.id)}
              onMouseLeave={() => leavePath()}
              onContextMenu={(e) => {
                e.preventDefault();
                hideCard();
                setMenu({ path: item.path, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="shelf-mark" aria-hidden>
                {mark(item.path)}
              </span>
              {baseName(item.path)}
            </button>
            <button
              className="shelf-x"
              aria-label={`Remove ${baseName(item.path)} from the shelf`}
              title="Remove from the shelf"
              onClick={() => removeFromShelf(agent.id, item.path)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        className="shelf-all"
        aria-haspopup="dialog"
        aria-expanded={!!at}
        onClick={(e) => setAt(at ? null : e.currentTarget.getBoundingClientRect())}
        title="Every file, with where it is and what to do with it"
      >
        All {items.length} <span aria-hidden>▾</span>
      </button>
      {at && <FilesPanel agent={agent} worktree={worktree} items={items} anchor={at} onClose={() => setAt(null)} />}
      {menu && <ContextMenu items={chipActions(menu.path)} x={menu.x} y={menu.y} label={baseName(menu.path)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Every file the task has shown, the ones its branch's other sessions
 *  showed, and the ones its last turn changed: each to open here, in its
 *  app, in the editor or in Finder. */
function FilesPanel({
  agent,
  worktree,
  items,
  anchor,
  onClose,
}: {
  agent: Agent;
  worktree: Worktree | undefined;
  items: ShelfItem[];
  anchor: DOMRect;
  onClose: () => void;
}) {
  const state = useAppState();
  const turn = useTurn(agent);
  const panel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ row: Row; x: number; y: number } | null>(null);
  const root = worktree?.path ?? "";

  const own: Row[] = items.map((i) => ({ path: i.path, note: relativeTime(i.at), from: agent.id, own: true }));
  const seen = new Set(items.map((i) => i.path));
  const others: Row[] = [];
  for (const [id, shelf] of Object.entries(state.shelf)) {
    const other = state.agents[id];
    if (id === agent.id || !other || other.worktree_id !== agent.worktree_id) continue;
    for (const i of shelf) {
      if (seen.has(i.path)) continue;
      seen.add(i.path);
      others.push({ path: i.path, note: other.name, from: id, own: false });
    }
  }
  const changed: Row[] = turn
    ? summarize(turn, root)
        .edited.map((p) => (p.startsWith("/") ? p : `${root}/${p}`))
        .filter((p) => !seen.has(p))
        .map((path) => ({ path, note: "", from: agent.id, own: false }))
    : [];

  const q = query.trim().toLowerCase();
  const match = (r: Row) => !q || r.path.toLowerCase().includes(q);
  const total = own.length + others.length + changed.length;

  // Under its button, its right edge on the button's, kept in the window.
  const [pos, setPos] = useState({ top: anchor.bottom + 6, left: anchor.right - 440 });
  useLayoutEffect(() => {
    const r = panel.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: Math.min(anchor.bottom + 6, window.innerHeight - r.height - 8),
      left: Math.max(8, Math.min(anchor.right - r.width, window.innerWidth - r.width - 8)),
    });
  }, [anchor, total]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input, .fl-open")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !menu) onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!menu && !panel.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [menu, onClose]);

  const open = (r: Row) => {
    hideCard();
    onClose();
    void openPreview([r.path], r.from);
  };
  const actions = (r: Row): MenuItem[] => [
    { label: "Open here", run: () => open(r) },
    {
      label: `Send to ${agent.name}`,
      run: () => {
        onClose();
        void sendFile(agent, r.path);
      },
    },
    { label: `Open in ${appLabel(r.path).toLowerCase()}`, run: () => void openFileIn(r.path, "app") },
    { label: "Open in editor", run: () => void openFileIn(r.path, "editor") },
    { label: "Show in Finder", run: () => void openFileIn(r.path, "finder") },
    {
      label: "Copy path",
      separated: true,
      run: () =>
        void navigator.clipboard.writeText(r.path).then(
          () => flash(`Copied ${baseName(r.path)}'s path`),
          () => flash("Couldn't copy the path"),
        ),
    },
    ...(r.own ? [{ label: "Remove from the shelf", destructive: true, run: () => removeFromShelf(agent.id, r.path) }] : []),
  ];

  const section = (title: string, rows: Row[]) => {
    const shown = rows.filter(match);
    if (!shown.length) return null;
    return (
      <section className="fl-section">
        <h3>{title}</h3>
        <ul>
          {shown.map((r) => (
            <li
              key={r.path}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ row: r, x: e.clientX, y: e.clientY });
              }}
            >
              <button className="fl-open" onClick={() => open(r)} title={r.path}>
                <span className="shelf-mark" aria-hidden>
                  {mark(r.path)}
                </span>
                <span className="fl-name">{baseName(r.path)}</span>
                <span className="fl-where">{folder(r.path, root)}</span>
                {r.note && <span className="fl-note">{r.note}</span>}
              </button>
              <button
                className="icon-btn fl-more"
                aria-label={`More for ${baseName(r.path)}`}
                title="Open in its app or the editor, show in Finder, copy the path"
                onClick={(e) => {
                  const b = e.currentTarget.getBoundingClientRect();
                  setMenu({ row: r, x: b.left, y: b.bottom + 4 });
                }}
              >
                ⋯
              </button>
              {r.own && (
                <button
                  className="icon-btn fl-x"
                  aria-label={`Remove ${baseName(r.path)} from the shelf`}
                  title="Remove from the shelf"
                  onClick={() => removeFromShelf(agent.id, r.path)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  };

  const empty = q && ![...own, ...others, ...changed].some(match);
  return createPortal(
    <div ref={panel} className="files-panel" role="dialog" aria-label="Files" style={{ top: pos.top, left: pos.left }}>
      {total > 6 && (
        <input
          className="fl-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${total} files`}
          aria-label="Filter files"
          spellCheck={false}
        />
      )}
      <div className="fl-scroll">
        {section("Shown in this session", own)}
        {section("Shown by other sessions on this branch", others)}
        {section("Changed in the last turn", changed)}
        {empty && <p className="fl-empty">No file matches “{query.trim()}”.</p>}
      </div>
      <footer className="fl-foot">
        <span>Right-click a file to send it to {agent.name}, and more</span>
        <button
          className="link-btn"
          onClick={() => {
            clearShelf(agent.id);
            onClose();
          }}
        >
          Clear the shelf
        </button>
      </footer>
      {menu && <ContextMenu items={actions(menu.row)} x={menu.x} y={menu.y} label={baseName(menu.row.path)} onClose={() => setMenu(null)} />}
    </div>,
    document.body,
  );
}
