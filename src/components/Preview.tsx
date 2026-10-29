import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { isPreview } from "../nebula/client";
import { flash, useAppState } from "../nebula/store";
import {
  baseName,
  cardPointer,
  closePreview,
  closePreviewFile,
  DEMO_HTML,
  describe,
  dirName,
  hideCard,
  openPreview,
  previewUrl,
  readText,
  showPreviewFile,
  useHover,
  type PreviewFile,
} from "../nebula/preview";
import { currentEditor } from "./Editor";
import { ContextMenu } from "./Menu";
import { CommentBox, CommentPanel, type Spot } from "./Comments";
import type { Target } from "../nebula/comments";
import { fitTables } from "../nebula/tablecols";
// The browser preview has no preview.rs to add comment mode's script, so
// it puts it into the demo page itself.
import PICK_JS from "../../src-tauri/src/pick.js?raw";

const WIDTHS = [
  { id: "phone", label: "Phone", px: 390 },
  { id: "tablet", label: "Tablet", px: 820 },
  { id: "full", label: "Full", px: 0 },
] as const;
type Width = (typeof WIDTHS)[number]["id"];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The files open in the preview, over the terminal or beside it. */
export function PreviewPane() {
  const { preview, prefs } = useAppState();
  const beside = prefs.previewPlacement === "beside";
  const root = useRef<HTMLElement>(null);
  const [width, setWidth] = useState<Width>("full");
  const [rev, setRev] = useState(0);
  const file = preview ? preview.files[preview.active] : undefined;
  const [commenting, setCommenting] = useState(false);
  const [picked, setPicked] = useState<{ target: Target; spot: Spot } | null>(null);
  const canComment = file?.kind === "html" || file?.kind === "markdown";
  const onPick = useCallback((target: Target, spot: Spot) => setPicked({ target, spot }), []);
  const stopCommenting = useCallback(() => {
    setPicked(null);
    setCommenting(false);
  }, []);
  // A different file starts out of comment mode.
  useEffect(() => stopCommenting(), [file?.path, stopCommenting]);

  // Over the terminal, the keyboard comes here, so Esc closes the preview
  // rather than reaching the agent (where it would interrupt the turn).
  useEffect(() => {
    if (!beside) root.current?.focus();
  }, [beside, !!preview]);

  // Live reload: the agent rewriting the file shows at once.
  const path = file?.path;
  useEffect(() => {
    if (!path || isPreview()) return;
    let last = -1;
    const timer = setInterval(async () => {
      const [modified] = await invoke<number[]>("preview_modified", { paths: [path] }).catch(() => [-1]);
      if (last >= 0 && modified !== last) setRev((r) => r + 1);
      last = modified;
    }, 1000);
    return () => clearInterval(timer);
  }, [path]);

  if (!preview || !file) return null;

  const close = () => {
    closePreview();
    // Back to the agent, with the keyboard where it was.
    document.querySelector<HTMLElement>(".column-terminal .xterm-helper-textarea")?.focus();
  };

  return (
    <section
      ref={root}
      className={`fpv${beside ? " is-beside" : " is-over"}`}
      aria-label="Preview"
      tabIndex={-1}
      onKeyDown={(e) => {
        const typing = (e.target as HTMLElement).closest("textarea, input, select");
        if (e.key === "Escape") {
          e.stopPropagation();
          // One step at a time: the comment box, then comment mode, then the preview.
          if (picked) setPicked(null);
          else if (commenting) stopCommenting();
          else close();
        } else if (
          (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
          !typing &&
          !(e.target as HTMLElement).closest("video") &&
          !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey &&
          preview.files.length > 1
        ) {
          // ← and → step through the open files, round from the last to the first.
          e.preventDefault();
          const n = preview.files.length;
          showPreviewFile((preview.active + (e.key === "ArrowRight" ? 1 : n - 1)) % n);
        } else if (e.key === "c" && !typing && !e.metaKey && !e.ctrlKey && canComment) {
          setCommenting((c) => !c);
          setPicked(null);
        }
      }}
    >
      <header className="fpv-head" data-tauri-drag-region>
        <div className="fpv-tabs" role="tablist" data-tauri-drag-region>
          {preview.files.map((f, i) => (
            <div
              key={f.path}
              className={`fpv-tab${i === preview.active ? " is-on" : ""}`}
              title={f.path}
              ref={i === preview.active ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
            >
              <button role="tab" aria-selected={i === preview.active} onClick={() => showPreviewFile(i)}>
                {baseName(f.path)}
              </button>
              <button className="fpv-tab-x" aria-label={`Close ${baseName(f.path)}`} onClick={() => closePreviewFile(i)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="fpv-actions">
          {canComment && (
            <button
              className={`btn btn-sm${commenting ? " btn-primary" : ""}`}
              aria-pressed={commenting}
              onClick={() => (commenting ? stopCommenting() : setCommenting(true))}
              title={commenting ? "Stop commenting (C)" : "Click parts of the page to comment on them (C)"}
            >
              {commenting ? "Done" : "Comment"}
            </button>
          )}
          <button className="icon-btn" onClick={() => setRev((r) => r + 1)} title="Reload" aria-label="Reload">
            ↻
          </button>
          <OpenMenu file={file} />
          <button className="icon-btn" onClick={close} aria-label="Close preview" title="Close (Esc)">
            ×
          </button>
        </div>
      </header>
      <div className="fpv-bar">
        <span className="fpv-where" title={file.path}>
          {dirName(file.path)}
        </span>
        {file.kind === "html" && (
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Width">
            {WIDTHS.map((w) => (
              <button
                key={w.id}
                role="radio"
                aria-checked={width === w.id}
                className={width === w.id ? "is-on" : ""}
                onClick={() => setWidth(w.id)}
              >
                {w.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {commenting && (
        <p className="fpv-commenting">Click what should change. Esc when you're done.</p>
      )}
      <div className="fpv-body">
        <FileView
          key={file.path}
          file={file}
          rev={rev}
          width={WIDTHS.find((w) => w.id === width)!.px}
          commenting={commenting}
          onPick={onPick}
          onEscape={stopCommenting}
        />
      </div>
      <CommentPanel file={file} />
      {picked && (
        <CommentBox
          key={`${picked.spot.x},${picked.spot.y}`}
          path={file.path}
          target={picked.target}
          spot={picked.spot}
          onDone={() => {
            setPicked(null);
            root.current?.focus();
          }}
        />
      )}
    </section>
  );
}

/** `path` somewhere other than here: the app macOS opens it with (the
 *  browser, for a page), the code editor picked in Settings, or Finder. Says
 *  so when it can't. */
export async function openFileIn(path: string, what: "app" | "editor" | "finder") {
  if (isPreview()) return flash(`Would open ${baseName(path)} in the ${what}.`);
  try {
    const opener = await import("@tauri-apps/plugin-opener");
    if (what === "finder") await opener.revealItemInDir(path);
    else if (what === "app") await opener.openPath(path);
    else {
      const app = currentEditor();
      if (!app) return flash("No code editor found. Pick one in Settings › General.");
      await invoke("open_in_editor", { path, app });
    }
  } catch (e) {
    flash(`Couldn't open ${baseName(path)}: ${errText(e)}`);
  }
}

/** What `openFileIn(path, "app")` opens it in, for a menu. */
export const appLabel = (path: string) => (/\.html?$/i.test(path) ? "Browser" : "Default app");

/** Its default app, editor, Finder: the file somewhere other than here. */
function OpenMenu({ file }: { file: PreviewFile }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const run = (what: "app" | "editor" | "finder") => openFileIn(file.path, what);
  const items = [
    { label: appLabel(file.path), run: () => void run("app") },
    { label: "Editor", run: () => void run("editor") },
    { label: "Show in Finder", run: () => void run("finder"), separated: true },
  ];
  return (
    <>
      <button
        className="btn btn-sm"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
      >
        Open in…
      </button>
      {at && <ContextMenu items={items} x={at.x} y={at.y} label="Open in" onClose={() => setAt(null)} />}
    </>
  );
}

interface Picking {
  commenting: boolean;
  onPick: (target: Target, spot: Spot) => void;
  onEscape: () => void;
}

function FileView({ file, rev, width, ...picking }: { file: PreviewFile; rev: number; width: number } & Picking) {
  switch (file.kind) {
    case "html":
      return <HtmlView file={file} rev={rev} width={width} {...picking} />;
    case "markdown":
      return <MarkdownView path={file.path} from={file.from} rev={rev} {...picking} />;
    case "image":
      return <ImageView file={file} rev={rev} />;
    case "video":
      return (
        <div className="fpv-stage fpv-image">
          <video key={rev} src={previewUrl(file.path, rev)} controls autoPlay playsInline />
        </div>
      );
    case "pdf":
      return <iframe className="fpv-frame fpv-pdf" title={baseName(file.path)} src={previewUrl(file.path, rev)} />;
    default:
      return <TextView path={file.path} rev={rev} />;
  }
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

/** A picture, fit to the pane. A click zooms to its real size where you
 *  clicked (or doubles a small one), another fits it again; pinch, ⌘-scroll,
 *  + and − zoom too, 0 fits. The bar under it says how big, and steps to the
 *  other open files when there are some. */
function ImageView({ file, rev }: { file: PreviewFile; rev: number }) {
  const { preview } = useAppState();
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // null fits it to the pane; a number is its scale, 1 for real pixels.
  const [zoom, setZoom] = useState<number | null>(null);
  const [fit, setFit] = useState(1);
  // The point of the picture to keep under the pointer as the zoom changes.
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);

  const scaleNow = () => {
    const el = img.current;
    return el?.naturalWidth ? el.getBoundingClientRect().width / el.naturalWidth : 1;
  };
  const fitScale = () => {
    const el = img.current;
    const box = stage.current;
    if (!el?.naturalWidth || !box) return 1;
    // The room inside the padding, which is taller at the bottom for the bar.
    const pad = getComputedStyle(box);
    const w = box.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    const h = box.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom);
    return Math.min(1, w / el.naturalWidth, h / el.naturalHeight);
  };
  const measure = () => setFit(fitScale());

  /** Zoom to `next` (null: fit), keeping the picture still at (x, y), or at
   *  the middle of the pane. */
  const zoomTo = useCallback((next: number | null, x?: number, y?: number) => {
    const el = img.current;
    const box = stage.current;
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const px = x ?? b.left + b.width / 2;
    const py = y ?? b.top + b.height / 2;
    anchor.current = { fx: (px - r.left) / r.width, fy: (py - r.top) / r.height, x: px, y: py };
    if (next !== null) next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    // Zoomed out to the fit or past it is just fit.
    setZoom(next !== null && next <= fitScale() + 0.001 ? null : next);
  }, []);
  const zoomBy = useCallback((factor: number, x?: number, y?: number) => zoomTo(scaleNow() * factor, x, y), [zoomTo]);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = img.current;
    const box = stage.current;
    anchor.current = null;
    if (!a || !el || !box || zoom === null) return;
    const r = el.getBoundingClientRect();
    box.scrollLeft += r.left + a.fx * r.width - a.x;
    box.scrollTop += r.top + a.fy * r.height - a.y;
  }, [zoom]);

  // Pinch (which arrives as a wheel with ctrl) and ⌘-scroll zoom; plain
  // scrolling still pans. Passive listeners can't stop the page zooming.
  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // + and − from anywhere in the preview, as ← and → are.
  useEffect(() => {
    const pane = stage.current?.closest<HTMLElement>(".fpv");
    if (!pane) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "=" || e.key === "+") zoomBy(1.25);
      else if (e.key === "-") zoomBy(0.8);
      else if (e.key === "0") zoomTo(null);
      else return;
      e.preventDefault();
    };
    pane.addEventListener("keydown", onKey);
    return () => pane.removeEventListener("keydown", onKey);
  }, [zoomBy, zoomTo]);

  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  const el = img.current;
  const zoomed = zoom !== null && !!el?.naturalWidth;
  const n = preview?.files.length ?? 0;
  const step = (by: number) => preview && showPreviewFile((preview.active + by + n) % n);
  return (
    <div className="fpv-picture">
      <div ref={stage} className={`fpv-stage fpv-image${zoomed ? " is-zoomed" : ""}`}>
        <img
          ref={img}
          src={previewUrl(file.path, rev)}
          alt={baseName(file.path)}
          draggable={false}
          onLoad={measure}
          style={zoomed ? { width: el!.naturalWidth * zoom!, height: el!.naturalHeight * zoom! } : undefined}
          title={zoomed ? "Click to fit" : "Click to zoom in"}
          onClick={(e) => zoomTo(zoomed ? null : Math.max(1, fitScale() * 2), e.clientX, e.clientY)}
        />
      </div>
      <div className="fpv-picbar" role="toolbar" aria-label="Picture">
        {n > 1 && (
          <>
            <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous file" title="Previous (←)">
              ‹
            </button>
            <span className="fpv-picbar-n">
              {preview!.active + 1} of {n}
            </span>
            <button className="icon-btn" onClick={() => step(1)} aria-label="Next file" title="Next (→)">
              ›
            </button>
            <span className="fpv-picbar-sep" />
          </>
        )}
        <button className="icon-btn" onClick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out (−)">
          −
        </button>
        <button
          className="fpv-picbar-pct"
          onClick={() => zoomTo(zoomed ? null : 1)}
          title={zoomed ? "Fit to the pane (0)" : "Real size"}
        >
          {zoomed ? `${Math.round(zoom! * 100)}%` : `Fit · ${Math.round(fit * 100)}%`}
        </button>
        <button className="icon-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (+)">
          +
        </button>
      </div>
    </div>
  );
}

/** A mockup, in a sandboxed frame. In comment mode the page comes with
 *  pick.js, which reports what's clicked and draws the pins sent to it. */
function HtmlView({
  file,
  rev,
  width,
  commenting,
  onPick,
  onEscape,
}: { file: PreviewFile; rev: number; width: number } & Picking) {
  const frame = useRef<HTMLIFrameElement>(null);
  const comments = useAppState().comments[file.path];
  const pins = JSON.stringify(
    (comments ?? []).map((c, i) => ({ n: i + 1, selector: c.target.selector, sent: c.sent })),
  );
  const post = useCallback(
    () => frame.current?.contentWindow?.postMessage({ observatory: true, type: "pins", pins: JSON.parse(pins) }, "*"),
    [pins],
  );
  useEffect(() => {
    if (!commenting) return;
    post();
    const onMessage = (e: MessageEvent) => {
      // Only the page in this frame, and only what pick.js says.
      if (e.source !== frame.current?.contentWindow || e.data?.observatory !== true) return;
      if (e.data.type === "ready") post();
      else if (e.data.type === "escape") onEscape();
      else if (e.data.type === "pick") {
        const at = frame.current!.getBoundingClientRect();
        const { selector, tag, text, rect } = e.data;
        onPick(
          { selector: String(selector), tag: String(tag), text: String(text) },
          { x: at.left + rect.x, y: at.top + rect.y, w: rect.width, h: rect.height },
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [commenting, post, onPick, onEscape]);

  const page = isPreview()
    ? { srcDoc: commenting ? DEMO_HTML.replace("</body>", `<script>${PICK_JS}</script></body>`) : DEMO_HTML }
    : { src: previewUrl(file.path, rev, commenting) };
  return (
    <div className="fpv-stage">
      <iframe
        ref={frame}
        key={`${rev}:${commenting}`}
        className="fpv-frame"
        style={width ? { width } : undefined}
        title={baseName(file.path)}
        // Scripts run, as a mockup's would in a browser, but in an
        // opaque origin: nothing of this app, its storage or its API.
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        {...page}
      />
    </div>
  );
}

function useText(path: string, rev: number): { text: string | null; error: string | null } {
  const [got, setGot] = useState<{ text: string | null; error: string | null }>({ text: null, error: null });
  useEffect(() => {
    let live = true;
    readText(path)
      .then((text) => live && setGot({ text, error: null }))
      .catch((e) => live && setGot({ text: null, error: errText(e) }));
    return () => {
      live = false;
    };
  }, [path, rev]);
  return got;
}

/** Markdown as HTML, sanitized: a doc can't run script in the app. Relative
 *  images load from beside the doc; links to other docs and pages open
 *  here, and web links in the browser. */
export function renderMarkdown(text: string, path: string): string {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const dir = path.slice(0, path.lastIndexOf("/"));
  for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (src && !/^[a-z]+:/i.test(src)) img.setAttribute("src", previewUrl(joinPath(dir, src)));
  }
  return doc.body.innerHTML;
}

function joinPath(dir: string, rel: string): string {
  if (rel.startsWith("/")) return rel;
  const parts = dir.split("/");
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

/** The parts of a doc a comment can be about. */
const BLOCKS = "h1, h2, h3, h4, h5, h6, li, tr, blockquote, pre, img, p";

const textOf = (el: Element) => {
  const t = (el.textContent || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
  return t.length > 80 ? t.slice(0, 77) + "…" : t;
};

/** The element a doc comment is pinned to: the first block of its kind that
 *  still starts with the text it was made on. */
function findBlock(root: HTMLElement, target: Target): Element | null {
  const start = target.text.replace(/…$/, "");
  return [...root.querySelectorAll(target.tag)].find((el) => textOf(el).replace(/…$/, "").startsWith(start)) ?? null;
}

function MarkdownView({
  path,
  from,
  rev,
  commenting,
  onPick,
}: { path: string; from?: string; rev: number } & Picking) {
  const { text, error } = useText(path, rev);
  const doc = useRef<HTMLElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const lit = useRef<Element | null>(null);
  const comments = useAppState().comments[path];
  const [pins, setPins] = useState<{ n: number; top: number; left: number; sent: boolean }[]>([]);
  const html = text === null ? "" : renderMarkdown(text, path);

  // Pins sit in the margin, at the top left of what each comment is on.
  useLayoutEffect(() => {
    const place = () => {
      if (!doc.current || !wrap.current) return;
      const base = wrap.current.getBoundingClientRect();
      setPins(
        (comments ?? []).flatMap((c, i) => {
          const el = findBlock(doc.current!, c.target);
          if (!el) return [];
          const r = el.getBoundingClientRect();
          return [{ n: i + 1, top: r.top - base.top + 2, left: Math.max(4, r.left - base.left - 28), sent: c.sent }];
        }),
      );
    };
    place();
    const watch = new ResizeObserver(place);
    if (wrap.current) watch.observe(wrap.current);
    return () => watch.disconnect();
  }, [comments, html]);

  // A table scrolls sideways when it's wide, and its columns drag to resize.
  useEffect(() => (doc.current ? fitTables(doc.current) : undefined), [html]);

  // Leaving comment mode clears the outline.
  useEffect(() => {
    if (commenting) return;
    lit.current?.classList.remove("is-pick");
    lit.current = null;
  }, [commenting]);

  if (error) return <p className="fpv-empty">{error}</p>;
  if (text === null) return <p className="fpv-empty">Reading…</p>;
  return (
    <div ref={wrap} className={`md-wrap${commenting ? " is-commenting" : ""}`}>
      <article
        ref={doc}
        className="md-doc"
        dangerouslySetInnerHTML={{ __html: html }}
        onMouseOver={(e) => {
          if (!commenting) return;
          const el = (e.target as HTMLElement).closest(BLOCKS);
          if (el === lit.current) return;
          lit.current?.classList.remove("is-pick");
          el?.classList.add("is-pick");
          lit.current = el;
        }}
        onMouseLeave={() => {
          lit.current?.classList.remove("is-pick");
          lit.current = null;
        }}
        onClick={(e) => {
          if (commenting) {
            e.preventDefault();
            const el = (e.target as HTMLElement).closest(BLOCKS);
            if (!el) return;
            const r = el.getBoundingClientRect();
            onPick({ selector: "", tag: el.tagName.toLowerCase(), text: textOf(el) }, { x: r.left, y: r.top, w: r.width, h: r.height });
            return;
          }
          const a = (e.target as HTMLElement).closest("a");
        const href = a?.getAttribute("href");
        if (!href || href.startsWith("#")) return;
        e.preventDefault();
        if (/^https?:/i.test(href)) {
          void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch(() => {});
        } else if (!/^[a-z]+:/i.test(href)) {
          void openPreview([joinPath(path.slice(0, path.lastIndexOf("/")), href.split("#")[0])], from);
        }
      }}
      />
      {pins.map((p) => (
        <span key={p.n} className={`md-pin${p.sent ? " is-sent" : ""}`} style={{ top: p.top, left: p.left }}>
          {p.n}
        </span>
      ))}
    </div>
  );
}

function TextView({ path, rev }: { path: string; rev: number }) {
  const { text, error } = useText(path, rev);
  if (error) return <p className="fpv-empty">{error}</p>;
  return <pre className="fpv-text">{text ?? "Reading…"}</pre>;
}

// ---- the hover card ----

const CARD_W = 340;
const CARD_H = 272;

/** A path's preview beside the pointer while it rests on the path. */
export function HoverCard() {
  const hover = useHover();
  const [file, setFile] = useState<PreviewFile | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFile(null);
    setText(null);
    setError(null);
    if (!hover) return;
    let live = true;
    describe(hover.path)
      .then(async (f) => {
        if (!live) return;
        setFile(f);
        if (f.kind === "markdown" || f.kind === "text") {
          const t = await readText(f.path);
          if (live) setText(t);
        }
      })
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [hover?.path]);

  if (!hover) return null;
  // Beside the pointer, kept inside the window.
  const left = Math.min(hover.x + 14, window.innerWidth - CARD_W - 12);
  const below = hover.y + 18 + CARD_H < window.innerHeight;
  const top = below ? hover.y + 18 : Math.max(12, hover.y - CARD_H - 14);

  return createPortal(
    <div
      className="fpv-card"
      style={{ left, top, width: CARD_W }}
      onMouseEnter={() => cardPointer(true)}
      onMouseLeave={() => cardPointer(false)}
      onClick={() => {
        hideCard();
        void openPreview([hover.path], hover.from);
      }}
      role="button"
      aria-label={`Open ${baseName(hover.path)} in the preview`}
    >
      <div className="fpv-card-body">
        {error ? (
          <p className="fpv-empty">{error}</p>
        ) : !file ? (
          <p className="fpv-empty">…</p>
        ) : file.kind === "html" ? (
          <iframe
            className="fpv-thumb"
            title={baseName(file.path)}
            sandbox="allow-scripts"
            tabIndex={-1}
            {...(isPreview() ? { srcDoc: DEMO_HTML } : { src: previewUrl(file.path) })}
          />
        ) : file.kind === "image" ? (
          <img className="fpv-card-img" src={previewUrl(file.path)} alt="" />
        ) : file.kind === "video" ? (
          <video className="fpv-card-img" src={previewUrl(file.path)} muted autoPlay loop playsInline />
        ) : file.kind === "markdown" && text !== null ? (
          <article className="md-doc md-doc-mini" dangerouslySetInnerHTML={{ __html: renderMarkdown(text.slice(0, 4000), file.path) }} />
        ) : text !== null ? (
          <pre className="fpv-text fpv-text-mini">{text.split("\n").slice(0, 16).join("\n")}</pre>
        ) : (
          <p className="fpv-empty">{file.kind === "pdf" ? "PDF" : "…"}</p>
        )}
      </div>
      <footer className="fpv-card-foot">
        <span className="fpv-card-name">{baseName(hover.path)}</span>
        <span className="fpv-card-dir">{dirName(hover.path)}</span>
        <span className="fpv-card-hint">Click to open</span>
      </footer>
    </div>,
    document.body,
  );
}
