// A thread waiting on you gets warmer the longer it waits: its ring starts
// faint and grows, and after an hour the whole row warms. Nothing pings;
// the one you've kept longest is just the one you notice.

/** 0 when it isn't waiting, else 1 (just asked) to 4 (an hour or more). */
export function warmth(status: string, since: number, now: number): 0 | 1 | 2 | 3 | 4 {
  if (status !== "needs_feedback") return 0;
  const min = (now - since) / 60_000;
  return min < 5 ? 1 : min < 20 ? 2 : min < 60 ? 3 : 4;
}
