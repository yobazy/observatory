// What you've picked and typed on each Decisions card (Inbox.tsx), kept
// apart from the cards so it survives moving between them, and what each
// would send. The queue beside the card reads it too.

import { answerText, suggested, type Ask, type Card } from "./replycard.ts";

/** Your answer to one card so far. */
export interface Answer {
  /** Taps on the latest reply's options, by decision. "" is a tap undone. */
  picks: Record<number, string>;
  /** The reply box. */
  draft: string;
  /** Taps on decisions earlier replies left open, by reply then decision. */
  back: Record<number, Record<number, string>>;
}

export const NO_ANSWER: Answer = { picks: {}, draft: "", back: {} };

/** An earlier reply's decisions still open, as Decisions lists them. */
export interface Earlier {
  entry: number;
  quote: string;
  asks: Ask[];
}

/** Each earlier reply's answers said against it, as the Read view does. */
export function backLines(earlier: Earlier[], a: Answer): string[] {
  return earlier
    .map((d) => [d.quote, answerText(a.back[d.entry] ?? {}, "")] as const)
    .filter(([, said]) => said)
    .map(([quote, said]) => `About your reply that starts "${quote}": ${said}`);
}

/** What Send would send: the latest reply's answers and anything typed, then
 *  answers to earlier replies in a paragraph of their own. Empty when
 *  there's nothing to send. */
export function outgoing(earlier: Earlier[], a: Answer): string {
  return [answerText(a.picks, a.draft), backLines(earlier, a).join("\n")].filter(Boolean).join("\n\n");
}

/** The card's own recommendation, as taps, when you haven't started on it:
 *  nothing picked, typed or answered against an earlier reply. */
export function recommendedFor(card: Card, a: Answer): Record<number, string> {
  const started = Object.values(a.picks).some(Boolean) || a.draft.trim() || Object.values(a.back).some((b) => Object.values(b).some(Boolean));
  return started ? {} : suggested(card);
}

/** The first question a card asks, in plain words for one line: its bold
 *  lead and Markdown taken off. "+2" counts the ones after it. */
export function firstQuestion(card: Card | null): { text: string; more: number } | null {
  const asks = card?.asks ?? [];
  if (!asks.length) return null;
  const text = asks[0].text
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { text, more: asks.length - 1 };
}

/** What you picked, in the options' own words, for checking a card's answer
 *  from the queue without opening it: "commit & push · yes". Written-in
 *  answers read as written; anything typed comes last, in quotes. */
export function pickedWords(card: Card | null, a: Answer): string {
  const plain = (s: string) =>
    s
      .replace(/(\*\*|__|`)/g, "")
      .replace(/\s*\(recommended[^)]*\)\s*/i, " ")
      .replace(/\s+/g, " ")
      .trim();
  const words = Object.entries(a.picks)
    .filter(([, l]) => l.trim())
    .sort(([x], [y]) => Number(x) - Number(y))
    .map(([n, l]) => {
      const opt = card?.asks.find((q) => q.n === Number(n))?.options.find((o) => o.letter === l);
      return opt ? plain(opt.label) || l : /^[A-Z]$/.test(l) ? `${n}${l}` : plain(l);
    });
  const typed = a.draft.trim();
  return [...words, typed && `“${typed}”`].filter(Boolean).join(" · ");
}
