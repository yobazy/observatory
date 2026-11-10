// The eyepiece row: every thread that's moving or waiting on you, across
// projects, as its plate. You can see what's live without opening anything,
// and click a lens to open its thread.
import { projectOfWorktree, threadAgents, useAppState } from "../nebula/store";
import { statusLabel } from "../nebula/status";
import { liveThreads } from "../nebula/live";
import { ThreadPlate, plateTone } from "./Plate";
import { selectAgent } from "./Sidebar";

/** As many lenses as fit a narrow pane; the rest are counted. */
const MAX = 12;

export function LiveStrip({ current }: { current: string | undefined }) {
  const state = useAppState();
  const live = liveThreads(threadAgents(state));
  if (live.length === 0) return null;
  const shown = live.slice(0, MAX);
  return (
    <nav className="live-strip" aria-label="Live threads">
      {shown.map((a) => {
        const project = projectOfWorktree(state, a.worktree_id)?.name;
        return (
          <button
            key={a.id}
            className={`lens is-${plateTone(a)}${a.id === current ? " is-on" : ""}`}
            onClick={() => selectAgent(a)}
            aria-current={a.id === current ? "true" : undefined}
            title={`${a.name}${project ? `, in ${project}` : ""}: ${statusLabel(a)}`}
          >
            <ThreadPlate agent={a} size={44} />
            <span className="lens-name">{a.name}</span>
          </button>
        );
      })}
      {live.length > MAX && <span className="live-more">+{live.length - MAX}</span>}
    </nav>
  );
}
