import { useState } from "react";
import { dismissAway, useAwaySince } from "../nebula/away";
import { lastPrompt, relativeTime } from "../nebula/status";
import { projectOfWorktree, useAppState } from "../nebula/store";
import { summarize } from "../nebula/turnsummary";
import type { Agent } from "../nebula/types";
import { useTurn } from "./TurnStrip";

/** Rows shown before "Show all". */
const MAX_ROWS = 3;

/** One finished thread: its name, and what its turn did in a line. */
function Row({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const state = useAppState();
  const turn = useTurn(agent);
  const project = projectOfWorktree(state, agent.worktree_id);
  const failed = agent.status === "terminated";
  const did = turn
    ? summarize(turn, state.worktrees[agent.worktree_id]?.path ?? "").headline.map((p) => p.text).join(" · ")
    : lastPrompt(agent);
  return (
    <li>
      <button
        className="waiting-row away-row"
        onClick={onOpen}
        title={`${agent.name}, in ${project?.name ?? "its project"}, ${failed ? "stopped with an error" : "finished"} ${relativeTime(agent.status_changed_at) === "now" ? "just now" : `${relativeTime(agent.status_changed_at)} ago`}.${did ? `\n${did}` : ""}\nClick to open it; it leaves this list.`}
      >
        <span className={`sdot dot-${agent.status}`} aria-hidden />
        <span className="waiting-name">{agent.name}</span>
        <span className="away-did">{failed ? "Stopped with an error" : did}</span>
        <span className="waiting-where">
          <span>{project?.name}</span>
          <span className="waiting-age">{relativeTime(agent.status_changed_at)}</span>
        </span>
      </button>
    </li>
  );
}

/** What finished, or failed, while you were away and you haven't looked at
 *  yet. A thread leaves once you open it; × puts the whole list away. */
export function AwayDigest({ onOpen }: { onOpen: (agent: Agent) => void }) {
  const since = useAwaySince();
  const { agents } = useAppState();
  const [all, setAll] = useState(false);
  if (since === null) return null;
  const done = Object.values(agents)
    .filter(
      (a) =>
        !a.archived &&
        a.unseen &&
        (a.status === "finished" || a.status === "terminated") &&
        a.status_changed_at >= since,
    )
    .sort((a, b) => b.status_changed_at - a.status_changed_at);
  if (!done.length) return null;
  return (
    <section className="waiting away" aria-label="Finished while you were away">
      <h2
        className="waiting-title"
        title="What finished while the window was in the background for ten minutes or more, or since the app opened. A task leaves once you open it; × puts the list away."
      >
        While you were away <span className="waiting-count">{done.length}</span>
        <button className="icon-btn away-close" onClick={dismissAway} aria-label="Dismiss" title="Dismiss">
          ×
        </button>
      </h2>
      <ul>
        {(all ? done : done.slice(0, MAX_ROWS)).map((a) => (
          <Row key={a.id} agent={a} onOpen={() => onOpen(a)} />
        ))}
      </ul>
      {done.length > MAX_ROWS && (
        <button
          className="link-btn away-more"
          onClick={() => setAll((v) => !v)}
          title={all ? "Back to the three most recent" : "Every task that finished while you were away"}
        >
          {all ? "Show fewer" : `Show all ${done.length}`}
        </button>
      )}
    </section>
  );
}
