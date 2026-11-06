// Commands an agent was told to run itself, as "! cmd". The CLI runs those
// outside any turn: the agent's status doesn't move and its log gets nothing
// until the command stops, so the app has to remember one is under way.
import { isRun, type ShellRun } from "./command";
import { getState, setState, type State } from "./store";
import type { Agent } from "./types";

/** Past this the log should have it, as the CLI stops waiting after two
 *  minutes; one that never shows (it went elsewhere) stops saying it runs. */
const GIVE_UP_MS = 180_000;

/** What a thread's status says instead, or "Done" would stand over the run. */
export const RUNNING_LABEL = "Running a command";

/** Whether `agent` has a command under way, and isn't stopped on a question. */
export function runningCommand(s: State, agent: Agent): boolean {
  return agent.status !== "needs_feedback" && !!s.shellRuns[agent.id]?.length;
}

export function startRun(agentId: string, command: string): ShellRun {
  const run = { command, at: Date.now() };
  setState((s) => ({ shellRuns: { ...s.shellRuns, [agentId]: [...(s.shellRuns[agentId] ?? []), run] } }));
  setTimeout(() => endRun(agentId, run), GIVE_UP_MS);
  return run;
}

export function endRun(agentId: string, run: ShellRun) {
  setState((s) => {
    const left = (s.shellRuns[agentId] ?? []).filter((r) => r !== run);
    const shellRuns = { ...s.shellRuns };
    if (left.length) shellRuns[agentId] = left;
    else delete shellRuns[agentId];
    return { shellRuns };
  });
}

export function isRunning(agentId: string, command: string): boolean {
  return (getState().shellRuns[agentId] ?? []).some((r) => isRun(r, command));
}
