// The pull requests a "Keep open" verdict names ("#134 waits on the
// reviewer"), looked up by number so the thread can say when they land. A
// thread's own PR line only follows its worktree's branch, and a verdict
// often waits on PRs from other branches. Pure helpers first, so their tests
// run under Node.
import { useEffect, useSyncExternalStore } from "react";
import type { Chip } from "./replycard";

export type PrWord = "open" | "merged" | "closed";

/** The PR numbers a verdict names, in order, once each. */
export function prsNamed(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:^|[^\w&])#(\d{1,6})\b/g)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** "#134 merged", once every PR a waiting verdict names has merged or
 *  closed; null while any is open or unknown. */
export function landedNote(verdict: Chip | null, states: Record<number, PrWord | undefined>): string | null {
  if (verdict?.tone !== "wait") return null;
  const nums = prsNamed(verdict.text);
  if (!nums.length || nums.some((n) => states[n] !== "merged" && states[n] !== "closed")) return null;
  return nums.map((n) => `#${n} ${states[n]}`).join(", ");
}

const word = (s: string): PrWord => (s === "MERGED" ? "merged" : s === "CLOSED" ? "closed" : "open");

// Per repo checkout and number. A merged or closed PR stays that way, so it's
// asked about once; an open one again after a minute.
const known = new Map<string, { state: PrWord; at: number }>();
const asking = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const AGAIN_MS = 60_000;

async function ask(path: string, nums: number[]) {
  const now = Date.now();
  const todo = nums.filter((n) => {
    const k = `${path}#${n}`;
    const got = known.get(k);
    return !asking.has(k) && (!got || (got.state === "open" && now - got.at >= AGAIN_MS));
  });
  if (!todo.length) return;
  todo.forEach((n) => asking.add(`${path}#${n}`));
  try {
    const { isPreview } = await import("./client");
    const found: [number, string][] = isPreview()
      ? todo.map((n) => [n, "MERGED"])
      : await (await import("@tauri-apps/api/core")).invoke<[number, string][]>("gh_pr_states", { path, numbers: todo });
    const at = Date.now();
    for (const [n, s] of found) known.set(`${path}#${n}`, { state: word(s), at });
  } catch {
    // No gh, signed out, offline: say nothing, and ask again later.
    const at = Date.now();
    for (const n of todo) if (!known.has(`${path}#${n}`)) known.set(`${path}#${n}`, { state: "open", at });
  } finally {
    todo.forEach((n) => asking.delete(`${path}#${n}`));
    version++;
    listeners.forEach((l) => l());
  }
}

/** What landed of the PRs a waiting verdict names, asked of gh in `path`
 *  (any checkout of the repo) while it's shown, every minute until they do. */
export function useLanded(path: string | undefined, verdict: Chip | null): string | null {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  const nums = verdict?.tone === "wait" ? prsNamed(verdict.text) : [];
  const key = nums.join(",");
  useEffect(() => {
    if (!path || !key) return;
    const list = key.split(",").map(Number);
    void ask(path, list);
    const t = setInterval(() => {
      if (!document.hidden) void ask(path, list);
    }, 15_000);
    return () => clearInterval(t);
  }, [path, key]);
  if (!path) return null;
  const states: Record<number, PrWord | undefined> = {};
  for (const n of nums) states[n] = known.get(`${path}#${n}`)?.state;
  return landedNote(verdict, states);
}
