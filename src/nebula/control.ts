// The webview's half of the dev build's control socket (control.rs): each
// request `scripts/drive` sends arrives here as an event, is done to the
// window the way you'd do it, and its answer goes back. Nothing arrives
// unless the app was started by `scripts/sandbox.sh app`.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getState, projectOfWorktree, setState, type State } from "./store";
import { openPreview } from "./preview";
import { snapshot } from "./moments";
import { setPaneMode, standIn, type PaneMode } from "./pane";
import { chord, labelOf, matching, pick } from "./drive";
import type { Transcript } from "./transcript";

type Req = Record<string, unknown> & { cmd?: string };

const VIEWS: State["view"][] = ["sessions", "usage", "activity", "ideas", "settings", "review", "compare", "dispatch", "uncommitted"];

/** What can be clicked. */
const CONTROLS = "button, a[href], [role=button], [role=tab], [role=radio], [role=menuitem], [role=option], summary, label, input[type=checkbox]";

const visible = (el: Element) => el.getClientRects().length > 0 && !el.closest("[aria-hidden=true], [hidden]");

const labelFor = (el: Element) =>
  labelOf({ label: el.getAttribute("aria-label"), text: (el as HTMLElement).innerText ?? el.textContent, title: el.getAttribute("title") });

const str = (req: Req, key: string): string => {
  const v = req[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`${req.cmd} needs "${key}"`);
  return v;
};

const frames = (n = 2) => new Promise<void>((r) => {
  const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : r());
  step(n);
});

function threads(s: State) {
  return Object.values(s.agents)
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name, status: a.status, harness: a.kind, project: projectOfWorktree(s, a.worktree_id)?.name ?? null }));
}

function select(id: string) {
  const s = getState();
  const agent = s.agents[id];
  const project = agent ? projectOfWorktree(s, agent.worktree_id) : undefined;
  setState({ view: "sessions", selectedSession: { Agent: id }, ...(project ? { selectedProject: project.id } : {}) });
}

/** A sandbox thread to show a replay on: the open one, else any, else a new
 *  one in the first project. */
async function replayThread(): Promise<string> {
  const s = getState();
  const sel = s.selectedSession;
  if (sel && "Agent" in sel && s.agents[sel.Agent] && !s.agents[sel.Agent].archived) return sel.Agent;
  const any = Object.values(s.agents).find((a) => !a.archived);
  if (any) return any.id;
  const main = Object.values(s.worktrees).find((w) => w.is_main);
  if (!main) throw new Error("the sandbox has no project to start a thread in");
  const { createAgent, defaultKind } = await import("./actions");
  const { readSettings } = await import("./client");
  const settings = await readSettings();
  const id = await createAgent({ worktree: main.id, kind: defaultKind(settings), settings, prompt: null, select: false });
  if (!id) throw new Error("the sandbox daemon didn't start a thread");
  for (let i = 0; i < 50 && !getState().agents[id]; i++) await new Promise((r) => setTimeout(r, 100));
  return id;
}

async function run(req: Req): Promise<unknown> {
  switch (req.cmd) {
    case "state": {
      const s = getState();
      return { ...snapshot(s), threads: threads(s) };
    }
    case "text":
      return document.body.innerText.slice(0, 40_000);
    case "view": {
      const view = str(req, "view") as State["view"];
      if (!VIEWS.includes(view)) throw new Error(`views are ${VIEWS.join(", ")}`);
      setState({ view });
      return view;
    }
    case "select": {
      const t = pick(threads(getState()), str(req, "thread"));
      select(t.id);
      return t;
    }
    case "pane": {
      const mode = str(req, "mode");
      if (mode !== "read" && mode !== "terminal") throw new Error('pane is "read" or "terminal"');
      setPaneMode(mode);
      return mode;
    }
    case "open": {
      const paths = req.paths;
      if (!Array.isArray(paths) || !paths.length || !paths.every((p) => typeof p === "string" && p.startsWith("/"))) {
        throw new Error("open needs \"paths\", absolute paths");
      }
      await openPreview(paths as string[]);
      const preview = getState().preview;
      return preview ? preview.files.map((f) => ({ path: f.path, kind: f.kind })) : [];
    }
    case "click": {
      const all = [...document.querySelectorAll(CONTROLS)].filter(visible);
      const hits = matching(all, labelFor, str(req, "text"));
      const nth = typeof req.nth === "number" ? req.nth : null;
      if (!hits.length) throw new Error(`nothing to click called "${req.text}"`);
      if (hits.length > 1 && nth === null) {
        const list = hits.slice(0, 12).map((h, i) => `${i}: ${labelFor(h).slice(0, 60)}`).join("; ");
        throw new Error(`${hits.length} controls match; pass nth. ${list}`);
      }
      const el = hits[nth ?? 0] as HTMLElement | undefined;
      if (!el) throw new Error(`there are only ${hits.length} matches`);
      el.scrollIntoView({ block: "center" });
      el.click();
      await frames();
      return labelFor(el);
    }
    case "type": {
      const text = typeof req.text === "string" ? req.text : str(req, "text");
      let el = document.activeElement as HTMLElement | null;
      if (typeof req.into === "string") {
        const fields = [...document.querySelectorAll("input, textarea")].filter(visible);
        // Its label, hint or name: any of them names it.
        const field = (f: Element) => ["aria-label", "placeholder", "name"].map((a) => f.getAttribute(a) ?? "").join(" | ");
        const hits = matching(fields, field, req.into);
        if (hits.length !== 1) throw new Error(hits.length ? `${hits.length} fields match "${req.into}"` : `no field called "${req.into}"`);
        el = hits[0] as HTMLElement;
        el.focus();
      }
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error("no text field has the focus; pass \"into\"");
      // React tracks the value itself, so it's set the way a keystroke would.
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await frames();
      return text;
    }
    case "key": {
      const c = chord(str(req, "keys"));
      const target = (document.activeElement as HTMLElement | null) ?? document.body;
      for (const type of ["keydown", "keyup"]) target.dispatchEvent(new KeyboardEvent(type, { ...c, bubbles: true, cancelable: true }));
      await frames();
      return req.keys;
    }
    case "replay": {
      const moment = req.moment as { state?: { view?: string; pane?: PaneMode } } | undefined;
      const thread = req.thread as Transcript | null | undefined;
      if (!moment?.state) throw new Error("replay needs \"moment\", a moment.json");
      const id = await replayThread();
      if (thread?.entries?.length) standIn(id, thread);
      select(id);
      const view = moment.state.view as State["view"] | undefined;
      if (view && VIEWS.includes(view)) setState({ view });
      setPaneMode(moment.state.pane ?? (thread?.entries?.length ? "read" : "terminal"));
      await frames(4);
      return { thread: getState().agents[id]?.name ?? id, id, view: getState().view, entries: thread?.entries?.length ?? 0 };
    }
    default:
      throw new Error(`unknown command "${req.cmd}"`);
  }
}

/** Answer the control socket's requests; returns the unsubscribe. */
export async function startControl(): Promise<() => void> {
  return listen<{ id: number; req: Req }>("observatory://control", async ({ payload }) => {
    let reply: unknown;
    try {
      reply = { ok: true, value: (await run(payload.req)) ?? null };
    } catch (e) {
      reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await invoke("control_reply", { id: payload.id, reply }).catch(() => {});
  });
}
