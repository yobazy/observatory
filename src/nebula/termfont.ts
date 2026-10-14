// The terminal's type: which face, how big, how much air between lines.
// Kept in the desktop prefs; ⌘+ and ⌘− step the size. Kept free of the app
// so its tests run under plain Node.

export interface TermFontPrefs {
  terminalFont?: string;
  terminalFontSize?: number;
  terminalLineHeight?: number;
}

export const TERM_FONTS = [
  // Bundled (main.tsx), so it looks the same on every Mac.
  { id: "jetbrains", label: "JetBrains Mono", family: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
  // macOS's own: SF Mono, as Terminal and Xcode use it.
  { id: "system", label: "SF Mono", family: "ui-monospace, Menlo, monospace" },
  { id: "menlo", label: "Menlo", family: "Menlo, monospace" },
] as const;

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
