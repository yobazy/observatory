// What comments on a previewed file are, and the prompt they make.

export interface Target {
  /** Finds the element again in a page (HTML); empty for a doc. */
  selector: string;
  /** The element's tag: "button", "h2", "li". */
  tag: string;
  /** What it says, shortened. */
  text: string;
  /** On a picture: the spot, as fractions of its width and height. */
  at?: { x: number; y: number };
}

/** What a comment is on, in the files that take them. */
export type CommentKind = "page" | "doc" | "picture";

export interface MockComment {
  id: string;
  target: Target;
  note: string;
  sent: boolean;
}

const NOUN: Record<string, string> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "paragraph",
  li: "list item",
  tr: "table row",
  td: "table cell",
  th: "table heading",
  blockquote: "quote",
  pre: "code block",
  a: "link",
  img: "image",
};

/** Where a spot is on a picture, in words: "40% across, 25% down". */
export function spotText(at: { x: number; y: number }): string {
  return `${Math.round(at.x * 100)}% across, ${Math.round(at.y * 100)}% down`;
}

/** How a prompt names the thing commented on. */
function describeTarget(t: Target, kind: CommentKind): string {
  if (t.at) return `The spot ${spotText(t.at)} the picture`;
  const quoted = t.text ? ` "${t.text}"` : "";
  if (kind === "doc") return `The ${NOUN[t.tag] ?? t.tag}${quoted}`;
  return `The <${t.tag}>${quoted}${t.selector ? ` (${t.selector})` : ""}`;
}

/** The prompt for the unsent comments on `path`. */
export function commentPrompt(path: string, kind: CommentKind, comments: MockComment[]): string {
  const lines = comments.map((c, i) => `${i + 1}. ${describeTarget(c.target, kind)}: ${c.note}`);
  if (kind === "picture")
    return `Notes on the picture at ${path}. Please take these into account:\n\n${lines.join("\n")}`;
  const what = kind === "doc" ? "the doc" : "the mockup";
  return `Feedback on ${what} at ${path}. Please make these changes in that file:\n\n${lines.join("\n")}`;
}

