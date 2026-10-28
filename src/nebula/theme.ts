// The desktop app's look: nebula's shared `theme` setting picks the accent
// (the same ten names the TUI cycles, so changing it in either app changes
// both), and a desktop-only mode picks the surfaces.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { loadSettings } from "./settings";
import { getState, setState, subscribe } from "./store";
import type { FolderPrefs } from "./folders";
import type { PriorityPrefs } from "./priority";
import type { Idea } from "./ideaList";
import type { TermFontPrefs } from "./termfont";
import type { ThreadTagRecord } from "./threadtags";

export type Mode = "system" | "dark" | "black" | "light";
export const MODES: { id: Mode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "black", label: "Black" },
  { id: "light", label: "Light" },
];

/** Each TUI theme's accent (its xterm-256 color), and a deeper step of the
 *  same hue that holds contrast on the light surfaces. `default` keeps the
 *  desktop app's own coral rather than the TUI's ANSI cyan. */
export const ACCENTS: Record<string, { dark: string; light: string }> = {
  default: { dark: "#f0a28b", light: "#b5482c" },
  ocean: { dark: "#00afff", light: "#0077b3" },
  forest: { dark: "#87d787", light: "#2f8a3a" },
  rose: { dark: "#ff87af", light: "#c2386b" },
  amber: { dark: "#ffaf00", light: "#a86a00" },
  lavender: { dark: "#afafff", light: "#5b5bd6" },
  coral: { dark: "#ff875f", light: "#c0461f" },
  slate: { dark: "#87afd7", light: "#3f6f9e" },
  sand: { dark: "#d7af87", light: "#8c6239" },
  mono: { dark: "#e6e9f2", light: "#2a2f3a" },
};

/** The terminal's face, size and line spacing come from `TermFontPrefs`
 *  (termfont.ts). */
export interface DesktopPrefs extends TermFontPrefs, FolderPrefs, PriorityPrefs {
  mode?: Mode;
  /** The sidebar cat (`Pet.tsx`); on unless turned off. */
  pet?: boolean;
  /** Closing the window keeps the app in the menu bar (desktop.ts); on
   *  unless turned off. */
  keepInMenuBar?: boolean;
  /** The system-wide quick-capture hotkey, in the global-shortcut plugin's
   *  syntax, or "off". Unset is QUICK_CAPTURE_DEFAULT. */
  quickCapture?: string;
  /** Chimes for finished turns and questions (delight.ts); on unless off. */
  sounds?: boolean;
  /** 0 to 1; 0.5 when unset. */
  soundVolume?: number;
  /** Quiet hours, "HH:MM" local: no chimes or banners between them. */
  quietFrom?: string;
  quietTo?: string;
  /** Spend you'd like to stay under, in API-equivalent dollars (budget.ts). */
  dailyBudget?: number;
  weeklyBudget?: number;
  /** The editor a band's Open in editor uses: an app name from list_editors. */
  editor?: string;
  /** Icons picked for projects, by repo path (`icons.ts`). */
  projectIcons?: Record<string, ProjectIconChoice>;
  /** Colors picked for projects, by repo path: a PROJECT_COLORS name. */
  projectColors?: Record<string, string>;
  /** Projects in the order dragged into, by repo path (`organize.ts`);
   *  any not listed follow in the daemon's order. */
  projectOrder?: string[];
  /** Where a preview opens: over the terminal (unset) or beside it. */
  previewPlacement?: "over" | "beside";
  /** The Read view's text size; medium when unset. */
  readerText?: "small" | "large";
  /** The Read view's column: a reading width when unset, or the pane's. */
  readerWidth?: "wide";
  /** Where Save as note writes a reply (notes.rs), such as an Obsidian vault. */
  notesFolder?: string;
  /** Hovering a path in a terminal shows its preview card; on unless off. */
  previewOnHover?: boolean;
  /** Files an agent shows with `nebula open` open in the preview; on unless off. */
  previewShownFiles?: boolean;
  /** Tasks pinned to the top of their branch, in order, by worktree id. */
  pinnedTasks?: Record<string, string[]>;
  /** Colors picked for tasks, by agent id: a PROJECT_COLORS name. */
  taskColors?: Record<string, string>;
  /** Each project's tags for its threads, by repo path, in the order added
   *  (threadtags.ts). Not the sidebar's `projectTags`, which tag projects. */
  threadTagLists?: Record<string, string[]>;
  /** The tags each thread carries, and who set them, by agent id. */
  threadTags?: Record<string, ThreadTagRecord>;
  /** Tasks marked to come back to, by agent id: when they were marked (ms). */
  followUps?: Record<string, number>;
  /** Ideas not started yet, newest first (ideas.ts). */
  ideas?: Idea[];
  /** Which of those the app flagged itself, when a turn ended while you
   *  weren't looking (followupRules.ts); they clear once you act. */
  autoFollowUps?: Record<string, true>;
  /** The agent CLI Dispatch routes a list with, headless (router.rs);
   *  `claude -p` when unset. */
  routerCommand?: string;
  /** The agent CLI the tagging prompt runs through, headless (tagging.ts,
   *  router.rs). No default: tagging is off until it's set. */
  tagCommand?: string;
  /** Sessions Dispatch runs at once, across batches (batch.ts); 4 when unset. */
  dispatchCap?: number;
  /** Note what you do in the app to a file on this Mac (uselog.ts); off unless on. */
  keepUseLog?: boolean;
  /** Label prefixes of the launchd agents the Automations view lists
   *  (automations.ts); unset is every prefix not from Apple, Google, Adobe or Valve. */
  automationLabels?: string[];
}

export type ProjectIconChoice = { kind: "emoji"; value: string } | { kind: "image"; value: string };

export async function loadPrefs(): Promise<DesktopPrefs> {
  if (isPreview()) {
    try {
      return JSON.parse(localStorage.getItem("observatory.prefs") ?? "{}");
    } catch {
      return {};
    }
  }
  return invoke<DesktopPrefs>("read_desktop_prefs").catch(() => ({}));
}

export async function savePrefs(prefs: DesktopPrefs): Promise<void> {
  setState({ prefs });
  if (isPreview()) {
    try {
      localStorage.setItem("observatory.prefs", JSON.stringify(prefs));
    } catch {
      // The preview forgets; the app itself writes desktop.json.
    }
    return;
  }
  await invoke("write_desktop_prefs", { prefs });
}

const media = () => window.matchMedia("(prefers-color-scheme: light)");

/** The surfaces actually in use: `system` resolved against the OS. */
export function resolvedMode(mode: Mode | undefined): Exclude<Mode, "system"> {
  if (!mode || mode === "system") return media().matches ? "light" : "dark";
  return mode;
}

function apply() {
  const { prefs, theme } = getState();
  const mode = resolvedMode(prefs.mode);
  const accent = ACCENTS[themeName(theme)];
  const root = document.documentElement;
  root.dataset.mode = mode;
  root.dataset.accent = themeName(theme);
  root.style.setProperty("--accent", mode === "light" ? accent.light : accent.dark);
  root.style.setProperty("--accent-ink", mode === "light" ? "#ffffff" : "#121726");
  root.style.colorScheme = mode === "light" ? "light" : "dark";
  if (getState().mode !== mode) setState({ mode });
}

/** The shared accent lives in nebula's settings, which the TUI may change. */
async function loadTheme() {
  setState({ theme: themeName((await loadSettings().catch(() => ({}) as Record<string, unknown>)).theme) });
}

/** A stored theme as the TUI reads it (`Theme::by_name`): trimmed, any case,
 *  anything unknown the default. */
export function themeName(t: unknown): string {
  const name = typeof t === "string" ? t.trim().toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(ACCENTS, name) ? name : "default";
}

/** Mount once: loads the prefs and keeps the document's look in step with
 *  them, the shared theme, and the OS appearance. */
export function useTheme() {
  useEffect(() => {
    void loadPrefs().then((prefs) => setState({ prefs }));
    void loadTheme();
    const onFocus = () => void loadTheme();
    window.addEventListener("focus", onFocus);
    let last = "";
    const offStore = subscribe(() => {
      const { prefs, theme } = getState();
      const key = `${prefs.mode}|${theme}`;
      if (key !== last) {
        last = key;
        apply();
      }
    });
    apply();
    const m = media();
    const onOs = () => apply();
    m.addEventListener("change", onOs);
    return () => {
      offStore();
      window.removeEventListener("focus", onFocus);
      m.removeEventListener("change", onOs);
    };
  }, []);
}
