// Quiet hours: a stretch of the day (set in Settings) when the app makes no
// sound and puts up no banners. The badge and the menu bar still count.
import { getState } from "./store.ts";
import type { DesktopPrefs } from "./theme";

/** Minutes since local midnight for "HH:MM"; null when unset or malformed. */
function minutes(t: string | undefined): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Whether now falls in the quiet hours set in Settings (which may run
 *  past midnight, 22:00 to 08:00). */
export function isQuietNow(now = new Date()): boolean {
  return inQuietHours(getState().prefs, now);
}

/** Whether `now` falls between `quietFrom` and `quietTo`. */
export function inQuietHours({ quietFrom, quietTo }: Pick<DesktopPrefs, "quietFrom" | "quietTo">, now: Date): boolean {
  const from = minutes(quietFrom);
  const to = minutes(quietTo);
  if (from === null || to === null || from === to) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return from < to ? m >= from && m < to : m >= from || m < to;
}
