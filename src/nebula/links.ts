import { isPreview } from "./client";

const OUTSIDE = /^(https?|mailto):/i;

/** Open a web or mail link in the browser (a new tab in the preview). */
export function openOutside(url: string) {
  if (isPreview()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => {});
}

/** Catch any web link click that no view handled, so it opens in the
 *  browser rather than replacing the app in its own window. */
export function startLinks() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const href = (e.target as Element | null)?.closest?.("a[href]")?.getAttribute("href");
    if (!href || !OUTSIDE.test(href)) return;
    e.preventDefault();
    openOutside(href);
  });
}
