// observatory:// links: an agent in one project handing a task to another.
// `open "observatory://new-task?project=<name or path>&prompt=<brief>&from=$NEBULA_AGENT_ID"`
// fills in the New task dialog; nothing starts until you click Start.
// Kept free of the app so its tests run under plain Node.

export interface Handoff {
  /** The project as the link names it: a name, its repo path, or a path in it. */
  project: string | null;
  prompt: string;
  /** The agent that opened the link, by its own say-so. */
  from: string | null;
}

export const MAX_PROMPT = 20_000;

export function parseHandoff(url: string): Handoff | { error: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: "That isn't a link Observatory can read." };
  }
  if (u.protocol !== "observatory:") return { error: "That isn't an observatory:// link." };
  // `observatory://new-task?…` parses with new-task as the host.
  const action = (u.hostname || u.pathname.replace(/^\/+/, "")).replace(/\/+$/, "");
  if (action !== "new-task") return { error: `Observatory doesn't know the link action “${action || "(none)"}”.` };
  const prompt = (u.searchParams.get("prompt") ?? "").trim();
  if (!prompt) return { error: "The link has no task in it." };
  if (prompt.length > MAX_PROMPT) return { error: `The task in the link is over ${MAX_PROMPT.toLocaleString("en-US")} characters.` };
  const project = u.searchParams.get("project")?.trim() || null;
  const from = u.searchParams.get("from")?.trim() || null;
  return { project, prompt, from };
}

interface ProjectLike {
  id: string;
  name: string;
  repo_path: string;
}

const norm = (p: string) => p.replace(/\/+$/, "").replace(/^\/private\//, "/");

/** The one project `ref` names, by name (any case), repo path, or a path
 *  inside the repo; null when none or several do, for you to pick. */
export function matchProject<P extends ProjectLike>(projects: P[], ref: string | null): P | null {
  if (!ref) return null;
  const want = ref.trim();
  if (want.startsWith("/") || want.startsWith("~")) {
    const path = norm(want);
    // The deepest repo that holds the path, so a nested checkout wins.
    const holders = projects
      .filter((p) => {
        const repo = norm(p.repo_path);
        return path === repo || path.startsWith(`${repo}/`) || (want.startsWith("~") && repo.endsWith(path.slice(1)));
      })
      .sort((a, b) => b.repo_path.length - a.repo_path.length);
    if (holders.length === 0) return null;
    if (holders.length > 1 && norm(holders[0].repo_path).length === norm(holders[1].repo_path).length) return null;
    return holders[0];
  }
  const named = projects.filter((p) => p.name.toLowerCase() === want.toLowerCase());
  return named.length === 1 ? named[0] : null;
}

/** Who the dialog says the task is from. Only an agent this daemon knows
 *  gets named, so a link from a web page can't pass as one of yours. */
export function fromLabel(
  from: string | null,
  agents: Record<string, { name: string; worktree_id: string }>,
  projectOf: (worktreeId: string) => { name: string } | undefined,
): string {
  const a = from ? agents[from] : undefined;
  if (!a) return "From a link";
  const p = projectOf(a.worktree_id);
  return p ? `From ${a.name} in ${p.name}` : `From ${a.name}`;
}

/** What to put in your global CLAUDE.md / AGENTS.md so agents know how. */
export const HANDOFF_INSTRUCTION = `## Handing work to another project

When you find work that belongs in a different project than the one you're in, don't do it here. Hand it to that project through Observatory:

1. Write a brief someone could act on without this conversation: what you found, where (files, lines, commands), why it matters, and what done looks like.
2. Open it as a link, URL-encoding the brief:

   open "observatory://new-task?project=<project name or path>&prompt=<brief>&from=$NEBULA_AGENT_ID"

Observatory shows it as a New task for me to check and start. Tell me you've handed it off, and carry on with your own task.`;
