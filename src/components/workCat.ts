// The cat on the Read view's working line (WorkCat in Pet.tsx): it acts out
// the step under way, while the sidebar cat keeps to its own yard. Pure
// functions, like petBrain, so it can be simulated.
import type { Act } from "../nebula/transcript";
import { CAT_W, SCOPE_AT, SCOPE_W, type Frame } from "./petBrain.ts";

/** What it's doing: the step's kind, "think" between steps, and "nap"
 *  once one thing has gone on a while. */
export type Doing = Act | "think" | "nap";

/** One thing going on this long (ms), the same step or the same quiet
 *  spell, and the cat dozes off. */
export const NAP_AFTER = 120_000;
/** How far it paces while a command runs (px). */
export const PACE = 22;
/** Room for the widest act: the telescope. */
export const DESK_W = SCOPE_AT + SCOPE_W;

export interface Desk {
  x: number;
  dir: 1 | -1;
  frame: Frame;
  step: number;
  bubble: "heart" | "sweat" | "z" | null;
  bubbleLeft: number;
}

export const DESK: Desk = { x: 0, dir: 1, frame: "sit", step: 0, bubble: null, bubbleLeft: 0 };

export function doingNow(act: Act | null, sameFor: number): Doing {
  if (sameFor >= NAP_AFTER) return "nap";
  return act ?? "think";
}

/** Moves the cat one tick at what it's doing. */
export function deskStep(d: Desk, doing: Doing): Desk {
  const n: Desk = { ...d, step: d.step + 1 };
  if (n.bubbleLeft > 0) n.bubbleLeft -= 1;
  else n.bubble = doing === "nap" ? "z" : null;
  // Only pacing leaves the start of the line, where its props stand.
  if (doing !== "run") {
    n.x = 0;
    n.dir = 1;
  }
  switch (doing) {
    case "run": {
      n.x += 1.4 * n.dir;
      if (n.x <= 0 || n.x >= PACE) {
        n.x = Math.max(0, Math.min(PACE, n.x));
        n.dir = n.dir === 1 ? -1 : 1;
      }
      n.frame = n.step % 2 ? "walkA" : "walkB";
      return n;
    }
    case "edit":
      // Typing in bursts, with a pause to look at what it wrote.
      n.frame = n.step % 30 >= 24 || n.step % 4 < 2 ? "typeA" : "typeB";
      return n;
    case "read":
      n.frame = Math.floor(n.step / 8) % 2 ? "readB" : "readA";
      return n;
    case "web":
      n.frame = n.step % 20 < 2 ? "gazeB" : "gazeA";
      return n;
    case "nap":
      n.frame = "sleep";
      return n;
    case "think":
      // Between steps it sits and now and then looks up, mulling it over.
      n.frame = n.step % 45 < 8 ? "lookUp" : n.step % 23 === 0 ? "blink" : "sit";
      return n;
    default:
      n.frame = n.step % 23 === 0 ? "blink" : "sit";
      return n;
  }
}

/** Where each act's prop stands, from the cat's left edge (px). */
export const PROP_AT = { edit: CAT_W - 6, read: CAT_W - 4, web: SCOPE_AT } as const;
