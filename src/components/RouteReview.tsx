import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runRouter } from "../nebula/client";
import { useCards } from "../nebula/cards";
import { dispatchPlan } from "../nebula/batch";
import { kickBatches } from "../nebula/batchRunner";
import type { DispatchItem } from "../nebula/dispatch";
import {
  MODES,
  TARGETS,
  buildRouterPrompt,
  handOffPlan,
  parsePlan,
  previewReply,
  retarget,
  routerCards,
  validatePlan,
  withMode,
  type Mode,
  type OpenSession,
  type PlanTask,
  type RouteContext,
  type RouterWorktree,
  type Target,
} from "../nebula/router";
import { flash, sortedProjects, useAppState } from "../nebula/store";

const TARGET_LABEL: Record<Target, string> = { project: "Project", home: "Home", you: "You" };
const MODE_LABEL: Record<Mode, string> = {
  new_worktree: "New worktree",
  existing_worktree: "Existing worktree",
  existing_chat: "Follow up in a chat",
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Routing = { kind: "routing" } | { kind: "error"; error: string } | { kind: "ready" };

/** What the router sees of the app: worktrees, open sessions and cards,
 *  as plain data for router.ts. */
function useRouteContext(items: DispatchItem[]): RouteContext {
  const s = useAppState();
  const allCards = useCards();
  return useMemo(() => {
    const worktrees: RouterWorktree[] = Object.values(s.worktrees).map((w) => ({
      id: w.id,
      projectId: w.project_id,
      branch: w.branch,
      isMain: w.is_main,
    }));
    const sessions: OpenSession[] = Object.values(s.agents)
      .filter((a) => !a.archived && s.worktrees[a.worktree_id])
      .sort((a, b) => b.status_changed_at - a.status_changed_at)
      .map((a) => {
        const wt = s.worktrees[a.worktree_id];
        return {
          id: a.id,
          name: a.name,
          projectId: wt.project_id,
          worktreeId: wt.id,
          branch: wt.branch,
          kind: a.custom_harness ?? a.kind,
          status: a.status,
          recentPrompts: a.recent_prompts.map((p) => p.text),
        };
      });
    const projects = Object.values(s.projects).map((p) => ({ id: p.id, name: p.name }));
    return {
      items: items.map(({ id, text, context }) => ({ id, text, context })),
      cards: routerCards(allCards, projects, worktrees),
      worktrees,
      sessions,
    };
  }, [s.worktrees, s.agents, s.projects, allCards, items]);
}

/** The router's plan for the list, every task editable, before anything
 *  runs. Dispatch turns the confirmed plan into a batch (batch.ts), which
 *  batchRunner.ts launches within the caps. */
export function RouteReview({ items, onBack, onClose }: { items: DispatchItem[]; onBack: () => void; onClose: () => void }) {
  const state = useAppState();
  const allCards = useCards();
  const ctx = useRouteContext(items);
  const [routing, setRouting] = useState<Routing>({ kind: "routing" });
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  // Each run's number: a reply from a run since retried is dropped.
  const run = useRef(0);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const route = useCallback(async () => {
    const n = ++run.current;
    setRouting({ kind: "routing" });
    const c = ctxRef.current;
    try {
      const prompt = buildRouterPrompt(c.items, c.cards, c.sessions);
      const reply = await runRouter(prompt, () => previewReply(c.items, c.cards, c.sessions));
      if (n !== run.current) return;
      const parsed = parsePlan(reply, ctxRef.current);
      if (!parsed.ok) return setRouting({ kind: "error", error: parsed.error });
      setTasks(parsed.plan.tasks);
      setRouting({ kind: "ready" });
    } catch (e) {
      if (n === run.current) setRouting({ kind: "error", error: errText(e) });
    }
  }, []);

  useEffect(() => {
    void route();
    return () => {
      // Closing mid-route drops the reply.
      run.current++;
    };
  }, [route]);

  const check = useMemo(() => validatePlan({ tasks }, ctx), [tasks, ctx]);
  const issuesFor = (id: string) => check.issues.filter((i) => i.taskIds.includes(id));
  const projects = sortedProjects(state);
  const home = ctx.cards.find((c) => c.isHome);
  const itemText = new Map(items.map((i) => [i.id, i.text]));
  const update = (id: string, change: (t: PlanTask) => PlanTask) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? change(t) : t)));

  function dispatch() {
    if (!check.canDispatch) return;
    const batch = dispatchPlan(handOffPlan({ tasks }), items, allCards);
    const listed = batch.tasks.filter((t) => t.state === "listed").length;
    const n = batch.tasks.length - listed;
    flash(
      `Dispatching ${n} ${n === 1 ? "task" : "tasks"}${listed ? `; ${listed} stay${listed === 1 ? "s" : ""} on your list` : ""}`,
    );
    kickBatches();
    onClose();
  }

  const blocked = check.issues.length;

  return (
    <div className="dialog dispatch route-review" role="dialog" aria-modal="true" aria-labelledby="route-title">
      <h2 id="route-title">Route {items.length === 1 ? "1 item" : `${items.length} items`}</h2>

      {routing.kind === "routing" ? (
        <p className="route-status" role="status">
          <span className="orbit" aria-hidden /> Routing the list…
        </p>
      ) : routing.kind === "error" ? (
        <div className="route-status route-failed" role="alert">
          <p className="dialog-error">Couldn't route the list: {routing.error}</p>
          <p className="dialog-note">Nothing was started.</p>
        </div>
      ) : (
        <ol className="route-tasks" aria-label="Tasks">
          {tasks.map((t) => {
            const own = issuesFor(t.id);
            const worktrees = ctx.worktrees.filter((w) => w.projectId === t.projectId);
            const chats = ctx.sessions.filter((s) => s.projectId === t.projectId);
            const card = ctx.cards.find((c) => c.projectId === t.projectId);
            return (
              <li key={t.id} className={`route-task${own.length ? " has-issue" : ""}`}>
                <textarea
                  className="task-box route-text"
                  rows={2}
                  value={t.text}
                  onChange={(e) => update(t.id, (x) => ({ ...x, text: e.target.value }))}
                  aria-label="Task prompt"
                />
                {t.sourceItemIds.length > 0 && (
                  <span className="route-from">
                    From {t.sourceItemIds.map((id) => `“${itemText.get(id) ?? id}”`).join(" + ")}
                  </span>
                )}

                <div className="route-row">
                  <div className="segmented segmented-sm" role="radiogroup" aria-label="Target">
                    {TARGETS.map((target) => (
                      <button
                        type="button"
                        key={target}
                        role="radio"
                        aria-checked={t.target === target}
                        className={t.target === target ? "is-on" : ""}
                        onClick={() => t.target !== target && update(t.id, (x) => retarget(x, target, undefined, ctx))}
                      >
                        {TARGET_LABEL[target]}
                      </button>
                    ))}
                  </div>

                  {t.target === "project" && (
                    <select
                      className="route-select"
                      value={t.projectId ?? ""}
                      onChange={(e) => update(t.id, (x) => retarget(x, "project", e.target.value || undefined, ctx))}
                      aria-label="Project"
                    >
                      <option value="">Pick a project…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {ctx.cards.some((c) => c.projectId === p.id) ? "" : " (no card)"}
                        </option>
                      ))}
                    </select>
                  )}
                  {t.target === "project" && t.projectId && (
                    <select
                      className="route-select"
                      value={t.mode ?? ""}
                      onChange={(e) => update(t.id, (x) => withMode(x, e.target.value as Mode, ctx))}
                      aria-label="How it runs"
                    >
                      {!t.mode && <option value="">How it runs…</option>}
                      {MODES.map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  )}
                  {t.target === "project" && t.projectId && t.mode === "existing_worktree" && (
                    <select
                      className="route-select"
                      value={t.worktreeId ?? ""}
                      onChange={(e) => update(t.id, (x) => ({ ...x, worktreeId: e.target.value || undefined }))}
                      aria-label="Worktree"
                    >
                      <option value="">Pick a worktree…</option>
                      {worktrees.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.branch}
                          {w.isMain ? " (main checkout)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  {t.target === "project" && t.projectId && t.mode === "existing_chat" && (
                    <select
                      className="route-select"
                      value={t.sessionId ?? ""}
                      onChange={(e) => update(t.id, (x) => ({ ...x, sessionId: e.target.value || undefined }))}
                      aria-label="Chat"
                    >
                      <option value="">{chats.length ? "Pick a chat…" : "No open chats here"}</option>
                      {chats.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.branch} · {s.status}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="route-row route-meta">
                  <label className="route-check">
                    <input
                      type="checkbox"
                      checked={t.planCheckpoint}
                      onChange={(e) => update(t.id, (x) => ({ ...x, planCheckpoint: e.target.checked }))}
                    />
                    Stop for my OK on its plan
                  </label>
                  <span className="route-note">
                    {t.target === "home"
                      ? home
                        ? `Runs in Home (${home.name}).`
                        : "No Home is set yet: pick one from the sidebar."
                      : t.target === "you"
                        ? home?.canSchedule
                          ? "Home books time for it."
                          : "Stays on your list."
                        : t.skill && card?.skills.includes(t.skill)
                          ? `Uses the ${t.skill} skill.`
                          : card?.policy === "shared"
                            ? `Shared: at most ${card.concurrency} at once.`
                            : ""}
                  </span>
                  <button
                    type="button"
                    className="icon-btn route-remove"
                    onClick={() => setTasks((ts) => ts.filter((x) => x.id !== t.id))}
                    title="Remove task"
                    aria-label={`Remove task ${t.text}`}
                  >
                    ×
                  </button>
                </div>

                {t.question && <p className="route-question">Router asks: {t.question}</p>}
                {t.needsChoice && (
                  <p className="route-unsure">The router wasn't sure where this goes. Check the target and project.</p>
                )}
                {own.map((i) => (
                  <p key={i.message} className="dialog-error route-issue">
                    {i.message}
                  </p>
                ))}
              </li>
            );
          })}
        </ol>
      )}

      {routing.kind === "ready" && check.unrouted.length > 0 && (
        <p className="dialog-note">
          Not in any task: {check.unrouted.map((id) => `“${itemText.get(id) ?? id}”`).join(", ")}.
        </p>
      )}

      <footer className="dialog-foot">
        <span className="hint">
          {routing.kind !== "ready"
            ? ""
            : !tasks.length
              ? "No tasks left."
              : blocked
                ? `${blocked} ${blocked === 1 ? "thing" : "things"} to fix before dispatching`
                : `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}, nothing started yet`}
        </span>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        {routing.kind === "error" ? (
          <button type="button" className="btn btn-primary" onClick={() => void route()} autoFocus>
            Retry
          </button>
        ) : (
          <>
            {routing.kind === "ready" && (
              <button type="button" className="btn" onClick={() => void route()} title="Ask the router again">
                Re-route
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={routing.kind !== "ready" || !check.canDispatch}
              onClick={dispatch}
            >
              Dispatch
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
