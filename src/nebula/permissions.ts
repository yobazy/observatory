// Run free (permissions.rs): which projects' threads run without permission
// prompts, as the Rust side wants them, from the project cards. It has no
// value imports beyond lead.ts, so the tests load it in Node;
// permissionsRunner.ts hands the result over whenever it changes.
import type { Cards } from "./cards";
import { leadIds } from "./lead.ts";
import type { Project } from "./types";

/** cards.ts's key for a plain folder that's Home: `folder:<path>`. */
const FOLDER = "folder:";

export interface PermissionRule {
  /** The project's main checkout (or Home's folder). */
  root: string;
  level: "free";
}

export interface PermissionSync {
  projects: PermissionRule[];
  /** Leads' agent ids: their own guard decides for them. */
  skip: string[];
}

/** The Run free projects and the leads to leave alone, sorted so the same
 *  cards always give the same answer (and nothing is rewritten for nothing). */
export function permissionSync(cards: Cards, projects: Record<string, Pick<Project, "repo_path">>, top?: { agentId: string } | null): PermissionSync {
  const roots = new Set<string>();
  for (const [key, card] of Object.entries(cards)) {
    if (card.permissions !== "free") continue;
    const root = key.startsWith(FOLDER) ? key.slice(FOLDER.length) : projects[key]?.repo_path;
    if (root) roots.add(root);
  }
  return {
    projects: [...roots].sort().map((root) => ({ root, level: "free" as const })),
    skip: [...leadIds(cards, top)].sort(),
  };
}
