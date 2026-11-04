// The arithmetic of the PDF view (PdfView.tsx): how big its pages are, and
// where they sit in the scroll.

/** The gap between pages and around them, in px. */
export const PAGE_GAP = 16;
/** Past this a page is drawn no bigger, however wide the pane. */
export const MAX_FIT = 2;

/** The scale that fits the widest page in a pane `room` px wide. */
export function fitScale(widest: number, room: number): number {
  if (widest <= 0 || room <= 0) return 1;
  return Math.min(MAX_FIT, Math.max(0.1, (room - 2 * PAGE_GAP) / widest));
}

/** Where each page starts in the scroll, for pages `heights` px tall. */
export function pageTops(heights: number[]): number[] {
  let y = PAGE_GAP;
  return heights.map((h) => {
    const top = y;
    y += h + PAGE_GAP;
    return top;
  });
}

/** Which page (from 0) holds the line `y` px down the scroll: the one it's
 *  in, or the next one when it's in a gap. */
export function pageAt(tops: number[], heights: number[], y: number): number {
  const i = tops.findIndex((top, n) => y < top + heights[n] + PAGE_GAP);
  return i === -1 ? Math.max(0, tops.length - 1) : i;
}

/** The line down the scroll that says which page you're on: the pane's top at
 *  the start, its bottom at the end, so the first and last page both count
 *  even when several pages fit in the pane. */
export function readingLine(scrollTop: number, pane: number, maxScroll: number): number {
  return maxScroll > 0 ? scrollTop + pane * Math.min(1, scrollTop / maxScroll) : scrollTop;
}

/** What a PDF may link to from the preview. A PDF is a file an agent or a
 *  download made, so `file:` and script links stay dead. */
export const safeLink = (url: unknown): url is string => typeof url === "string" && /^(https?|mailto):/i.test(url);
