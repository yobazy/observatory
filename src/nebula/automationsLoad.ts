import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { getState, setState } from "./store";
import type { AutomationsReport } from "./automations";

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
    setState({ automations: report, automationsError: null });
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
