// "Move to project…" on a thread: read what it can of the thread, write
// the brief (movebrief.ts), and open the new-task box on it, for you to pick
// the project, read it over and start. The box archives the old thread
// after, unless you keep it.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreview } from "./client";
import { moveBrief } from "./movebrief";
import { flash, getState } from "./store";
import type { Transcript } from "./transcript";
import type { Agent } from "./types";

export interface MoveRequest {
  agent: Agent;
  prompt: string;
  /** What the box says the task is from. */
  from: string;
}

const listeners = new Set<(m: MoveRequest) => void>();

/** Mount once (App): `open` gets each thread asked to move. */
export function useMoveRequests(open: (m: MoveRequest) => void) {
  useEffect(() => {
    listeners.add(open);
    return () => {
      listeners.delete(open);
    };
  }, [open]);
}

async function transcript(agent: Agent): Promise<Transcript | null> {
  if (!(agent.kind === "claude" || agent.kind === "codex") || !agent.session_id) return null;
  try {
    return isPreview()
      ? (await import("./mock")).mockTranscript(getState(), agent.id)
      : await invoke<Transcript | null>("thread_transcript", { session: agent.session_id, from: null, kind: agent.kind });
  } catch {
    return null;
  }
}

/** Start moving `agent`: the box opens once its brief is written. */
export async function moveThread(agent: Agent) {
  const s = getState();
  const wt = s.worktrees[agent.worktree_id];
  const project = wt ? s.projects[wt.project_id] : undefined;
  if (!wt || !project) return flash("Couldn't find the thread's checkout.");
  const t = await transcript(agent);
  const prompts = [...agent.recent_prompts].sort((a, b) => a.submitted_at - b.submitted_at).map((p) => p.text);
  const prompt = moveBrief({ thread: agent.name, project: project.name, branch: wt.branch, path: wt.path, prompts, entries: t?.entries });
  const req = { agent, prompt, from: `Moving ${agent.name} from ${project.name}` };
  listeners.forEach((l) => l(req));
}
