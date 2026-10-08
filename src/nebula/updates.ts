// Updates: the app checks GitHub's latest release (tauri.conf.json,
// plugins.updater) soon after launch and every few hours, downloads a newer
// version in the background, and installs it over this one. Restarting is
// left to you, from the sidebar or Settings: agents run in the daemon, so a
// restart costs nothing but a second, yet it shouldn't happen mid-keystroke.
import { useEffect, useSyncExternalStore } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isPreview } from "./client";
import { flash } from "./store";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "downloading"; version: string; notes: string[]; percent: number | null }
  | { kind: "ready"; version: string; notes: string[] }
  | { kind: "error"; message: string };

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

let state: UpdateState = { kind: "idle" };
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((l) => l());
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Look for a newer release and, if there is one, download and install it.
 *  `manual` is a click on "Check for updates": it says what it found. */
export async function checkForUpdates(manual = false): Promise<void> {
  if (isPreview()) {
    if (manual) flash("Updates are checked in the app, not the browser preview.");
    return;
  }
  // Once one is installed, or while one is on its way, there's nothing to do.
  if (state.kind === "ready" || state.kind === "downloading" || state.kind === "checking") return;
  set({ kind: "checking" });
  try {
    const update = await check();
    if (!update) {
      set({ kind: "current" });
      if (manual) flash("Observatory is up to date.");
      return;
    }
    const version = update.version;
    const notes = noteLines(update.body);
    let total = 0;
    let got = 0;
    set({ kind: "downloading", version, notes, percent: null });
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        got += e.data.chunkLength;
        if (total) set({ kind: "downloading", version, notes, percent: Math.min(100, Math.round((got / total) * 100)) });
      }
    });
    set({ kind: "ready", version, notes });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    set({ kind: "error", message });
    // A background check failing (offline, GitHub down) isn't worth a word;
    // the next one will try again.
    if (manual) flash(`Couldn't check for updates: ${message}`);
  }
}

/** A release's notes as their bullet points: the release script writes one
 *  "- " line per change. Anything else (a release written by hand) is kept
 *  a line at a time; a version-only placeholder says nothing and is dropped. */
export function noteLines(body: string | undefined): string[] {
  return (body ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l && !/^Observatory \d+\.\d+/.test(l));
}

export async function restartToUpdate(): Promise<void> {
  try {
    await relaunch();
  } catch (e) {
    flash(`Couldn't restart: ${e instanceof Error ? e.message : String(e)}. Quit and reopen Observatory to finish updating.`);
  }
}

/** Mount once: checks shortly after launch, then every few hours. */
export function useUpdateCheck() {
  useEffect(() => {
    // `?update=ready` in the browser preview: an update waiting to restart.
    if (isPreview() && new URLSearchParams(location.search).get("update") === "ready") {
      set({
        kind: "ready",
        version: "0.5.2",
        notes: noteLines("- Comment on a mockup, and the agent fixes it\n- A shelf of the files each task has shown\n- Release notes when an update is ready"),
      });
      return;
    }
    if (isPreview() || import.meta.env.DEV) return;
    const first = setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
    const every = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
}
