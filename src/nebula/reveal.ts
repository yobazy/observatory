// A reply that lands while you watch fades in word by word, the way chat
// apps show a model's answer as it streams. The log hands over a reply
// whole, so this paces its words out as a stream would: in reading order,
// at a steady rate, faster for a long reply so none takes long to read in.
// The words sit in their final places from the start, so nothing reflows
// and the view doesn't jump as they appear.

/** A reply's words, each with the space after it; space before the first
 *  word stays with it. */
export function words(text: string): string[] {
  const got = text.match(/\s*\S+\s*/g);
  return got ?? (text ? [text] : []);
}

/** How long a fade takes, and the most a whole reply's reveal may run. */
export const FADE_MS = 360;
const MOST_MS = 1400;
const STEP_MS = 24;

/** The time between one word's start and the next's: about 40 words a
 *  second, and quicker past 60 words so the last starts within 1.4s. */
export function step(count: number): number {
  return count > 1 ? Math.min(STEP_MS, MOST_MS / (count - 1)) : 0;
}

// Text that shows as a block rather than words: code, controls, pictures.
const WHOLE = "pre, button, img, video, svg, input, textarea, select, .rd-opts";
// What's not part of the reply: the tools over it, the lead's face.
const SKIP = ".rd-tools, .rd-code-acts, .chat-say-pet";

/** Fades in what's under `root`, word by word, and puts the page back as it
 *  was once done. Text nodes React made keep their identity: each one carries
 *  its first word while the rest of its words go into new spans, and gets its
 *  whole text back after, so React can still update or remove it. Returns a
 *  function that ends the reveal at once; `done` hears when it ends on its
 *  own. */
export function reveal(root: HTMLElement, done?: () => void): () => void {
  const undo: (() => void)[] = [];
  let i = 0;
  const found: Node[] = [];
  const collect = (at: Node) => {
    for (const n of at.childNodes) {
      if (n instanceof Text) {
        if (n.nodeValue?.trim()) found.push(n);
      } else if (n instanceof Element) {
        // What's inside a whole block goes with it.
        if (n.matches(SKIP)) continue;
        if (n.matches(WHOLE)) found.push(n);
        else collect(n);
      }
    }
  };
  collect(root);
  for (const n of found) {
    if (n instanceof Element && (n instanceof HTMLElement || n instanceof SVGElement)) {
      n.classList.add("rv-w");
      n.style.setProperty("--rv", String(i++));
      undo.push(() => {
        n.classList.remove("rv-w");
        n.style.removeProperty("--rv");
      });
      continue;
    }
    if (!(n instanceof Text)) continue;
    const whole = n.nodeValue ?? "";
    const parts = words(whole);
    const spans = parts.map((w, k) => {
      const s = document.createElement("span");
      s.className = "rv-w";
      s.style.setProperty("--rv", String(i++));
      if (k) s.textContent = w;
      return s;
    });
    n.replaceWith(...spans);
    n.nodeValue = parts[0];
    spans[0].append(n);
    undo.push(() => {
      // React may have changed this text since; then its words are stale
      // and what it wrote stands.
      if (n.nodeValue === parts[0]) n.nodeValue = whole;
      // Something else may have rewritten the text around it (a path that
      // became a link, say); then it's no longer ours to put back.
      if (n.parentNode === spans[0] && spans[0].isConnected) spans[0].replaceWith(n);
      for (const s of spans.slice(1)) s.remove();
    });
  }
  root.style.setProperty("--rv-step", `${step(i)}ms`);
  let over = false;
  const end = () => {
    if (over) return;
    over = true;
    window.clearTimeout(timer);
    undo.forEach((u) => u());
    root.style.removeProperty("--rv-step");
  };
  const timer = window.setTimeout(() => {
    end();
    done?.();
  }, step(i) * i + FADE_MS + 80);
  return end;
}
