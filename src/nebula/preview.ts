// Previews of files an agent made or pointed at: an HTML mockup, a Markdown
// doc, an image. Paths in a terminal light up on hover (termpaths.ts) with a
// card, and a click opens them here: over the terminal, or beside it
// (Settings › General › Previews). `nebula open <file>` from an agent opens
// them too. The files reach the webview through `preview://` (preview.rs),
// which serves only what was opened for preview.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview, onFilesOpened } from "./client";
import { flash, getState, setState } from "./store";
import { addToShelf } from "./shelf";

export type PreviewKind = "html" | "markdown" | "image" | "pdf" | "text";

export interface PreviewFile {
  path: string;
  kind: PreviewKind;
  size: number;
  modified: number;
  /** The agent whose terminal or `nebula open` showed it: who comments on
   *  it go to. Unset for a file opened some other way. */
  from?: string;
}

export interface PreviewState {
  files: PreviewFile[];
  active: number;
}

const tilde = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const dirName = (path: string) => tilde(path.slice(0, path.lastIndexOf("/")) || "/");

/** The `preview://` URL a file is served at. Each segment is encoded on its
 *  own, so a page's relative links resolve against its folder. */
export function previewUrl(path: string, rev = 0, pick = false): string {
  const url = "preview://localhost" + path.split("/").map(encodeURIComponent).join("/");
  // `pick=1` has preview.rs add comment mode's script to the page.
  const query = [rev ? `rev=${rev}` : "", pick ? "pick=1" : ""].filter(Boolean).join("&");
  return query ? `${url}?${query}` : url;
}

function kindOf(path: string): PreviewKind {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "text";
}

/** Let `preview://` serve `path`, and say what it is. */
export async function describe(path: string): Promise<PreviewFile> {
  if (isPreview()) return { path, kind: kindOf(path), size: 0, modified: 0 };
  return invoke<PreviewFile>("open_preview", { path });
}

/** A previewed file's text: Markdown, code. */
export async function readText(path: string): Promise<string> {
  if (isPreview()) return demoText(path);
  return invoke<string>("read_preview_text", { path });
}

/** Open `paths` in the preview, the first of them in front. Files already
 *  open stay, so an agent showing three mockups in a row gets three tabs. */
export async function openPreview(paths: string[], from?: string | null): Promise<void> {
  const opened: PreviewFile[] = [];
  for (const path of paths) {
    try {
      opened.push({ ...(await describe(path)), ...(from ? { from } : {}) });
    } catch (e) {
      flash(`Couldn't preview ${tilde(path)}: ${e instanceof Error ? e.message : e}`, 6000);
    }
  }
  if (!opened.length) return;
  setState((s) => {
    const files = [...(s.preview?.files ?? [])];
    let active = -1;
    for (const f of opened) {
      const at = files.findIndex((g) => g.path === f.path);
      // Opened again without a source: it keeps the one it had.
      if (at >= 0) files[at] = { ...f, from: f.from ?? files[at].from };
      else files.push(f);
      if (active < 0) active = files.findIndex((g) => g.path === f.path);
    }
    return { preview: { files, active } };
  });
}

export function closePreview() {
  setState({ preview: null });
}

export function closePreviewFile(index: number) {
  setState((s) => {
    if (!s.preview) return {};
    const files = s.preview.files.filter((_, i) => i !== index);
    if (!files.length) return { preview: null };
    const active = Math.min(s.preview.active > index ? s.preview.active - 1 : s.preview.active, files.length - 1);
    return { preview: { files, active } };
  });
}

export function showPreviewFile(index: number) {
  setState((s) => (s.preview ? { preview: { ...s.preview, active: index } } : {}));
}

/** Mount once: files an agent shows with `nebula open` open here. */
export function usePreviewEvents() {
  useEffect(
    () =>
      onFilesOpened((paths, agent) => {
        addToShelf(agent, [...paths].reverse());
        if (getState().prefs.previewShownFiles === false) return;
        void openPreview(paths, agent);
      }),
    [],
  );
}

// ---- the hover card ----

export interface Hover {
  path: string;
  /** The agent whose terminal or shelf it's on, if any. */
  from?: string | null;
  /** Where the pointer was, in viewport px: the card sits beside it. */
  x: number;
  y: number;
}

let hover: Hover | null = null;
let overCard = false;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const hoverListeners = new Set<() => void>();
const SHOW_MS = 350;
const HIDE_MS = 250;

function setHover(next: Hover | null) {
  hover = next;
  hoverListeners.forEach((l) => l());
}

export function useHover(): Hover | null {
  return useSyncExternalStore(
    (l) => {
      hoverListeners.add(l);
      return () => hoverListeners.delete(l);
    },
    () => hover,
  );
}

/** The pointer is on a path: show its card after a moment. */
export function hoverPath(path: string, x: number, y: number, from?: string | null) {
  if (getState().prefs.previewOnHover === false) return;
  if (hideTimer) clearTimeout(hideTimer);
  if (showTimer) clearTimeout(showTimer);
  if (hover?.path === path) return;
  showTimer = setTimeout(() => setHover({ path, x, y, from }), hover ? 0 : SHOW_MS);
}

/** The pointer left the path: hide the card, unless it went onto the card. */
export function leavePath() {
  if (showTimer) clearTimeout(showTimer);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => !overCard && setHover(null), HIDE_MS);
}

export function cardPointer(inside: boolean) {
  overCard = inside;
  if (inside && hideTimer) clearTimeout(hideTimer);
  if (!inside) leavePath();
}

export function hideCard() {
  if (showTimer) clearTimeout(showTimer);
  overCard = false;
  setHover(null);
}

// ---- the browser preview's stand-ins ----

function demoText(path: string): string {
  if (kindOf(path) !== "markdown") return `// ${baseName(path)}\n`;
  return `# Checkout redesign

A single-page checkout with the order summary pinned on the right.

## What changed

- **Shipping and payment on one page**, so nobody loses their place.
- **Express pay first**: Apple Pay and Shop Pay above the card form.
- **Inline validation**: errors appear as you leave a field, not on submit.

| Step | Before | After |
|---|---|---|
| Pages | 3 | 1 |
| Fields | 14 | 9 |

> Mockup: \`mockups/checkout.html\`
`;
}

export const DEMO_HTML = `<!doctype html><html><head><style>
body{margin:0;font:15px system-ui;background:#f6f7fb;color:#1b2233}
header{background:#3d5bd9;color:#fff;padding:18px 28px;font-weight:600;font-size:18px}
main{display:grid;grid-template-columns:1fr 320px;gap:24px;padding:28px}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px #0001}
.btn{background:#1b2233;color:#fff;border-radius:8px;padding:12px;text-align:center;margin-top:12px}
.row{display:flex;justify-content:space-between;margin:8px 0}
input{display:block;width:100%;box-sizing:border-box;margin:8px 0 14px;padding:10px;border:1px solid #d5d9e4;border-radius:8px}
</style></head><body><header>Storefront · Checkout</header><main>
<div class="card"><b>Contact</b><input placeholder="Email"><b>Shipping</b><input placeholder="Address"><input placeholder="City"><b>Payment</b><input placeholder="Card number"><div class="btn">Pay $128.00</div></div>
<div class="card"><b>Order</b><div class="row"><span>Linen shirt</span><span>$88</span></div><div class="row"><span>Canvas tote</span><span>$32</span></div><div class="row"><span>Shipping</span><span>$8</span></div><hr><div class="row"><b>Total</b><b>$128</b></div></div>
</main></body></html>`;
