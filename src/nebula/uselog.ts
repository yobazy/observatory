// The usage log: what you click, the views and dialogs you open and how long
// you stay, the shortcuts you press, and the errors you hit, one JSON line
// each in a file on this Mac (uselog.rs), to read back for where the app gets
// in the way. Off unless Settings › General › Usage log turns it on. It never
// notes what you type, only ⌘/⌃ chords and Esc.
import { invoke } from "@tauri-apps/api/core";
import { getState, subscribe, type State } from "./store.ts";

export type UseEvent = { t: string; e: string } & Record<string, string | number | boolean>;
type Fields = Record<string, string | number | boolean | null | undefined>;

/** How long a label or message may run in the log. */
const LABEL_MAX = 60;
const MESSAGE_MAX = 200;
const FLUSH_MS = 5000;

const on = () => getState().prefs.keepUseLog === true;

let buffer: UseEvent[] = [];

export function event(e: string, fields: Fields = {}, now = new Date()): UseEvent {
  const out: UseEvent = { t: now.toISOString(), e };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

/** Note one thing you did, when the log is on. */
export function logUse(e: string, fields?: Fields) {
  if (on()) buffer.push(event(e, fields));
}

function flush() {
  if (!buffer.length) return;
  const events = buffer;
  buffer = [];
  // A batch that can't be written is dropped: the log is a convenience.
  void invoke("append_use_log", { events }).catch(() => {});
}

export const clip = (s: string, max = LABEL_MAX) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** What a ⌘/⌃ chord or Esc reads as, e.g. "⇧⌘N"; null for anything else,
 *  so typing never reaches the log. */
export function chord(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  if (e.key === "Escape") return "Esc";
  if (!e.metaKey && !e.ctrlKey) return null;
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return `${e.ctrlKey ? "⌃" : ""}${e.altKey ? "⌥" : ""}${e.shiftKey ? "⇧" : ""}${e.metaKey ? "⌘" : ""}${key}`;
}

const sessionOf = (s: State) => {
  const sel = s.selectedSession;
  if (!sel) return null;
  return "Agent" in sel ? `agent:${sel.Agent}` : `terminal:${sel.Terminal}`;
};

/** The log lines between two states: the view, the open session, the
 *  preview, and a flashed notice. `ms` is how long the old view was up. */
export function changes(prev: State, next: State, ms: number): UseEvent[] {
  const out: UseEvent[] = [];
  if (next.view !== prev.view) out.push(event("view", { from: prev.view, to: next.view, ms }));
  if (sessionOf(next) !== sessionOf(prev) && next.selectedSession) {
    const sel = next.selectedSession;
    const agent = "Agent" in sel ? next.agents[sel.Agent] : undefined;
    out.push(event("session", { kind: agent ? "agent" : "terminal", harness: agent?.kind, status: agent?.status, unseen: agent?.unseen }));
  }
  if (!!next.preview !== !!prev.preview) out.push(event(next.preview ? "preview.open" : "preview.close"));
  if (next.notice && next.notice !== prev.notice) out.push(event("notice", { text: clip(next.notice, MESSAGE_MAX) }));
  return out;
}

/** Interactive things a click lands on, nearest first. */
const CLICKABLE = 'button, a, select, input, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="option"], [role="switch"]';

/** A dialog's or menu's name: its aria-label, or the text it's labelled by. */
function nameOf(el: Element): string {
  const by = el.getAttribute("aria-labelledby");
  const text = el.getAttribute("aria-label") || (by && document.getElementById(by)?.textContent) || el.className.toString().split(" ")[0];
  return clip(text || "");
}

function clicked(target: Element) {
  const el = target.closest(CLICKABLE);
  if (!el || el.closest("[data-uselog-skip]")) return;
  const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "";
  const dialog = el.closest('[role="dialog"], [role="menu"]');
  logUse("click", {
    label: clip(label) || el.tagName.toLowerCase(),
    in: dialog ? nameOf(dialog) : getState().view,
  });
}

/** Watch for dialogs coming and going, from anywhere, and how long each stayed. */
function watchDialogs(): () => void {
  const open = new Map<Element, number>();
  let queued = false;
  const check = () => {
    queued = false;
    const now = new Set(document.querySelectorAll('[role="dialog"]'));
    for (const el of now) if (!open.has(el)) {
      open.set(el, Date.now());
      logUse("dialog.open", { name: nameOf(el) });
    }
    for (const [el, at] of open) if (!now.has(el)) {
      open.delete(el);
      logUse("dialog.close", { name: nameOf(el), ms: Date.now() - at });
    }
  };
  // Terminals redraw constantly, so a burst of changes is checked once.
  const seen = new MutationObserver(() => {
    if (queued || !on()) return;
    queued = true;
    setTimeout(check, 250);
  });
  seen.observe(document.body, { childList: true, subtree: true });
  return () => seen.disconnect();
}

/** Start noting, once at launch: does nothing while the log is off. */
export function startUseLog(): () => void {
  let prev = getState();
  let viewSince = Date.now();
  let focusSince = Date.now();
  let wasOn = false;

  const offStore = subscribe(() => {
    const next = getState();
    if (on() && !wasOn) logUse("log.on", { view: next.view });
    else if (!on() && wasOn) {
      buffer.push(event("log.off"));
      flush();
    }
    wasOn = on();
    if (on()) for (const e of changes(prev, next, Date.now() - viewSince)) buffer.push(e);
    if (next.view !== prev.view) viewSince = Date.now();
    prev = next;
  });

  const onClick = (e: MouseEvent) => on() && e.target instanceof Element && clicked(e.target);
  const onKey = (e: KeyboardEvent) => {
    const keys = on() && chord(e);
    if (keys) logUse("key", { keys, in: document.querySelector('[role="dialog"]') ? "dialog" : getState().view });
  };
  const onFocus = () => {
    logUse("app.focus", { away: Date.now() - focusSince });
    focusSince = Date.now();
  };
  const onBlur = () => {
    logUse("app.blur", { ms: Date.now() - focusSince });
    focusSince = Date.now();
    flush();
  };
  const onError = (e: ErrorEvent) => logUse("error", { message: clip(e.message, MESSAGE_MAX) });
  const onRejection = (e: PromiseRejectionEvent) =>
    logUse("error", { message: clip(e.reason instanceof Error ? e.reason.message : String(e.reason), MESSAGE_MAX), unhandled: true });

  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("beforeunload", flush);
  const offDialogs = watchDialogs();
  const timer = setInterval(flush, FLUSH_MS);

  return () => {
    offStore();
    offDialogs();
    clearInterval(timer);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("beforeunload", flush);
    flush();
  };
}

export async function useLogPath(): Promise<string> {
  return invoke<string>("use_log_path");
}

export async function clearUseLog(): Promise<void> {
  buffer = [];
  await invoke("clear_use_log");
}
