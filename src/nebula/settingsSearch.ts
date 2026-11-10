/** Search in Settings: which rows a query keeps. The view renders every tab
 *  while searching and this hides the rows that don't match, so a setting
 *  written by hand in Settings.tsx is found without being listed anywhere. */

/** Words people type for the keys the Shortcuts tab writes as symbols. */
const KEY_WORDS: Record<string, string> = {
  cmd: "⌘",
  command: "⌘",
  shift: "⇧",
  opt: "⌥",
  option: "⌥",
  alt: "⌥",
  ctrl: "⌃",
  control: "⌃",
  enter: "↵",
  return: "↵",
};

/** The order macOS writes modifiers in: ⌃⌥⇧⌘. */
const MOD_ORDER = "⌃⌥⇧⌘";

/** The query's words, lowercased; empty when there's nothing to search. Key
 *  names before a single key make one combo, so "cmd shift m" is ⇧⌘m; key
 *  names before anything else stay words ("command palette"). */
export function searchWords(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let mods: string[] = [];
  for (const w of words) {
    const sym = KEY_WORDS[w];
    if (sym && sym !== "↵") {
      mods.push(w);
      continue;
    }
    if (mods.length && [...w].length === 1) {
      const syms = [...new Set(mods.map((m) => KEY_WORDS[m]))];
      out.push(syms.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b)).join("") + w);
    } else out.push(...mods, w);
    mods = [];
  }
  return [...out, ...mods];
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const startsWord = (w: string) => WORD_CHAR.test(w[0]);

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether every word starts a word somewhere in the text ("tag" finds
 *  tagging, not "stage"); a key combo or symbol is found anywhere. A key name
 *  on its own ("cmd") finds its symbol as well as the word. */
export function matches(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.every((w) => {
    if (!startsWord(w)) return t.includes(w);
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}`, "u").test(t)) return true;
    const sym = KEY_WORDS[w];
    return sym !== undefined && t.includes(sym);
  });
}

const HIDE = "data-search-hidden";

/** Hides the rows under `root` that don't match, and the groups and tabs left
 *  empty, then counts what's left in each tab (`[data-settings-tab]`). A row
 *  is a `.setting` or `.shortcut`, read with its group's and tab's names and
 *  any `data-search` words, so "dispatch router" finds Router. */
export function filterSettings(root: HTMLElement, words: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const section of root.querySelectorAll<HTMLElement>("[data-settings-tab]")) {
    const tab = section.dataset.settingsTab ?? "";
    let shown = 0;
    for (const row of section.querySelectorAll<HTMLElement>(".setting, .shortcut")) {
      const group = row.closest(".settings-group")?.querySelector("h2")?.textContent ?? "";
      const own = row.querySelector(".setting-text")?.textContent ?? row.textContent ?? "";
      const hit = matches(`${tab} ${group} ${own} ${row.dataset.search ?? ""}`, words);
      row.toggleAttribute(HIDE, !hit);
      if (hit) shown++;
    }
    for (const group of section.querySelectorAll<HTMLElement>(".settings-group")) {
      group.toggleAttribute(HIDE, !group.querySelector(`:is(.setting, .shortcut):not([${HIDE}])`));
    }
    section.toggleAttribute(HIDE, shown === 0);
    counts[tab] = shown;
  }
  return counts;
}

/** Marks the query's words in the rows left showing, where the CSS Custom
 *  Highlight API is there (WebKit has it); elsewhere nothing is marked. */
export function markWords(root: HTMLElement, words: string[]) {
  const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const Hl = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !Hl) return;
  reg.delete("settings-search");
  if (!words.length) return;
  const ranges: Range[] = [];
  const spots = root.querySelectorAll<HTMLElement>(
    `:is(.setting:not([${HIDE}]) .setting-text, .shortcut:not([${HIDE}]), .settings-group:not([${HIDE}]) > h2)`,
  );
  for (const spot of spots) {
    const walk = document.createTreeWalker(spot, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = (n.textContent ?? "").toLowerCase();
      for (const w of words) {
        for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + w.length)) {
          if (startsWord(w) && at > 0 && WORD_CHAR.test(text[at - 1])) continue;
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + w.length);
          ranges.push(r);
        }
      }
    }
  }
  reg.set("settings-search", new Hl(...ranges));
}
