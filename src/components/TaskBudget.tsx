import { useState } from "react";
import { dollars } from "../nebula/budgetHold";
import { updateTask, useBatches, type BatchTask } from "../nebula/batch";
import { useAppState } from "../nebula/store";
import { resettleStuck, useSpent } from "../nebula/stuckRunner";
import { NEAR, sinceText, taskBudget } from "../nebula/stuck";
import type { Agent } from "../nebula/types";

/** A Dispatch task's spend against its budget, counted since the task
 *  started ("$3.20 since the task started, of the $10 budget"), with its own
 *  budget set in place. Past 85% the triage queue flags it stuck. */
export function TaskBudget({ batchId, task, agent }: { batchId: string; task: BatchTask; agent: Agent }) {
  const { prefs } = useAppState();
  const batches = useBatches();
  const spend = useSpent().get(agent.id);
  const [editing, setEditing] = useState(false);
  const budget = taskBudget(agent.id, batches, prefs.taskBudget);
  const save = (raw: string) => {
    setEditing(false);
    const v = Number(raw);
    const next = raw.trim() && v > 0 ? v : undefined;
    if (next === task.budget) return;
    updateTask(batchId, task.id, { budget: next });
    resettleStuck();
  };
  const near = !!spend && spend.cost >= budget * NEAR;
  return (
    <p className="board-note task-budget">
      <span className={near ? "is-near" : undefined}>
        {spend ? `${dollars(spend.cost)} ${sinceText(spend.since)}, of ${task.budget ? "its" : "the"}` : `Budget:`}
      </span>
      {editing ? (
        <span>
          $
          <input
            autoFocus
            type="number"
            min={1}
            step={1}
            inputMode="decimal"
            defaultValue={task.budget ?? ""}
            placeholder={String(budget)}
            aria-label={`Budget for ${task.text} in dollars`}
            onBlur={(e) => save(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        </span>
      ) : (
        <button
          className="link-btn"
          onClick={() => setEditing(true)}
          title={task.budget ? "This task's own budget; empty it to use the one in Settings" : "Give this task its own budget"}
        >
          {dollars(budget)} budget
        </button>
      )}
    </p>
  );
}
