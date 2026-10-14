// When the app flags a task for follow-up by itself: a turn that ends while
// you aren't looking at it. Opening the task (from its notification, say)
// is seeing it, not handling it, so the flag stays until you act: the task
// runs again because you replied, or you archive it, or you clear the flag.
// Flags you set yourself are yours and never clear on their own.
// Kept free of the app so its tests run under plain Node.

export interface FollowUpPrefs {
  followUps?: Record<string, number>;
  autoFollowUps?: Record<string, true>;
}

interface TaskLike {
  id: string;
  status: string;
  archived: boolean;
}

/** The prefs after `task` moved on from `from`, or null when the flags stay
 *  as they are. `watching` is whether you had its terminal in front of you. */
export function afterStatus<P extends FollowUpPrefs>(
  prefs: P,
  task: TaskLike,
  from: string,
  watching: boolean,
  now: number,
): P | null {
  const flagged = prefs.followUps?.[task.id] !== undefined;
  if (task.status === "finished" && from === "running" && !watching && !task.archived) {
    if (flagged) return null;
    return {
      ...prefs,
      followUps: { ...prefs.followUps, [task.id]: now },
      autoFollowUps: { ...prefs.autoFollowUps, [task.id]: true },
    };
  }
  return null;
}

/** The prefs with the app's own flags dropped for tasks you've since acted
 *  on (running again, archived, or gone), or null when none are. */
export function settled<P extends FollowUpPrefs>(prefs: P, tasks: Record<string, TaskLike>): P | null {
  const auto = prefs.autoFollowUps ?? {};
  const done = Object.keys(auto).filter((id) => {
    const t = tasks[id];
    return !t || t.archived || t.status === "running";
  });
  if (!done.length) return null;
  const followUps = { ...prefs.followUps };
  const autoFollowUps = { ...auto };
  for (const id of done) {
    delete followUps[id];
    delete autoFollowUps[id];
  }
  return { ...prefs, followUps, autoFollowUps };
}
