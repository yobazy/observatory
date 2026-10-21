import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar, selectAgent } from "./components/Sidebar";
import { Sessions } from "./components/Sessions";
import { TerminalPane } from "./components/TerminalPane";
import { LaunchDialog } from "./components/LaunchDialog";
import { DispatchDialog } from "./components/DispatchDialog";
import { DispatchBoard } from "./components/DispatchBoard";
import { CardDialog, type CardTarget } from "./components/CardDialog";
import type { Seed } from "./components/RowMenu";
import { useHandoffLinks, type Handoff } from "./nebula/handoffLinks";
import { useMoveRequests } from "./nebula/moveThread";
import { DaemonGate } from "./components/DaemonGate";
import { Welcome } from "./components/Welcome";
import { AddProjectDialog, Notice, addProject, type AddStep } from "./components/AddProject";
import { pickFolder, start } from "./nebula/client";
import { watchAway } from "./nebula/away";
import { homeCard, homeKeyFor, isFolderKey } from "./nebula/cards";
import { useGitPolling } from "./nebula/git";
import { fitColumns, Resizer, SESSIONS, SIDEBAR, startSlide, useColumnWidth, useHidden, useMountedFor, useWindowWidth } from "./components/Resizer";
import { PanelGlyph } from "./components/Sidebar";
import { UsageView } from "./components/Usage";
import { ActivityView } from "./components/Activity";
import { IdeasView } from "./components/Ideas";
import { addIdea, markStarted } from "./nebula/ideas";
import type { Idea } from "./nebula/ideaList";
import { useActivityPolling } from "./nebula/activity";
import { SettingsView } from "./components/Settings";
import { useUsagePolling } from "./nebula/usage";
import { savePrefs, useTheme } from "./nebula/theme";
import { termFont, zoomed } from "./nebula/termfont";
import { useRunWatch, useServingWatch } from "./nebula/runs";
import { useLimitWatch } from "./nebula/limits";
import { useAutoFollowUps } from "./nebula/organize";
import { useProjectSessions } from "./nebula/focus";
import { useRecentTracking } from "./nebula/recent";
import { useProjectLogos } from "./nebula/icons";
import { flash, getState, setState, subscribe, useAppState, waitingAgents } from "./nebula/store";
import { usePrPolling } from "./nebula/prs";
import { useQueueRunner } from "./nebula/queue";
import { useBatchRunner } from "./nebula/batchRunner";
import { ReviewView } from "./components/Review";
import { UncommittedView } from "./components/Uncommitted";
import { CompareView } from "./components/Compare";
import { GridView } from "./components/Grid";
import { useDesktopShell } from "./nebula/desktop";
import { useDelight } from "./nebula/delight";
import { useBudgetWatch } from "./nebula/budget";
import { useFileDrop } from "./nebula/dropfiles";
import { useFanOutPrune } from "./nebula/fanout";
import { useUpdateCheck } from "./nebula/updates";
import { useFolderWatch } from "./nebula/relocate";
import { usePreviewEvents } from "./nebula/preview";
import { useShelf } from "./nebula/shelf";
import { HoverCard, PreviewPane } from "./components/Preview";
import { Palette, type PaletteContext } from "./components/Palette";
import { MomentCard } from "./components/Moments";
import { TextDialog, type TextDialogSpec } from "./components/Dialogs";

export default function App() {
  const [launch, setLaunch] = useState<{
    worktree: string | null;
    seed?: Seed;
    pickProject?: boolean;
    handoff?: Handoff;
    /** An idea being started (Ideas view): its words, and the project it's in. */
    idea?: Idea;
    /** A thread moving here from another project (moveThread.ts). */
    moving?: { agentId: string; name: string };
  } | null>(null);
  // Each opening is a new dialog (see the key below), never an update to one
  // that is already mounted.
  const [launchKey, setLaunchKey] = useState(0);
  const openLaunch = useCallback((worktree?: string, seed?: Seed) => {
    setLaunchKey((k) => k + 1);
    setLaunch({ worktree: worktree ?? null, seed });
  }, []);
  // A task handed over by an observatory:// link, once the projects are in.
  useHandoffLinks(
    useCallback((handoff: Handoff) => {
      setLaunchKey((k) => k + 1);
      setLaunch({ worktree: null, handoff });
    }, []),
  );
  // A thread moving to another project: the box opens on its brief, the
  // project for you to pick.
  useMoveRequests(
    useCallback(({ agent, prompt, from }) => {
      setState({ view: "sessions" });
      setLaunchKey((k) => k + 1);
      setLaunch({ worktree: null, handoff: { projectId: null, named: null, prompt, from }, moving: { agentId: agent.id, name: agent.name } });
    }, []),
  );
  // Dispatch, the day's to-do list; `text` is a list to paste in to begin with.
  const [dispatch, setDispatch] = useState<{ text: string } | null>(null);
  const openDispatch = useCallback((text = "") => {
    setLaunch(null);
    setDispatch({ text });
  }, []);
  // A project card, or Home's: Home is picked from the palette, and can be
  // any folder, a project's or not.
  const [card, setCard] = useState<CardTarget | null>(null);
  const pickHome = useCallback(async () => {
    const path = await pickFolder(homeCard()?.card.homeFolder ?? undefined, "Pick a folder as Home");
    if (!path) return;
    const projects = Object.values(getState().projects);
    const key = homeKeyFor(path, projects);
    const project = getState().projects[key];
    setCard({
      cardKey: key,
      name: project?.name ?? path.split("/").filter(Boolean).pop() ?? path,
      folder: project?.repo_path ?? path,
      makeHome: true,
    });
  }, []);
  const editHome = useCallback(() => {
    const home = homeCard();
    if (!home) return;
    const project = getState().projects[home.key];
    const folder = project?.repo_path ?? home.card.homeFolder ?? home.key;
    setCard({ cardKey: home.key, name: project?.name ?? (isFolderKey(home.key) ? "Home" : folder), folder });
  }, []);
  // Quick capture (the global hotkey, the menu bar): from anywhere, so the
  // project is picked in the dialog, or the list goes to Dispatch. With no
  // project to start a task in, Dispatch is all there is.
  const openCapture = useCallback(() => {
    setState({ view: "sessions" });
    if (!Object.keys(getState().projects).length) return openDispatch();
    setDispatch(null);
    setLaunchKey((k) => k + 1);
    setLaunch({ worktree: null, pickProject: true });
  }, [openDispatch]);
  // Start an idea as a task: the new-task box, written in, in its project.
  const startIdea = useCallback((idea: Idea) => {
    setState({ view: "sessions" });
    setLaunchKey((k) => k + 1);
    setLaunch({ worktree: null, pickProject: true, idea });
  }, []);
  const saveIdea = useCallback((text: string, projectId: string | null) => {
    const repo = projectId ? getState().projects[projectId]?.repo_path ?? null : null;
    void addIdea(text, repo, { kind: "capture" }).then((made) => {
      if (!made) return;
      setLaunch(null);
      flash(repo ? `Saved to Ideas, under ${getState().projects[projectId!]?.name}` : "Saved to Ideas, Unsorted");
    });
  }, []);
  const openAgent = useCallback((id: string) => {
    const a = getState().agents[id];
    if (a) selectAgent(a);
  }, []);
  useDesktopShell(openCapture, openAgent);
  const [grid, setGrid] = useGridMode();

  const [addStep, setAddStep] = useState<AddStep | null>(null);
  const openAddProject = useCallback(() => {
    void addProject()
      .then(setAddStep)
      .catch((e) => flash(`Couldn't open the folder picker: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  useEffect(() => {
    void start();
    watchAway();
  }, []);
  useGitPolling();
  usePrPolling();
  useDelight();
  useBudgetWatch();
  useFileDrop();
  useFanOutPrune();
  useUpdateCheck();
  useFolderWatch();
  usePreviewEvents();
  useShelf();
  useQueueRunner();
  useBatchRunner();
  useUsagePolling();
  useActivityPolling();
  useTheme();
  useRunWatch();
  useLimitWatch();
  useServingWatch();
  useAutoFollowUps();
  useProjectSessions();
  useRecentTracking();
  useProjectLogos();
  useMinuteClock();
  useLeaveUsageOnSelect();
  const { view, preview, prefs } = useAppState();
  const previewBeside = !!preview && prefs.previewPlacement === "beside";
  const [sidebarW, setSidebarW] = useColumnWidth(SIDEBAR);
  const [sessionsPref, setSessionsW] = useColumnWidth(SESSIONS);
  // Hiding or showing a column slides it (startSlide) rather than snapping.
  const app = useRef<HTMLDivElement>(null);
  const [hideProjects, setHideProjectsNow] = useHidden("projects");
  const [hideTasks, setHideTasksNow] = useHidden("tasks");
  const setHideProjects = useCallback(
    (v: boolean | ((h: boolean) => boolean)) => {
      startSlide(app.current);
      setHideProjectsNow(v);
    },
    [setHideProjectsNow],
  );
  const setHideTasks = useCallback(
    (v: boolean | ((h: boolean) => boolean)) => {
      startSlide(app.current);
      setHideTasksNow(v);
    },
    [setHideTasksNow],
  );
  const sidebarShown = useMountedFor(hideProjects);
  const tasksShown = useMountedFor(hideTasks);
  const [sidebarCol, sessionsW] = fitColumns(
    hideProjects ? null : sidebarW,
    hideTasks ? null : sessionsPref,
    useWindowWidth(),
  );
  // Buttons to bring hidden columns back, at the terminal's top left — after
  // the window's traffic lights when nothing else is left of it.
  const [palette, setPalette] = useState(false);
  const [textDialog, setTextDialog] = useState<TextDialogSpec | null>(null);
  const paletteCtx = useMemo<PaletteContext>(
    () => ({
      newTask: () => openLaunch(),
      dispatch: () => openDispatch(),
      pickHome: () => void pickHome().catch((e) => flash(`Couldn't open the folder picker: ${e instanceof Error ? e.message : String(e)}`)),
      editHome,
      addProject: openAddProject,
      toggleProjects: () => setHideProjects((h) => !h),
      toggleTasks: () => setHideTasks((h) => !h),
      toggleGrid: () => setGrid((g) => !g),
      prompt: setTextDialog,
    }),
    [openLaunch, openDispatch, pickHome, editHome, openAddProject, setHideProjects, setHideTasks, setGrid],
  );

  const reveal = [
    hideProjects && { label: "Show projects (⌘B)", run: () => setHideProjects(false) },
    hideTasks && { label: "Show tasks (⌥⌘B)", run: () => setHideTasks(false) },
  ].filter(Boolean) as { label: string; run: () => void }[];
  const revealLeft = hideProjects && hideTasks ? 80 : 10;

  // ⌘K opens the palette; ⌘N starts a task; ⇧⌘N opens Dispatch; ⌘I the ideas; ⌘O adds a project; ⌘U shows usage; ⌥⌘U what's running; ⌘, settings; ⌘+/⌘−/⌘0 size the terminal's text; ⌘J cycles through the sessions waiting on you.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === "g") {
        e.preventDefault();
        setGrid((g) => !g);
      } else if (e.code === "KeyN" && e.shiftKey) {
        e.preventDefault();
        openDispatch();
      } else if (e.key === "n") {
        e.preventDefault();
        if (Object.keys(getState().projects).length) openLaunch();
        else flash("Add a project first (⌘O).");
      } else if (e.code === "KeyB") {
        e.preventDefault();
        if (e.altKey) setHideTasks((h) => !h);
        else setHideProjects((h) => !h);
      } else if (e.key === ",") {
        e.preventDefault();
        setState((s) => ({ view: s.view === "settings" ? "sessions" : "settings" }));
      } else if (e.code === "KeyU" && e.altKey) {
        e.preventDefault();
        setState((s) => ({ view: s.view === "activity" ? "sessions" : "activity" }));
      } else if (e.key === "u") {
        e.preventDefault();
        setState((s) => ({ view: s.view === "usage" ? "sessions" : "usage" }));
      } else if (e.key === "i" && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setState((s) => ({ view: s.view === "ideas" ? "sessions" : "ideas" }));
      } else if (e.key === "o") {
        e.preventDefault();
        openAddProject();
      } else if (e.key === "=" || e.key === "+" || e.key === "-" || (e.key === "0" && !e.shiftKey)) {
        // Terminal text size; the rest of the app keeps its size.
        e.preventDefault();
        const prefs = getState().prefs;
        const size = zoomed(prefs, e.key === "0" ? 0 : e.key === "-" ? -1 : 1);
        if (size !== termFont(prefs).size) void savePrefs({ ...prefs, terminalFontSize: size });
        flash(`Terminal text ${size} pt`, 1200);
      } else if (e.key === "j") {
        e.preventDefault();
        const s = getState();
        const waiting = waitingAgents(s);
        if (!waiting.length) return;
        const sel = s.selectedSession;
        const at = sel && "Agent" in sel ? waiting.findIndex((a) => a.id === sel.Agent) : -1;
        selectAgent(waiting[(at + 1) % waiting.length]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openLaunch, openDispatch, openAddProject, setHideProjects, setHideTasks, setGrid]);

  return (
    <div
      ref={app}
      className={`app${view !== "sessions" ? " is-overlay" : ""}`}
      style={
        {
          "--w-sidebar": `${sidebarCol}px`,
          "--w-sessions": `${sessionsW}px`,
          "--w-sidebar-full": `${sidebarW}px`,
          "--w-sessions-full": `${sessionsPref}px`,
          "--reveal-pad": reveal.length ? `${revealLeft + reveal.length * 30}px` : "0px",
        } as React.CSSProperties
      }
    >
      <div className="column column-sidebar" hidden={!sidebarShown}>
        {sidebarShown && (
          <>
            <Sidebar onAddProject={openAddProject} onHide={() => setHideProjects(true)} onDispatch={() => openDispatch()} />
            <Resizer spec={SIDEBAR} width={sidebarCol} onWidth={setSidebarW} />
          </>
        )}
      </div>
      {/* Usage and settings lie over the sessions and terminal rather than
          replacing them, so the terminal keeps its session attached. */}
      <div className="column column-sessions" inert={view !== "sessions"} hidden={!tasksShown}>
        {tasksShown && (
          <>
            <Sessions onNewTask={openLaunch} onHide={() => setHideTasks(true)} />
            <Resizer spec={SESSIONS} width={sessionsW} onWidth={setSessionsW} />
          </>
        )}
      </div>
      <div className={`column column-terminal${previewBeside ? " has-preview-beside" : ""}`} inert={view !== "sessions"}>
        {reveal.length > 0 && (
          <div className="reveal" style={{ left: revealLeft }}>
            {reveal.map((r) => (
              <button key={r.label} className="icon-btn" onClick={r.run} title={r.label} aria-label={r.label}>
                <PanelGlyph />
              </button>
            ))}
          </div>
        )}
        {grid ? <GridView onExit={() => setGrid(false)} /> : <TerminalPane onNewTask={() => openLaunch()} />}
        <PreviewPane />
      </div>
      {view === "usage" && <UsageView />}
      {view === "activity" && <ActivityView />}
      {view === "ideas" && (
        <IdeasView
          onStart={startIdea}
          onDispatch={(ideas) => {
            setState({ view: "sessions" });
            openDispatch(ideas.map((i) => i.text.replace(/\n+/g, " ")).join("\n"));
          }}
        />
      )}
      {view === "settings" && <SettingsView />}
      {view === "review" && <ReviewView key={getState().review ?? ""} />}
      {view === "uncommitted" && <UncommittedView />}
      {view === "compare" && <CompareView />}
      {view === "dispatch" && <DispatchBoard onOpenList={() => openDispatch()} />}
      {launch && (
        <LaunchDialog
          key={launchKey}
          initialWorktree={launch.worktree}
          seed={launch.seed}
          pickProject={launch.pickProject}
          handoff={launch.handoff}
          moving={launch.moving}
          onDispatch={launch.pickProject && !launch.idea ? openDispatch : undefined}
          onSaveIdea={launch.pickProject && !launch.idea ? saveIdea : undefined}
          initial={
            launch.idea
              ? {
                  task: launch.idea.text,
                  projectId: Object.values(getState().projects).find((p) => p.repo_path === launch.idea!.project)?.id ?? null,
                }
              : null
          }
          onStarted={launch.idea ? (agent) => agent && void markStarted([launch.idea!.id], agent) : undefined}
          onClose={() => setLaunch(null)}
        />
      )}
      {card && <CardDialog key={card.cardKey} target={card} onClose={() => setCard(null)} />}
      {dispatch && <DispatchDialog initialText={dispatch.text} onClose={() => setDispatch(null)} />}
      {addStep && <AddProjectDialog step={addStep} onDone={setAddStep} />}
      {palette && <Palette ctx={paletteCtx} onClose={() => setPalette(false)} />}
      {textDialog && <TextDialog d={textDialog} onClose={() => setTextDialog(null)} />}
      <HoverCard />
      <Notice />
      <MomentCard />
      <DaemonGate />
      <Welcome />
    </div>
  );
}

/** Whether the terminal column shows the grid (⌘G), remembered across launches. */
function useGridMode(): [boolean, (v: boolean | ((v: boolean) => boolean)) => void] {
  const [grid, setGrid] = useState(() => {
    try {
      return localStorage.getItem("observatory.grid") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("observatory.grid", grid ? "1" : "0");
    } catch {
      // A convenience: it resets to one terminal next launch.
    }
  }, [grid]);
  return [grid, setGrid];
}

/** Keeps `state.minute` current, for views that expire with the clock. */
function useMinuteClock() {
  useEffect(() => {
    const t = setInterval(() => {
      const minute = Math.floor(Date.now() / 60_000);
      if (minute !== getState().minute) setState({ minute });
    }, 10_000);
    return () => clearInterval(t);
  }, []);
}

/** Picking a project or session anywhere (the sidebar, ⌘J, a new task, a
 *  notification) means you want to see it: leave usage or settings. */
function useLeaveUsageOnSelect() {
  useEffect(() => {
    let { selectedProject, selectedSession } = getState();
    return subscribe(() => {
      const s = getState();
      if (s.selectedProject !== selectedProject || s.selectedSession !== selectedSession) {
        selectedProject = s.selectedProject;
        selectedSession = s.selectedSession;
        if (s.view !== "sessions") setState({ view: "sessions" });
      }
    });
  }, []);
}
