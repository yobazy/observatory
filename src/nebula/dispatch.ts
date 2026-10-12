// Dispatch: the day's to-do list, pasted in whole and checked off here. The
// daemon has no notion of a task list, so the list is this app's, kept in
// localStorage. It keeps its own small store rather than a slot in store.ts,
// so the parser and storage can be tested without the rest of the app.
import { useSyncExternalStore } from "react";

/** One line of a pasted list, with the indented lines under it. */
export interface ParsedItem {
  text: string;
  context: string[];
}

export interface DispatchItem extends ParsedItem {
  /** Stable across launches: later steps (routing, the board) refer to items by it. */
  id: string;
  checked: boolean;
  /** When it was pasted. */
  at: number;
}

const KEY = "observatory.dispatch";

/** Bullets, numbers and checkboxes a list copied from a notes app starts lines with. */
const MARKER = /^(?:[-*+•]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s+)?/;

/** One item per unindented line. An indented line adds detail to the item
 *  above it, or is an item of its own when there's none above. Blank lines
 *  are dropped. */
export function parseList(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const content = line.trim().replace(MARKER, "").trim();
    if (!content) continue;
    const indented = /^\s/.test(line);
    if (indented && items.length) items[items.length - 1].context.push(content);
    else items.push({ text: content, context: [] });
  }
  return items;
}

function isItem(x: unknown): x is DispatchItem {
  const i = x as DispatchItem;
  return (
    !!i &&
    typeof i.id === "string" &&
    typeof i.text === "string" &&
    Array.isArray(i.context) &&
    typeof i.checked === "boolean"
  );
}

/** The saved list, as last written; empty when there's none or it can't be read. */
export function loadItems(): DispatchItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return Array.isArray(raw?.items) ? raw.items.filter(isItem) : [];
  } catch {
    return [];
  }
}

function save(items: DispatchItem[]) {
  try {
    // An object, not a bare array, so later fields have somewhere to go.
    localStorage.setItem(KEY, JSON.stringify({ items }));
  } catch {
    // Without storage the list lasts until the app quits.
  }
}

let items: DispatchItem[] | null = null;
const listeners = new Set<() => void>();

export function dispatchItems(): DispatchItem[] {
  return (items ??= loadItems());
}

/** Drop what's in memory and read the list from storage again. */
export function reloadItems() {
  items = loadItems();
  listeners.forEach((l) => l());
}

function write(next: DispatchItem[]) {
  items = next;
  save(next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDispatchItems(): DispatchItem[] {
  return useSyncExternalStore(subscribe, dispatchItems);
}

/** Add a pasted list's items after those already there. Returns how many were added. */
export function pasteList(text: string): number {
  const parsed = parseList(text);
  if (!parsed.length) return 0;
  const at = Date.now();
  const stamp = at.toString(36);
  const added = parsed.map((p, i) => ({
    id: `${stamp}-${i}-${Math.random().toString(36).slice(2, 7)}`,
    ...p,
    checked: false,
    at,
  }));
  write([...dispatchItems(), ...added]);
  return added.length;
}

export function toggleItem(id: string) {
  write(dispatchItems().map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)));
}

export function removeItem(id: string) {
  write(dispatchItems().filter((i) => i.id !== id));
}

export function clearChecked() {
  write(dispatchItems().filter((i) => !i.checked));
}
