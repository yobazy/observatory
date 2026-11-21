// Hands Run free's projects to the Rust side (permissions.rs) whenever the
// cards or the project list change, which also puts its hook in your Claude
// settings or takes it out.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { useCards } from "./cards";
import { permissionSync } from "./permissions";
import { flash, useAppState } from "./store";

let last = "";

/** Mount once. */
export function usePermissionsSync() {
  const cards = useCards();
  const { projects, prefs, link } = useAppState();
  const top = prefs?.topLead;
  // Until the daemon's projects are in, a Run free card has no folder yet,
  // and syncing then would take the hook out for a moment.
  const ready = link.state === "connected" && Object.keys(projects).length > 0;
  useEffect(() => {
    if (isPreview() || !ready) return;
    const sync = permissionSync(cards, projects, top);
    const text = JSON.stringify(sync);
    if (text === last) return;
    last = text;
    invoke("permissions_sync", { ...sync }).catch((e) => {
      last = "";
      flash(`Couldn't set up Run free: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, [cards, projects, top, ready]);
}
