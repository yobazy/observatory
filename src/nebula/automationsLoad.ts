import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { getState, setState } from "./store";
import { track, type AutomationsReport, type Watches } from "./automations";

const WATCH_KEY = "observatory.automations.watch";

function loadWatches(): Watches {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveWatches(w: Watches) {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(w));
  } catch {
    // Without it the app starts watching afresh next launch: no false stale.
  }
}

let loading = false;
/** Asked for mid-read (a Refresh click): read again once this one lands. */
let again = false;

export async function refreshAutomations() {
  if (loading) {
    again = true;
    return;
  }
  loading = true;
  try {
    const report = isPreview()
      ? (await import("./mock")).mockAutomations()
      : await invoke<AutomationsReport>("automations_report");
    const watches = track(loadWatches(), report.jobs, Date.now());
    saveWatches(watches);
    setState({ automations: report, automationsError: null, automationWatch: watches });
  } catch (e) {
    setState({ automationsError: String(e) });
  } finally {
    loading = false;
  }
  if (again) {
    again = false;
    void refreshAutomations();
  }
}

/** Mount once: keeps `state.automations` fresh — every 30 s while the view
 *  is open, every five minutes otherwise (the sidebar's health dot). */
export function useAutomationsPolling() {
  useEffect(() => {
    void refreshAutomations();
    let last = Date.now();
    const t = setInterval(() => {
      if (document.hidden) return;
      const every = getState().view === "automations" ? 30_000 : 300_000;
      if (Date.now() - last >= every) {
        last = Date.now();
        void refreshAutomations();
      }
    }, 5_000);
    return () => clearInterval(t);
  }, []);
}
