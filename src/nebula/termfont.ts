// The terminal's type: which face, how big, how much air between lines.
// Kept in the desktop prefs; ⌘+ and ⌘− step the size. Kept free of the app
// so its tests run under plain Node.

export interface TermFontPrefs {
  terminalFont?: string;
  terminalFontSize?: number;
  terminalLineHeight?: number;
}

const stack = (name: string) => `"${name}", ui-monospace, Menlo, monospace`;

/** The faces to pick from, the default first. All but SF Mono and Menlo come with the app
 *  (main.tsx), so they look the same on every Mac; `note` is what sets each
 *  apart, for the picker. */
export const TERM_FONTS = [
  { id: "plex", label: "IBM Plex Mono", family: stack("IBM Plex Mono"), note: "Warm, a little typewriter" },
  { id: "jetbrains", label: "JetBrains Mono", family: stack("JetBrains Mono"), note: "Tall and narrow, made for code" },
  { id: "system", label: "SF Mono", family: "ui-monospace, Menlo, monospace", note: "Apple's, as in Terminal and Xcode" },
  { id: "menlo", label: "Menlo", family: "Menlo, monospace", note: "The classic Mac terminal face" },
  { id: "geist", label: "Geist Mono", family: stack("Geist Mono"), note: "Clean and modern, Vercel's" },
  { id: "commit", label: "Commit Mono", family: stack("Commit Mono"), note: "Neutral, made to disappear" },
  { id: "iosevka", label: "Iosevka", family: stack("Iosevka"), note: "Very narrow: more fits on a line" },
  { id: "cascadia", label: "Cascadia Code", family: stack("Cascadia Code"), note: "Rounded and friendly, Microsoft's" },
  { id: "fira", label: "Fira Code", family: stack("Fira Code"), note: "Open and readable, Mozilla's" },
  { id: "source", label: "Source Code Pro", family: stack("Source Code Pro"), note: "Light and even, Adobe's" },
  { id: "roboto", label: "Roboto Mono", family: stack("Roboto Mono"), note: "Geometric, Google's" },
] as const;

/** The face's own name, to wait for it to load before the terminal measures
 *  it; null for the ones macOS has. */
export function loadName(family: string): string | null {
  const m = /^"([^"]+)"/.exec(family);
  return m ? m[1] : null;
}

/** Resolves once `font`'s regular and bold are loaded (or failed to). */
export function whenLoaded(font: TermFont): Promise<unknown> {
  const name = loadName(font.family);
  if (!name || typeof document === "undefined") return Promise.resolve();
  return Promise.all([
    document.fonts.load(`${font.size}px "${name}"`),
    document.fonts.load(`bold ${font.size}px "${name}"`),
  ]).catch(() => {});
}

export const SIZE_MIN = 10;
export const SIZE_MAX = 22;
export const SIZE_DEFAULT = 13;
export const LINE_HEIGHTS = [
  { value: 1.0, label: "Tight" },
  { value: 1.15, label: "Normal" },
  { value: 1.3, label: "Relaxed" },
] as const;
export const LINE_DEFAULT = 1.15;

export interface TermFont {
  family: string;
  size: number;
  lineHeight: number;
}

const clampSize = (n: number) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)));

export function termFont(p: TermFontPrefs): TermFont {
  const face = TERM_FONTS.find((f) => f.id === p.terminalFont) ?? TERM_FONTS[0];
  const size = typeof p.terminalFontSize === "number" && Number.isFinite(p.terminalFontSize) ? clampSize(p.terminalFontSize) : SIZE_DEFAULT;
  const line = LINE_HEIGHTS.find((l) => l.value === p.terminalLineHeight)?.value ?? LINE_DEFAULT;
  return { family: face.family, size, lineHeight: line };
}

/** The grid's small tiles: the same face, a step and a half smaller. */
export function gridFont(p: TermFontPrefs): TermFont {
  const f = termFont(p);
  return { ...f, size: Math.max(9, f.size - 1.5), lineHeight: Math.max(1, f.lineHeight - 0.05) };
}

/** The size after ⌘+ (1), ⌘− (−1) or ⌘0 (0, back to the default). */
export function zoomed(p: TermFontPrefs, step: 1 | -1 | 0): number {
  return step === 0 ? SIZE_DEFAULT : clampSize(termFont(p).size + step);
}
