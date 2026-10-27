// The parts of the control socket's commands (control.ts) that don't touch
// the window: which thread a name means, which control a label means, and
// what a key chord is. Kept apart so they're tested in node.

export interface Named {
  id: string;
  name: string;
}

/** The one of `items` that `query` means: its id, else its whole name, else
 *  the only name that starts with or contains it (any case). An error says
 *  what it could have meant. */
export function pick<T extends Named>(items: T[], query: string, what = "thread"): T {
  const q = query.trim().toLowerCase();
  const byId = items.find((i) => i.id.toLowerCase() === q);
  if (byId) return byId;
  for (const test of [(n: string) => n === q, (n: string) => n.startsWith(q), (n: string) => n.includes(q)]) {
    const hits = items.filter((i) => test(i.name.toLowerCase()));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw new Error(`"${query}" could be ${hits.length} ${what}s: ${hits.slice(0, 8).map((h) => `${h.name} (${h.id})`).join(", ")}`);
    }
  }
  throw new Error(`no ${what} called "${query}"`);
}

/** What a control says it is: its label, else its text, else its title,
 *  with runs of space made one. */
export function labelOf(el: { label: string | null; text: string | null; title: string | null }): string {
  return (el.label || el.text || el.title || "").replace(/\s+/g, " ").trim();
}

/** The controls whose label is `query`, else start with it, else hold it:
 *  the closest matches only, in page order. */
export function matching<T>(items: T[], label: (t: T) => string, query: string): T[] {
  const q = query.replace(/\s+/g, " ").trim().toLowerCase();
  for (const test of [(l: string) => l === q, (l: string) => l.startsWith(q), (l: string) => l.includes(q)]) {
    const hits = items.filter((i) => test(label(i).toLowerCase()));
    if (hits.length) return hits;
  }
  return [];
}

export interface Chord {
  key: string;
  code: string;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}

const NAMED: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  space: " ",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  backspace: "Backspace",
  delete: "Delete",
};

/** "cmd+shift+m", "esc", "ctrl+enter" as a keydown's fields. */
export function chord(text: string): Chord {
  const parts = text.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const last = parts.pop();
  if (!last) throw new Error(`no key in "${text}"`);
  const mods = new Set(parts);
  for (const m of mods) {
    if (!["cmd", "meta", "shift", "alt", "opt", "option", "ctrl", "control"].includes(m)) throw new Error(`unknown modifier "${m}"`);
  }
  let key: string;
  let code: string;
  if (NAMED[last]) {
    key = NAMED[last];
    code = key === " " ? "Space" : key;
  } else if (/^[a-z]$/.test(last)) {
    key = last;
    code = `Key${last.toUpperCase()}`;
  } else if (/^[0-9]$/.test(last)) {
    key = last;
    code = `Digit${last}`;
  } else if (/^f([1-9]|1[0-2])$/.test(last)) {
    key = last.toUpperCase();
    code = key;
  } else {
    key = last;
    code = "";
  }
  return {
    key,
    code,
    metaKey: mods.has("cmd") || mods.has("meta"),
    shiftKey: mods.has("shift"),
    altKey: mods.has("alt") || mods.has("opt") || mods.has("option"),
    ctrlKey: mods.has("ctrl") || mods.has("control"),
  };
}
