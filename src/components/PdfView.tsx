import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { openPdf, type Pdfjs } from "../nebula/pdf";
import { fitScale, PAGE_GAP, pageAt, pageTops, readingLine, safeLink } from "../nebula/pdfpages";
import { readBytes, type PreviewFile } from "../nebula/preview";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
/** A canvas past this many pixels is slow, or blank on some GPUs. */
const MAX_PIXELS = 16_000_000;

/** One page: a placeholder of the right size until it's near the view, then
 *  drawn, with invisible text over it to select and its links on top. Far from
 *  the view again it goes back to a placeholder, so scrolling through a long
 *  PDF doesn't keep every page's canvas. */
function PdfPage({ lib, page, scale, root }: { lib: Pdfjs; page: PDFPageProxy; scale: number; root: HTMLElement | null }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const drawn = useRef(false);
  const [near, setNear] = useState(false);
  const [links, setLinks] = useState<{ url: string; left: string; top: string; width: string; height: string }[]>([]);
  const size = page.getViewport({ scale });

  useEffect(() => {
    if (!box.current || !root) return;
    const draw = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { root, rootMargin: "100% 0px" });
    // Wider than the line it's drawn at, so a small scroll back and forth
    // doesn't draw it again.
    const keep = new IntersectionObserver(([e]) => e.isIntersecting || setNear(false), { root, rootMargin: "300% 0px" });
    draw.observe(box.current);
    keep.observe(box.current);
    return () => {
      draw.disconnect();
      keep.disconnect();
    };
  }, [root]);

  // The old drawing stays, stretched, until the new one is ready, so zooming
  // doesn't flash and a run of zooms draws only the last.
  useEffect(() => {
    if (!near) {
      if (!drawn.current) return;
      drawn.current = false;
      box.current?.querySelector("canvas")?.remove();
      text.current?.replaceChildren();
      page.cleanup();
      return;
    }
    let task: RenderTask | null = null;
    let layer: InstanceType<Pdfjs["TextLayer"]> | null = null;
    let stale = false;
    const draw = async () => {
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (stale) return;
      box.current?.querySelector("canvas")?.remove();
      box.current?.prepend(canvas);
      drawn.current = true;
      if (!text.current) return;
      text.current.replaceChildren();
      layer = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport });
      await layer.render();
    };
    const wait = setTimeout(() => {
      draw().catch((e) => {
        if (!(e instanceof lib.RenderingCancelledException) && !stale) console.warn("pdf page", e);
      });
    }, drawn.current ? 120 : 0);
    return () => {
      stale = true;
      clearTimeout(wait);
      task?.cancel();
      layer?.cancel();
    };
  }, [lib, near, page, scale]);

  useEffect(() => {
    if (!near) return;
    let stale = false;
    const whole = page.getViewport({ scale: 1 });
    const pc = (n: number, of: number) => `${(n / of) * 100}%`;
    void page
      .getAnnotations()
      .then((all) => {
        if (stale) return;
        setLinks(
          all
            .filter((a) => a.subtype === "Link" && safeLink(a.url))
            .map((a) => {
              const [x1, y1] = whole.convertToViewportPoint(a.rect[0], a.rect[1]);
              const [x2, y2] = whole.convertToViewportPoint(a.rect[2], a.rect[3]);
              return {
                url: a.url,
                left: pc(Math.min(x1, x2), whole.width),
                top: pc(Math.min(y1, y2), whole.height),
                width: pc(Math.abs(x2 - x1), whole.width),
                height: pc(Math.abs(y2 - y1), whole.height),
              };
            }),
        );
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [near, page]);

  return (
    <div ref={box} className="fpv-pdf-page" style={{ width: size.width, height: size.height }}>
      <div ref={text} className="fpv-pdf-text" />
      {links.map(({ url, ...at }, i) => (
        <a key={i} className="fpv-pdf-link" href={url} title={url} style={at} />
      ))}
    </div>
  );
}

/** Every page of a PDF, one under the other. It fits the pane's width; pinch,
 *  ⌘-scroll, + and − zoom, 0 fits, as a picture does. The bar under it says
 *  which page you're on. */
export function PdfView({ file, rev }: { file: PreviewFile; rev: number }) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [opened, setOpened] = useState<{ lib: Pdfjs; close: () => void; pages: PDFPageProxy[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState(0);
  // null fits the pane's width; a number is its scale, 1 for the PDF's size.
  const [zoom, setZoom] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  // Where in the document to stay as the zoom changes, as fractions.
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);

  // A new version replaces the old one only once it's open, so live reload
  // keeps your place.
  useEffect(() => {
    let stale = false;
    readBytes(file.path)
      .then(openPdf)
      .then(async ({ lib, doc, close }) => {
        const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1))).catch((e) => {
          close();
          throw e;
        });
        if (stale) close();
        else {
          setError(null);
          setOpened({ lib, close, pages });
        }
      })
      .catch((e) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      stale = true;
    };
  }, [file.path, rev]);
  useEffect(() => opened?.close, [opened]);

  useEffect(() => {
    if (!stage) return;
    const watch = new ResizeObserver(() => setRoom(stage.clientWidth));
    watch.observe(stage);
    return () => watch.disconnect();
  }, [stage]);

  const sizes = opened?.pages.map((p) => p.getViewport({ scale: 1 })) ?? [];
  const fit = fitScale(Math.max(0, ...sizes.map((s) => s.width)), room);
  const scale = zoom ?? fit;
  const heights = sizes.map((s) => s.height * scale);
  const tops = pageTops(heights);
  const scaleNow = useRef(scale);
  scaleNow.current = scale;
  const fitNow = useRef(fit);
  fitNow.current = fit;

  /** Zoom to `next` (null: fit), keeping the document still at (x, y), or at
   *  the middle of the pane. */
  const zoomTo = useCallback(
    (next: number | null, x?: number, y?: number) => {
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const px = (x ?? r.left + r.width / 2) - r.left;
      const py = (y ?? r.top + r.height / 2) - r.top;
      anchor.current = {
        fx: (stage.scrollLeft + px) / stage.scrollWidth,
        fy: (stage.scrollTop + py) / stage.scrollHeight,
        x: px,
        y: py,
      };
      if (next !== null) next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      setZoom(next !== null && Math.abs(next - fitNow.current) < 0.005 ? null : next);
    },
    [stage],
  );
  const zoomBy = useCallback((factor: number, x?: number, y?: number) => zoomTo(scaleNow.current * factor, x, y), [zoomTo]);

  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a || !stage) return;
    stage.scrollLeft = a.fx * stage.scrollWidth - a.x;
    stage.scrollTop = a.fy * stage.scrollHeight - a.y;
  }, [scale, stage]);

  // Pinch (which arrives as a wheel with ctrl) and ⌘-scroll zoom; plain
  // scrolling still pans. Passive listeners can't stop the page zooming.
  useEffect(() => {
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [stage, zoomBy]);

  // + and − from anywhere in the preview, as ← and → are.
  useEffect(() => {
    const pane = stage?.closest<HTMLElement>(".fpv");
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
  }, [stage, zoomBy, zoomTo]);

  // Where a page button left the scroll: the bar says the page it asked for
  // until you scroll on, as short pages put several in view at once.
  const jumped = useRef<number | null>(null);
  const onScroll = () => {
    if (!stage) return;
    if (jumped.current !== null && Math.abs(stage.scrollTop - jumped.current) < 1) return;
    jumped.current = null;
    const line = readingLine(stage.scrollTop, stage.clientHeight, stage.scrollHeight - stage.clientHeight);
    setCurrent(pageAt(tops, heights, line));
  };
  const goTo = (page: number) => {
    if (!stage) return;
    stage.scrollTo({ top: tops[page] - PAGE_GAP });
    jumped.current = stage.scrollTop;
    setCurrent(page);
  };

  if (error && !opened) return <p className="fpv-empty">Couldn't show this PDF: {error}</p>;
  const n = opened?.pages.length ?? 0;
  return (
    <div className="fpv-picture">
      <div ref={setStage} className="fpv-stage fpv-pdf" onScroll={onScroll}>
        {opened ? (
          <div className="fpv-pdf-doc" style={{ "--total-scale-factor": scale } as React.CSSProperties}>
            {opened.pages.map((page, i) => (
              <PdfPage key={i} lib={opened.lib} page={page} scale={scale} root={stage} />
            ))}
          </div>
        ) : (
          <p className="fpv-empty">Opening…</p>
        )}
      </div>
      {opened && (
        <div className="fpv-picbar" role="toolbar" aria-label="PDF">
          {n > 1 && (
            <>
              <button
                className="icon-btn"
                onClick={() => goTo(current - 1)}
                disabled={current === 0}
                aria-label="Previous page"
                title="Previous page"
              >
                ‹
              </button>
              <span className="fpv-picbar-n">
                Page {current + 1} of {n}
              </span>
              <button
                className="icon-btn"
                onClick={() => goTo(current + 1)}
                disabled={current === n - 1}
                aria-label="Next page"
                title="Next page"
              >
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
            onClick={() => zoomTo(zoom === null ? 1 : null)}
            title={zoom === null ? "The PDF's own size" : "Fit to the pane (0)"}
          >
            {zoom === null ? `Fit · ${Math.round(fit * 100)}%` : `${Math.round(zoom * 100)}%`}
          </button>
          <button className="icon-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (+)">
            +
          </button>
        </div>
      )}
    </div>
  );
}
