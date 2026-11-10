// Queued follow-ups: prompts that wait for an agent's turn to end and are
// typed in as soon as it does ("then run the tests", "then commit"). The
// daemon has no queue of its own, so this app is what sends them: kept in
// localStorage across launches, and sent only while the app is open.
import { useEffect } from "react";
import { createAgent, defaultKind, followUp, takerFor } from "./actions";
import { onAgentStatus, readSettings } from "./client";
import { trackedCommand } from "./command";
import * as gate from "./queuegate";
import { endRun, startRun } from "./shellruns";
import { flash, getState, setState } from "./store";
import { isReport } from "./typed";
import type { Agent } from "./types";

export interface Queued {
  id: string;
  text: string;
  at: number;
}

const KEY = "observatory.queue";

function load(): Record<string, Queued[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function save(queue: Record<string, Queued[]>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Without storage the queue lasts until the app quits.
  }
}

function write(agentId: string, items: Queued[]) {
  setState((s) => {
    const queue = { ...s.queue };
    if (items.length) queue[agentId] = items;
    else delete queue[agentId];
    save(queue);
    return { queue };
  });
}

export const isIdle = gate.isIdle;

/** Agents a prompt is being typed into, and when this app last typed one
 *  into each: until the agent reports a status change after that, it's
 *  still "finished" only because the daemon hasn't said it's running yet. */
const sending = new Map<string, number>();
const lastSent = new Map<string, number>();
/** When you last typed into each agent's terminal (`noteTyped`). */
const lastTyped = new Map<string, number>();
/** When this app sent each queued prompt, by id, so one gone from the queue
 *  can be told apart from one taken back. */
const sentAt = new Map<string, number>();

/** What the gate (queuegate.ts) needs to know of an agent's sends. */
const sends = (agentId: string): gate.Sends => ({
  sendingSince: sending.get(agentId),
  lastSent: lastSent.get(agentId),
  lastTyped: lastTyped.get(agentId),
});

/** Called on what goes into an agent's terminal from its view: a queued
 *  prompt waits rather than land in the middle of what you're typing. */
export function noteTyped(agentId: string, data = "") {
  if (isReport(data)) return;
  lastTyped.set(agentId, Date.now());
}

async function type(agent: Agent, text: string, select: boolean, stay = false) {
  sending.set(agent.id, Date.now());
  // Stamped before typing: a turn that starts and ends before followUp
  // returns still counts as after it.
  const before = lastSent.get(agent.id);
  lastSent.set(agent.id, Date.now());
  const command = trackedCommand(agent.kind, text);
  const run = command === null ? null : startRun(agent.id, command);
  try {
    await followUp(agent, text, { select, stay });
  } catch (e) {
    if (run) endRun(agent.id, run);
    if (before === undefined) lastSent.delete(agent.id);
    else lastSent.set(agent.id, before);
    throw e;
  } finally {
    sending.delete(agent.id);
  }
}

/** Queue `text` for `agent`, or send it now if the agent is idle and
 *  nothing is queued ahead of it. The agent is looked up afresh: a dialog
 *  may have been open for a while. Resolves with what happened. `stay`
 *  keeps you on the view you sent it from. `turnEndedAt` is when the thread's
 *  log says its turn ended (heldAtPrompt): it may still be "running" for its
 *  background subagents, with its CLI reading. */
export async function enqueue(
  agent: Agent,
  text: string,
  opts: { stay?: boolean; turnEndedAt?: number | null } = {},
): Promise<"sent" | "queued"> {
  const s = getState();
  const now = s.agents[agent.id] ?? agent;
  const ahead = s.queue[agent.id] ?? [];
  const reading = gate.reads(now, opts.turnEndedAt, sends(now.id));
  if (!ahead.length && (reading || gate.readyForNext(now, sends(now.id)))) {
    await type(now, text, !opts.stay, opts.stay);
    return "sent";
  }
  write(agent.id, [...ahead, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, at: Date.now() }]);
  return "queued";
}

/** Hand `prompt` to the branch's agent like runOnWorktree does, except that
 *  an agent still mid-turn gets it queued rather than refused; or to `to`,
 *  a thread picked by hand. Resolves with a line saying what happened. */
export async function handToBranch(worktreeId: string, prompt: string, what: string, to?: Agent): Promise<string> {
  const taker: ReturnType<typeof takerFor> = to ? { kind: "agent", agent: to } : takerFor(getState(), worktreeId);
  if (taker.kind === "new") {
    const settings = await readSettings();
    await createAgent({ worktree: worktreeId, kind: defaultKind(settings), settings, prompt });
    return `Started an agent to ${what}`;
  }
  const how = await enqueue(taker.agent, prompt);
  return how === "sent"
    ? `Asked ${taker.agent.name} to ${what}`
    : `Queued for ${taker.agent.name}: sent when its turn ends`;
}

/** Change what a queued prompt says, before it goes. False when it's gone
 *  (sent, or taken back) and there's nothing to change. */
export function editQueued(agentId: string, id: string, text: string): boolean {
  const items = getState().queue[agentId] ?? [];
  if (!items.some((q) => q.id === id)) return false;
  write(agentId, items.map((q) => (q.id === id ? { ...q, text } : q)));
  return true;
}

/** When the queued prompt `id` went to its agent; undefined while it's
 *  queued, or once it's been taken back or edited out of the queue. */
export function queuedSentAt(id: string): number | undefined {
  return sentAt.get(id);
}

/** Send a queued prompt without waiting: for a thread at its prompt with
 *  subagents still out, or one whose turn is over and the prompt hasn't
 *  gone. If it can't go, it goes back in the queue and this throws. */
export async function sendQueued(agent: Agent, id: string, turnEndedAt: number | null | undefined) {
  const items = getState().queue[agent.id] ?? [];
  const item = items.find((q) => q.id === id);
  if (!item) return;
  const now = getState().agents[agent.id] ?? agent;
  if (!canSendQueued(now, turnEndedAt)) throw new Error(`${now.name} isn't at its prompt`);
  sentAt.set(id, Date.now());
  write(agent.id, items.filter((q) => q.id !== id));
  try {
    await type(now, item.text, false);
  } catch (e) {
    sentAt.delete(id);
    write(agent.id, [item, ...(getState().queue[agent.id] ?? [])]);
    throw e;
  }
}

/** Whether a queued prompt for `a` can go now, by hand: it's at its prompt,
 *  done with its turn or held there for its subagents. */
export function canSendQueued(a: Agent, turnEndedAt: number | null | undefined, now = Date.now()): boolean {
  return gate.canSendQueued(a, turnEndedAt, sends(a.id), now);
}

export function unqueue(agentId: string, id: string) {
  write(agentId, (getState().queue[agentId] ?? []).filter((q) => q.id !== id));
}

function onScreen(agentId: string): boolean {
  const sel = getState().selectedSession;
  return !!sel && "Agent" in sel && sel.Agent === agentId;
}

async function sendNext(agentId: string) {
  const first = getState().agents[agentId];
  const [next] = getState().queue[agentId] ?? [];
  if (!next || !first || gate.holdNext(first, sends(agentId), onScreen(agentId))) return;
  sending.set(agentId, Date.now());
  try {
    // Let the CLI settle back to its prompt before typing into it.
    await new Promise((r) => setTimeout(r, 1_200));
  } finally {
    sending.delete(agentId);
  }
  const now = getState().agents[agentId];
  const [still, ...rest] = getState().queue[agentId] ?? [];
  // It started another turn meanwhile, or the item was removed.
  if (!now || !gate.readyForNext(now, sends(agentId)) || still?.id !== next.id) return;
  sentAt.set(next.id, Date.now());
  write(agentId, rest);
  try {
    await type(now, next.text, false);
    flash(`Sent the queued prompt to ${now.name}`);
  } catch (e) {
    sentAt.delete(next.id);
    write(agentId, [next, ...(getState().queue[agentId] ?? [])]);
    flash(`Couldn't send the queued prompt: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Mount once: loads the queue and sends each agent's next prompt when its
 *  turn finishes. */
export function useQueueRunner() {
  useEffect(() => {
    const stored = load();
    setState({ queue: stored });
    const off = onAgentStatus((agent) => {
      if (agent.status === "finished") void sendNext(agent.id);
    });
    // A sweep for what the status events can't catch: an agent that went
    // idle while the app was closed or while you were typing, one that
    // booted without a prompt, and one deleted or archived (its queue goes
    // with it).
    const sweep = setInterval(() => {
      const s = getState();
      if (!s.loaded || s.link.state !== "connected") return;
      for (const [id, items] of Object.entries(s.queue)) {
        const a = s.agents[id];
        if (!a || a.archived) {
          write(id, []);
          flash(`Dropped ${items.length} queued ${items.length === 1 ? "prompt" : "prompts"}: ${a ? `${a.name} was archived` : "its task is gone"}`);
        } else void sendNext(id);
      }
    }, 5_000);
    return () => {
      off();
      clearInterval(sweep);
    };
  }, []);
}
