import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOverlayKeys } from "./Overlay";
import { filterSettings, markWords, searchWords } from "../nebula/settingsSearch";
import { flash, getState, setState, useAppState } from "../nebula/store";
import { DEFAULT_STALE_DAYS, DEFAULT_TRIAGE_COMMAND } from "../nebula/triage";
import { DEFAULT_TASK_BUDGET } from "../nebula/stuck";
import { CODEX_REVIEW_COMMAND, DEFAULT_REVIEW_COMMAND } from "../nebula/review";
import { DEFAULT_PARK_DAYS } from "../nebula/park";
import {
  AGENTS_HEAD,
  EXPERIMENTAL,
  GENERAL,
  harnessRows,
  loadSettings,
  projectSetting,
  SESSIONS,
  THEMES,
  TUI_APPEARANCE,
  value,
  writeProjectSetting,
  writeSetting,
  type Row,
  type Settings,
} from "../nebula/settings";
import { ACCENTS, MODES, resolvedMode, savePrefs, themeName } from "../nebula/theme";
import { LINE_HEIGHTS, SIZE_MAX, SIZE_MIN, TERM_FONTS, termFont } from "../nebula/termfont";
import { HANDOFF_INSTRUCTION } from "../nebula/handoff";
import { sortedProjects } from "../nebula/store";
import { openLeadChat } from "../nebula/leadCalls";
import { QUICK_CAPTURE_CHOICES, QUICK_CAPTURE_DEFAULT } from "../nebula/desktop";
import { play } from "../nebula/delight";
import { chosenEditor, useEditors } from "./Editor";
import { getVersion } from "@tauri-apps/api/app";
import { isPreview, pickFolder } from "../nebula/client";
import { DEFAULT_CAP, globalCap } from "../nebula/batch";
import { defaultPrefixes, parsePrefixes } from "../nebula/automations";
import { checkForUpdates, restartToUpdate, useUpdateState } from "../nebula/updates";
import { clearUseLog, useLogPath } from "../nebula/uselog";
import { momentsDir } from "../nebula/moments";
import { leadState } from "../nebula/lead";
import { ASK_LINE_TEMPLATE, countsText, DEFAULT_TOP_MODEL, TOP_LEAD_NAME, TOP_NOTES, type LogCounts } from "../nebula/leadAsk";
import { answerCounts, defaultTopFolder, openAnswersLog, removeTopLead, setTopLeadModel, setTopLeadPet, startTopLead } from "../nebula/leadRunner";
import { petOf } from "../nebula/leadChat";
import { LeadVoiceFields, LevelPicker, ModelPicker, PetPicker, VOICE_HELP } from "./LeadCard";
import { useCards } from "../nebula/cards";
import { levelOf } from "../nebula/leadLevel";
import { levelFlash, setLeadLevel } from "../nebula/leadRunner";

const TABS = ["Appearance", "General", "Sessions", "Agents", "Project", "Shortcuts", "Experimental"] as const;
type Tab = (typeof TABS)[number];

/** nebula's settings, tab for tab as the TUI lays them out, plus the desktop
 *  app's own look. Every change saves as it's made, to the same files the
 *  TUI reads, so the two apps never disagree. */
export function SettingsView() {
  const [tab, setTab] = useState<Tab>("Appearance");
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const tabList = useRef<HTMLElement>(null);
  useOverlayKeys(tabList);

  const [query, setQuery] = useState("");
  const words = searchWords(query);
  const searching = words.length > 0;
  const [found, setFound] = useState<Record<string, number> | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const wordsKey = words.join(" ");

  // Every tab is on screen while searching; hide what doesn't match, and again
  // when a section's own content changes (a lead starting, a version loading).
  useLayoutEffect(() => {
    const root = pane.current;
    if (!root || !searching || !settings) {
      markWords(root ?? document.body, []);
      setFound(null);
      return;
    }
    const run = () => {
      const counts = filterSettings(root, words);
      markWords(root, words);
      setFound((was) => (was && TABS.every((t) => was[t] === counts[t]) ? was : counts));
    };
    run();
    const watch = new MutationObserver(run);
    watch.observe(root, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsKey, settings]);
  useEffect(() => () => markWords(document.body, []), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.altKey && !e.ctrlKey && e.key === "f") {
        e.preventDefault();
        searchBox.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openTab = (t: Tab) => {
    setQuery("");
    setTab(t);
  };

  const save = async (key: string, v: unknown) => {
    setSettings((s) => ({ ...s, [key]: v }));
    if (key === "theme" && typeof v === "string") setState({ theme: v });
    try {
      await writeSetting(key, v);
    } catch (e) {
      flash(`Couldn't save ${key}: ${e instanceof Error ? e.message : String(e)}`);
      setSettings(await loadSettings());
    }
  };

  const tabContent = (t: Tab) =>
    !settings ? null : t === "Appearance" ? (
      <Appearance settings={settings} save={save} />
    ) : t === "General" ? (
      <>
        <Rows rows={GENERAL} settings={settings} save={save} />
        <Previews />
        <ReadView />
        <ClosingThreads />
        <DispatchSettings />
        <LeadsSettings />
        <AutomationsSettings />
        <Updates />
        <UsageLog />
      </>
    ) : t === "Sessions" ? (
      <Rows rows={SESSIONS} settings={settings} save={save} />
    ) : t === "Agents" ? (
      <>
        <Rows rows={AGENTS_HEAD} settings={settings} save={save} />
        <Handoffs />
        {harnessRows().map((h) => (
          <Group key={h.title} title={h.title}>
            <Rows rows={h.rows} settings={settings} save={save} />
          </Group>
        ))}
      </>
    ) : t === "Project" ? (
      <ProjectTab settings={settings} onChange={() => void loadSettings().then(setSettings)} />
    ) : t === "Shortcuts" ? (
      <Shortcuts />
    ) : (
      <Rows rows={EXPERIMENTAL} settings={settings} save={save} />
    );

  return (
    <section className="settings" aria-labelledby="settings-title">
      <header className="usage-head" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 id="settings-title">Settings</h1>
          <p className="usage-sub">
            Shared with the nebula TUI: a change here shows up there, and the other way round.
          </p>
        </div>
        <div className="usage-controls">
          <button className="btn btn-sm" onClick={() => setState({ view: "sessions" })} title="Close (Esc)">
            Done
          </button>
        </div>
      </header>
      <div className="settings-body">
        <nav className="settings-tabs" aria-label="Settings sections" ref={tabList}>
          <input
            ref={searchBox}
            type="search"
            className="setting-input settings-search"
            placeholder="Search settings"
            aria-label="Search settings"
            title="Search every tab (⌘F)"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (query) setQuery("");
              else setState({ view: "sessions" });
            }}
          />
          {TABS.map((t) => {
            const n = searching ? (found?.[t] ?? 0) : null;
            return (
              <button
                key={t}
                className={`settings-tab${!searching && tab === t ? " is-on" : ""}${n === 0 ? " is-empty" : ""}`}
                aria-current={!searching && tab === t ? "page" : undefined}
                onClick={() => openTab(t)}
              >
                {t}
                {n !== null && n > 0 && <span className="settings-tab-count">{n}</span>}
              </button>
            );
          })}
        </nav>
        <div className="settings-pane" ref={pane}>
          {!settings ? (
            <p className="usage-empty">Reading settings…</p>
          ) : searching ? (
            <>
              {TABS.map((t) => (
                <section key={t} className="settings-found" data-settings-tab={t}>
                  <h2 className="settings-found-tab">
                    <button className="link-btn" onClick={() => openTab(t)} title={`Open the ${t} tab`}>
                      {t}
                    </button>
                  </h2>
                  {tabContent(t)}
                </section>
              ))}
              {found && Object.values(found).every((n) => n === 0) && (
                <p className="usage-empty">No settings match “{query.trim()}”.</p>
              )}
            </>
          ) : (
            tabContent(tab)
          )}
        </div>
      </div>
    </section>
  );
}

const PLACEMENTS = [
  { id: "over", label: "Over the terminal" },
  { id: "beside", label: "Beside it" },
] as const;

/** How an agent hands a task to another project: the lines to give it. */
function Handoffs() {
  const [copied, setCopied] = useState(false);
  return (
    <Group title="Handing tasks between projects">
      <div className="setting setting-stack">
        <div className="setting-text">
          <span className="setting-label">Let agents start tasks in other projects</span>
          <span className="setting-hint">
            Put this in your global <code>~/.claude/CLAUDE.md</code> or <code>AGENTS.md</code>. An agent that finds work for
            another project opens a link, and it shows here as a New task for you to check and start.
          </span>
        </div>
        <pre className="handoff-text">{HANDOFF_INSTRUCTION}</pre>
        <div>
          <button
            className="btn btn-sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(HANDOFF_INSTRUCTION)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                })
                .catch(() => flash("Couldn't copy it; select the text instead."))
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </Group>
  );
}

const READER_TEXT = [
  { id: "small", label: "Small" },
  { id: undefined, label: "Medium" },
  { id: "large", label: "Large" },
] as const;

const READER_WIDTH = [
  { id: undefined, label: "Reading width" },
  { id: "wide", label: "Full width" },
] as const;

/** Finished threads that said they're safe to close (autocloseRunner.ts). */
function ClosingThreads() {
  const { prefs } = useAppState();
  return (
    <Group title="Finished threads">
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-auto-close">
            Close safe threads after a day
          </label>
          <span className="setting-hint">
            A thread whose last reply ends ✅ Safe to close is archived once it has sat finished for 24 hours, if
            nothing was sent to it since. Pinned threads, ones flagged to follow up, and the one you have open stay.
          </span>
        </div>
        <Switch
          id="set-auto-close"
          on={prefs.autoCloseSafe !== false}
          onChange={(on) => void savePrefs({ ...prefs, autoCloseSafe: on ? undefined : false })}
        />
      </div>
    </Group>
  );
}

/** How the Read view (Reader.tsx) sets a thread: its text size and width. */
function ReadView() {
  const { prefs } = useAppState();
  return (
    <Group title="Read view">
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label" id="reader-text-label">
            Text size
          </span>
          <span className="setting-hint">How large replies read when a thread is shown as Read.</span>
        </div>
        <div className="segmented segmented-sm" role="radiogroup" aria-labelledby="reader-text-label">
          {READER_TEXT.map((o) => (
            <button
              key={o.label}
              role="radio"
              aria-checked={prefs.readerText === o.id}
              className={prefs.readerText === o.id ? "is-on" : ""}
              onClick={() => void savePrefs({ ...prefs, readerText: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label" id="reader-width-label">
            Width
          </span>
          <span className="setting-hint">A column kept to a comfortable line length, or the whole pane.</span>
        </div>
        <div className="segmented segmented-sm" role="radiogroup" aria-labelledby="reader-width-label">
          {READER_WIDTH.map((o) => (
            <button
              key={o.label}
              role="radio"
              aria-checked={prefs.readerWidth === o.id}
              className={prefs.readerWidth === o.id ? "is-on" : ""}
              onClick={() => void savePrefs({ ...prefs, readerWidth: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label">Notes folder</span>
          <span className="setting-hint">
            {prefs.notesFolder ? (
              <>
                Save as note writes a reply to <code>{prefs.notesFolder}</code>.
              </>
            ) : (
              "Where Save as note on a reply writes it, as Markdown: an Obsidian vault, or any folder."
            )}
          </span>
        </div>
        <div className="setting-inline">
          {prefs.notesFolder && (
            <button className="btn" onClick={() => void savePrefs({ ...prefs, notesFolder: undefined })}>
              Clear
            </button>
          )}
          <button
            className="btn"
            onClick={() =>
              void pickFolder(prefs.notesFolder, "Choose where notes go").then((dir) => {
                if (dir) void savePrefs({ ...getState().prefs, notesFolder: dir });
              })
            }
          >
            {prefs.notesFolder ? "Change…" : "Choose…"}
          </button>
        </div>
      </div>
    </Group>
  );
}

/** Previews of files agents make (Preview.tsx): where they open, and what
 *  opens them. */
function Previews() {
  const { prefs } = useAppState();
  const placement = prefs.previewPlacement ?? "over";
  return (
    <Group title="Previews">
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label" id="preview-place-label">
            Open previews
          </span>
          <span className="setting-hint">
            Clicking a path in a terminal opens the file: an HTML mockup, a Markdown doc, an image.
          </span>
        </div>
        <div className="segmented segmented-sm" role="radiogroup" aria-labelledby="preview-place-label">
          {PLACEMENTS.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={placement === p.id}
              className={placement === p.id ? "is-on" : ""}
              onClick={() => void savePrefs({ ...prefs, previewPlacement: p.id })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-preview-hover">
            Preview on hover
          </label>
          <span className="setting-hint">Resting the pointer on a path shows a small preview of the file.</span>
        </div>
        <Switch
          id="set-preview-hover"
          on={prefs.previewOnHover !== false}
          onChange={(on) => void savePrefs({ ...prefs, previewOnHover: on })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-preview-shown">
            Open files agents show
          </label>
          <span className="setting-hint">
            When an agent runs <code>nebula open</code> on a file, it opens in the preview.
          </span>
        </div>
        <Switch
          id="set-preview-shown"
          on={prefs.previewShownFiles !== false}
          onChange={(on) => void savePrefs({ ...prefs, previewShownFiles: on })}
        />
      </div>
    </Group>
  );
}

/** router.rs's DEFAULT_COMMAND: no saved session, no tools. */
const ROUTER_DEFAULT = 'claude -p --no-session-persistence --tools ""';

/** The agent CLI Dispatch routes a list with (router.rs), the one that tags
 *  threads (tagging.ts), and how many sessions it runs at once (batch.ts). */
function DispatchSettings() {
  const { prefs } = useAppState();
  return (
    <Group title="Dispatch">
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-router">
            Router
          </label>
          <span className="setting-hint">
            The agent CLI that turns a pasted list into a plan, run headless with the prompt on stdin. Codex needs{" "}
            <code>--skip-git-repo-check</code>.
          </span>
        </div>
        <TextSetting
          id="set-router"
          value={prefs.routerCommand ?? ""}
          placeholder={ROUTER_DEFAULT}
          suggestions={[
            ROUTER_DEFAULT,
            'claude -p --model haiku --no-session-persistence --tools ""',
            "codex exec --skip-git-repo-check",
          ]}
          onCommit={(v) => void savePrefs({ ...prefs, routerCommand: v || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-tagger">
            Thread tagging
          </label>
          <span className="setting-hint">
            The agent CLI that tags untagged threads from their project's tags, every 10 minutes, run headless with
            the prompt on stdin. A cheap model is plenty. Empty is off; tags you set by hand are never changed.
          </span>
        </div>
        <TextSetting
          id="set-tagger"
          value={prefs.tagCommand ?? ""}
          placeholder="Off"
          suggestions={["claude -p --model haiku --no-session-persistence", "codex exec --skip-git-repo-check"]}
          onCommit={(v) => void savePrefs({ ...prefs, tagCommand: v || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-triage-on">
            Triage queue
          </label>
          <span className="setting-hint">
            A cheap model reads the end of each open thread that changed since its last read and says in one line what
            it needs from you, ranked at the top of the Dispatch board and walked by ⌘J. Each read is a model call, a
            batch of up to 10 threads at a time; the first one reads every thread that isn't stale. Off, only threads
            waiting on you show.
          </span>
        </div>
        <Switch
          id="set-triage-on"
          on={prefs.triageOn === true}
          onChange={(on) => void savePrefs({ ...prefs, triageOn: on || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-triage">
            Triage command
          </label>
          <span className="setting-hint">
            The agent CLI that triages, run headless with the prompt on stdin. Empty uses Haiku with no tools.
          </span>
        </div>
        <TextSetting
          id="set-triage"
          value={prefs.triageCommand ?? ""}
          placeholder={DEFAULT_TRIAGE_COMMAND}
          suggestions={[DEFAULT_TRIAGE_COMMAND, "codex exec --skip-git-repo-check"]}
          onCommit={(v) => void savePrefs({ ...prefs, triageCommand: v || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-triage-stale">
            Stale after
          </label>
          <span className="setting-hint">
            A thread unchanged this long is labelled stale without a model call, and folded away at the end of the queue.
          </span>
        </div>
        <select
          id="set-triage-stale"
          className="setting-input"
          value={String(prefs.triageStaleDays ?? DEFAULT_STALE_DAYS)}
          onChange={(e) => {
            const days = Number(e.target.value);
            void savePrefs({ ...prefs, triageStaleDays: days === DEFAULT_STALE_DAYS ? undefined : days });
          }}
        >
          {[1, 2, 3, 5, 7, 14, 30].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "day" : "days"}
              {n === DEFAULT_STALE_DAYS ? " (default)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-task-budget">
            Task budget
          </label>
          <span className="setting-hint">
            What one thread may spend since your last message to it (a Dispatch task: since it started), in the dollars
            the usage view shows. At 85% the queue flags it stuck and a banner says so, then again at 100%. A Dispatch
            task can set its own on the board. Nothing is stopped on its own.
          </span>
        </div>
        <span className="budget-input">
          $
          <input
            id="set-task-budget"
            key={prefs.taskBudget ?? "default"}
            className="setting-input"
            type="number"
            min={1}
            step={1}
            inputMode="decimal"
            defaultValue={prefs.taskBudget ?? DEFAULT_TASK_BUDGET}
            onBlur={(e) => {
              const v = Number(e.target.value);
              const next = v > 0 && v !== DEFAULT_TASK_BUDGET ? v : undefined;
              if (next !== prefs.taskBudget) void savePrefs({ ...prefs, taskBudget: next });
              else e.target.value = String(prefs.taskBudget ?? DEFAULT_TASK_BUDGET);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </span>
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-review-on">
            Check before done
          </label>
          <span className="setting-hint">
            When a thread's turn ends with changes in its checkout, the app runs the project card's checks there and a
            read-only reviewer checks the work against the task. A pass shows it as done and checked; a fail goes back to
            the thread once. Each review is a model call. Only turns that end while the app is open are checked.
          </span>
        </div>
        <Switch
          id="set-review-on"
          on={prefs.reviewOn === true}
          onChange={(on) => void savePrefs({ ...prefs, reviewOn: on || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-review">
            Review command
          </label>
          <span className="setting-hint">
            The reviewer CLI, run headless in the checkout with the prompt on stdin. Keep it read-only by its own flags;
            the app also throws away any verdict from a reviewer that changed files. Empty uses Claude in plan mode.
          </span>
        </div>
        <TextSetting
          id="set-review"
          value={prefs.reviewCommand ?? ""}
          placeholder={DEFAULT_REVIEW_COMMAND}
          suggestions={[DEFAULT_REVIEW_COMMAND, CODEX_REVIEW_COMMAND]}
          onCommit={(v) => void savePrefs({ ...prefs, reviewCommand: v || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-park-on">
            Park idle threads in Ideas
          </label>
          <span className="setting-hint">
            A thread that finished and sat unchanged past the time below becomes an idea in its project, with a brief
            of what was asked and where it got to, and its session is archived. Never one that's running, waiting on
            you, dragged into place, or in a Dispatch batch still going. Resume in Ideas brings a thread back as it
            was; Undo in the sidebar brings back a whole park. The first time, you confirm the list. No model call.
          </span>
        </div>
        <Switch
          id="set-park-on"
          on={prefs.parkOn === true}
          onChange={(on) => void savePrefs({ ...prefs, parkOn: on || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-park-days">
            Park after
          </label>
          <span className="setting-hint">How long a thread sits unchanged before it's parked. Separate from Stale after.</span>
        </div>
        <select
          id="set-park-days"
          className="setting-input"
          value={String(prefs.parkDays ?? DEFAULT_PARK_DAYS)}
          onChange={(e) => {
            const days = Number(e.target.value);
            void savePrefs({ ...prefs, parkDays: days === DEFAULT_PARK_DAYS ? undefined : days });
          }}
        >
          {[1, 2, 3, 5, 7, 14, 30].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "day" : "days"}
              {n === DEFAULT_PARK_DAYS ? " (default)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-suggest-on">
            Next-prompt suggestions
          </label>
          <span className="setting-hint">
            A few things you might send next, under a reply that finished while you watched or that you haven't seen
            yet. Each one is a model call.
          </span>
        </div>
        <Switch
          id="set-suggest-on"
          on={prefs.suggestNext === true}
          onChange={(on) => void savePrefs({ ...prefs, suggestNext: on || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-suggest">
            Suggestions command
          </label>
          <span className="setting-hint">
            The agent CLI the suggestions come from, run headless with the prompt on stdin. Empty uses Haiku.
          </span>
        </div>
        <TextSetting
          id="set-suggest"
          value={prefs.suggestCommand ?? ""}
          placeholder="claude -p --model haiku --no-session-persistence"
          suggestions={["claude -p --model haiku --no-session-persistence", "codex exec --skip-git-repo-check"]}
          onCommit={(v) => void savePrefs({ ...prefs, suggestCommand: v || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-dispatch-cap">
            Sessions at once
          </label>
          <span className="setting-hint">
            How many sessions work at the same time, however they were started. Past it, dispatched tasks wait and
            start as others finish, and New task offers to wait too. A Shared project's own limit applies as well.
          </span>
        </div>
        <select
          id="set-dispatch-cap"
          className="setting-input"
          value={String(globalCap(prefs.dispatchCap))}
          onChange={(e) => void savePrefs({ ...prefs, dispatchCap: Number(e.target.value) })}
        >
          {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
            <option key={n} value={n}>
              {n}
              {n === DEFAULT_CAP ? " (default)" : ""}
            </option>
          ))}
        </select>
      </div>
    </Group>
  );
}

/** Each project's lead and its level: what the app lets it do on its own. */
function ProjectLeadLevels() {
  const cards = useCards();
  const { projects } = useAppState();
  const rows = Object.entries(cards)
    .flatMap(([id, c]) => (c.lead && projects[id] ? [{ id, name: projects[id].name, lead: c.lead }] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="setting setting-stack">
      <div className="setting-text">
        <span className="setting-label">Project leads</span>
        <span className="setting-hint">
          What each project's lead may do on its own. Observatory refuses anything above its level, and keeps every lead to its own
          project's folder, threads and worktrees.
        </span>
      </div>
      {rows.length === 0 ? (
        <span className="setting-hint">No project has a lead. Start one from a project's card.</span>
      ) : (
        <ul className="lead-levels" aria-label="Project leads' levels">
          {rows.map((r) => (
            <li key={r.id}>
              <label htmlFor={`set-lead-level-${r.id}`} className="lead-levels-name">
                {r.name}
              </label>
              <LevelPicker
                id={`set-lead-level-${r.id}`}
                level={levelOf(r.lead)}
                onPick={(level) => {
                  setLeadLevel(r.id, r.lead, level);
                  flash(levelFlash(r.name, level));
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The top lead over every project, today's answers from the leads, and
 *  the ask line for a CLAUDE.md (leadAsk.ts). */
function LeadsSettings() {
  const { prefs, agents } = useAppState();
  const top = prefs.topLead;
  const state = leadState(top, agents);
  const [folder, setFolder] = useState(top?.path ?? "");
  const [model, setModel] = useState(top?.model || DEFAULT_TOP_MODEL);
  const [notes, setNotes] = useState(top?.notes || TOP_NOTES);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<LogCounts | null>(null);
  const [copied, setCopied] = useState(false);
  const agent = top ? agents[top.agentId] : undefined;
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  useEffect(() => {
    if (!folder) void defaultTopFolder().then((f) => setFolder((now) => now || f)).catch(() => {});
    let live = true;
    const load = () => void answerCounts().then((c) => live && setCounts(c)).catch(() => live && setCounts(null));
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    if (!folder.trim()) return flash("Pick the folder the top lead runs in.");
    setBusy(true);
    startTopLead({ path: folder.trim(), model, notes: notes.trim() || TOP_NOTES })
      .then(() => flash(`Started the top lead as ${TOP_LEAD_NAME}`))
      .catch((e) => flash(`Couldn't start the top lead: ${errText(e)}`, 6000))
      .finally(() => setBusy(false));
  };
  const pickModel = (next: string) => {
    setModel(next);
    if (!top || !next.trim() || next.trim() === top.model) return;
    setTopLeadModel(top, next)
      .then(() => flash(state === "running" ? `Restarted the top lead on ${next.trim()}` : `The top lead will use ${next.trim()}`))
      .catch((e) => flash(`Couldn't switch the top lead's model: ${errText(e)}`));
  };

  return (
    <Group title="Leads">
      <div className="setting setting-stack">
        <div className="setting-text">
          <span className="setting-label">
            Top lead{" "}
            {state !== "none" && (
              <span className={`lead-mark is-small${state === "stopped" ? " is-stopped" : ""}`}>
                {state === "running" ? "Running" : "Top lead stopped"}
              </span>
            )}
          </span>
          <span className="setting-hint">
            {state === "stopped"
              ? "Its thread was archived or deleted, so tasks only ask their project's lead. Restart starts a fresh one from its notes."
              : `One thread over every project, named ${TOP_LEAD_NAME}. Tasks ask it about other projects; it answers facts and past decisions with a source from its notes, the projects' CLAUDE.md and README, memory and your vault, passes a question about one project to that project's lead, and sends anything else back to you. It never acts on a question. Off until you start it; it costs nothing till then.`}
          </span>
        </div>
        <div className="setting-inline top-lead-fields">
          <label className="card-cap">
            folder
            <input
              className="setting-input"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              disabled={state === "running"}
              spellCheck={false}
              aria-label="The folder the top lead runs in"
            />
          </label>
          {state !== "running" && (
            <button
              className="btn btn-sm"
              onClick={() => void pickFolder(folder || undefined, "Choose where the top lead runs").then((d) => d && setFolder(d))}
            >
              Choose…
            </button>
          )}
        </div>
        <div className="setting-inline top-lead-fields">
          <ModelPicker model={model} label="The top lead's model" onPick={pickModel} />
          <label className="card-cap">
            notes
            <input
              className="setting-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={state === "running"}
              spellCheck={false}
              aria-label="The top lead's notes file"
            />
          </label>
        </div>
        {top && (
          <div className="setting-inline top-lead-fields">
            <PetPicker
              pet={petOf(top, null)}
              label="What the top lead looks like"
              onPick={(pet) => void setTopLeadPet(top, pet).then(() => flash(`The top lead is a ${pet.kind} now`))}
            />
          </div>
        )}
        <div className="setting-inline">
          {state === "running" && agent && (
            <button
              className="link-btn"
              onClick={() => openLeadChat(agent.id)}
            >
              Open its chat
            </button>
          )}
          <button
            className="btn"
            disabled={busy}
            onClick={start}
            title={state === "running" ? "Archive its thread and start a fresh one from its notes" : undefined}
          >
            {busy ? "Starting…" : state === "none" ? "Start the top lead" : "Restart"}
          </button>
          {state !== "none" && (
            <button
              className="link-btn hint"
              onClick={() =>
                void removeTopLead().then(
                  (how) => flash(how === "archived" ? "The top lead is off, and its thread is archived" : "The top lead is off"),
                  (e) => flash(`Couldn't archive the top lead's thread, so it's still on: ${errText(e)}`),
                )
              }
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <ProjectLeadLevels />
      <ProjectLeadsVoice />
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label">Answers</span>
          <span className="setting-hint">
            {counts ? `${countsText(counts)}.` : "Couldn't read the answers log."} Every lead writes one line per answer to{" "}
            <code>answers.log</code> beside its notes.
          </span>
        </div>
        <button
          className="btn"
          onClick={() => void openAnswersLog().catch((e) => flash(`Couldn't open the log: ${errText(e)}`))}
        >
          Open the log
        </button>
      </div>
      <div className="setting setting-stack">
        <div className="setting-text">
          <span className="setting-label">Ask a lead first</span>
          <span className="setting-hint">
            Dispatch's tasks and Start task get this line when a lead is running. For threads you start yourself, put it in a
            project's <code>CLAUDE.md</code>, with the project's name.
          </span>
        </div>
        <pre className="handoff-text">{ASK_LINE_TEMPLATE}</pre>
        <div>
          <button
            className="btn btn-sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(ASK_LINE_TEMPLATE)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                })
                .catch(() => flash("Couldn't copy it; select the text instead."))
            }
          >
            {copied ? "Copied" : "Copy the ask line"}
          </button>
        </div>
      </div>
    </Group>
  );
}

/** Each project lead's personality and instructions (also in its chat's
 *  header and its project's card). */
function ProjectLeadsVoice() {
  const cards = useCards();
  const { projects } = useAppState();
  const leads = Object.entries(cards)
    .flatMap(([id, c]) => (c.lead && projects[id] ? [{ id, name: projects[id].name, lead: c.lead }] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="setting setting-stack">
      <div className="setting-text">
        <span className="setting-label">Project leads' personality and instructions</span>
        <span className="setting-hint">
          {VOICE_HELP}
          {leads.length ? "" : " Start a lead from a project's card to set them."}
        </span>
      </div>
      {leads.map((l) => (
        <div key={l.id} className="lead-voice-project">
          <span className="lead-voice-name">{l.name}</span>
          <LeadVoiceFields projectId={l.id} projectName={l.name} lead={l.lead} help={false} />
        </div>
      ))}
    </div>
  );
}

/** Which launchd agents the Automations view lists, by label prefix. */
function AutomationsSettings() {
  const { prefs, automations } = useAppState();
  const defaults = defaultPrefixes(automations?.jobs.map((j) => j.label) ?? []);
  return (
    <Group title="Automations">
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-automation-labels">
            Jobs to list
          </label>
          <span className="setting-hint">
            Label prefixes of the launchd agents the Automations view shows, separated by commas. Empty lists every
            agent not from Apple, Google, Adobe or Valve. Names come from{" "}
            <code>~/.config/observatory/automations.json</code>, as{" "}
            <code>{'{"jobs": [{"label": "…", "name": "…"}]}'}</code>.
          </span>
        </div>
        <TextSetting
          id="set-automation-labels"
          value={(prefs.automationLabels ?? []).join(", ")}
          placeholder={defaults.join(", ") || "com.example."}
          onCommit={(v) => {
            const list = parsePrefixes(v);
            void savePrefs({ ...prefs, automationLabels: list.length ? list : undefined });
          }}
        />
      </div>
    </Group>
  );
}

function Updates() {
  const update = useUpdateState();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isPreview()) void getVersion().then(setVersion).catch(() => {});
  }, []);
  const status =
    update.kind === "checking"
      ? "Checking…"
      : update.kind === "downloading"
        ? `Downloading ${update.version}${update.percent != null ? ` (${update.percent}%)` : ""}…`
        : update.kind === "ready"
          ? `${update.version} is installed. Restart to use it; your agents keep running.`
          : update.kind === "current"
            ? "You're on the latest version."
            : update.kind === "error"
              ? `The last check failed: ${update.message}`
              : "Checked soon after launch and every few hours.";
  return (
    <Group title="Updates">
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label">Observatory {version ?? ""}</span>
          <span className="setting-hint">{status}</span>
          {(update.kind === "ready" || update.kind === "downloading") && update.notes.length > 0 && (
            <ul className="update-notes update-notes-settings">
              {update.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        {update.kind === "ready" ? (
          <button className="btn btn-primary" onClick={() => void restartToUpdate()}>
            Restart
          </button>
        ) : (
          <button
            className="btn"
            disabled={update.kind === "checking" || update.kind === "downloading"}
            onClick={() => void checkForUpdates(true)}
          >
            Check for updates
          </button>
        )}
      </div>
    </Group>
  );
}

/** The usage log (uselog.ts): on or off, and the file it keeps. */
function UsageLog() {
  const { prefs } = useAppState();
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const reveal = async () => {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(await useLogPath());
    } catch (e) {
      flash(`Couldn't show the log: ${errText(e)}`);
    }
  };
  const showMoments = async () => {
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(await momentsDir());
    } catch (e) {
      flash(`Couldn't show moments: ${errText(e)}`);
    }
  };
  const clear = () =>
    void clearUseLog()
      .then(() => flash("Usage log deleted"))
      .catch((e) => flash(`Couldn't delete the log: ${errText(e)}`));
  return (
    <Group title="Usage log">
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-use-log">
            Keep a usage log
          </label>
          <span className="setting-hint">
            Notes what you click, the views and dialogs you open and for how long, the shortcuts you press and the
            errors you hit, in a file on this Mac. Never what you type. Nothing is sent anywhere.
          </span>
        </div>
        <Switch id="set-use-log" on={prefs.keepUseLog === true} onChange={(on) => void savePrefs({ ...prefs, keepUseLog: on })} />
      </div>
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label">The log</span>
          <span className="setting-hint">One JSON line per event, in usage-log.jsonl.</span>
        </div>
        <div className="setting-inline">
          <button className="btn" onClick={() => void reveal()}>
            Show in Finder
          </button>
          <button className="btn" onClick={clear}>
            Delete
          </button>
        </div>
      </div>
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label">Marked moments</span>
          <span className="setting-hint">
            <kbd>⇧⌘M</kbd> saves the last minute of this log, what’s on screen and a screenshot to a folder,
            and copies its path. Kept in memory until you press it, whether or not the log is on.
          </span>
        </div>
        <button className="btn" onClick={() => void showMoments()}>
          Show in Finder
        </button>
      </div>
    </Group>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h2>
        {title}
        {note && <span className="settings-note">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

/** What each face is shown setting: a Claude Code turn in miniature, with
 *  the characters that tell faces apart (0O 1lI {} =>). */
const FONT_SAMPLE = `> why are synonyms ignored?

● Read(src/search/analyzer.ts)
  ⎿  Read 168 lines
● Rebuild drops the filter:
  if (opts.rebuild) f = [];
  0O 1lI {} => !== +12 −3`;

/** The terminal's type, picked by seeing each face set the same text. */
function TerminalType() {
  const { prefs } = useAppState();
  const font = termFont(prefs);
  const face = TERM_FONTS.find((f) => f.family === font.family) ?? TERM_FONTS[0];
  return (
    <Group title="Terminal text">
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-term-size">
            Size
          </label>
          <span className="setting-hint">⌘+ and ⌘− change it from anywhere; ⌘0 puts it back.</span>
        </div>
        <div className="stepper">
          <button
            className="btn btn-sm"
            aria-label="Smaller"
            disabled={font.size <= SIZE_MIN}
            onClick={() => void savePrefs({ ...prefs, terminalFontSize: font.size - 1 })}
          >
            −
          </button>
          <output id="set-term-size" className="stepper-value" aria-live="polite">
            {font.size} pt
          </output>
          <button
            className="btn btn-sm"
            aria-label="Larger"
            disabled={font.size >= SIZE_MAX}
            onClick={() => void savePrefs({ ...prefs, terminalFontSize: font.size + 1 })}
          >
            +
          </button>
        </div>
      </div>
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label" id="term-line-label">
            Line spacing
          </span>
        </div>
        <div className="segmented segmented-sm" role="radiogroup" aria-labelledby="term-line-label">
          {LINE_HEIGHTS.map((l) => (
            <button
              key={l.value}
              role="radio"
              aria-checked={font.lineHeight === l.value}
              className={font.lineHeight === l.value ? "is-on" : ""}
              onClick={() => void savePrefs({ ...prefs, terminalLineHeight: l.value })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting setting-stack">
        <div className="setting-text">
          <span className="setting-label" id="term-font-label">
            Font
          </span>
          <span className="setting-hint">Each is set in your size and spacing. Picking one changes the terminal now.</span>
        </div>
        <div className="font-picks" role="radiogroup" aria-labelledby="term-font-label">
          {TERM_FONTS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={face.id === f.id}
              className={`font-pick${face.id === f.id ? " is-on" : ""}`}
              onClick={() => void savePrefs({ ...prefs, terminalFont: f.id })}
            >
              <span className="font-pick-head">
                <span className="font-pick-name">{f.label}</span>
                <span className="font-pick-note">{f.note}</span>
              </span>
              <span
                className="font-pick-sample"
                style={{ fontFamily: f.family, fontSize: font.size, lineHeight: font.lineHeight }}
                aria-hidden
              >
                {FONT_SAMPLE}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Group>
  );
}

function Appearance({ settings, save }: { settings: Settings; save: (k: string, v: unknown) => void }) {
  const { prefs } = useAppState();
  const theme = themeName(settings.theme);
  const shade = resolvedMode(prefs.mode) === "light" ? "light" : "dark";
  return (
    <>
      <Group title="Desktop app">
        <div className="setting" data-search="dark light mode">
          <div className="setting-text">
            <span className="setting-label" id="mode-label">
              Appearance
            </span>
            <span className="setting-hint">System follows macOS. Black is pure black, for OLED screens.</span>
          </div>
          <div className="segmented segmented-sm" role="radiogroup" aria-labelledby="mode-label">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={(prefs.mode ?? "system") === m.id}
                className={(prefs.mode ?? "system") === m.id ? "is-on" : ""}
                onClick={() => void savePrefs({ ...prefs, mode: m.id })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <div className="setting-text">
            <label className="setting-label" htmlFor="set-pet">
              Sidebar cat
            </label>
            <span className="setting-hint">A pixel cat that plays at the bottom of the sidebar, and one that keeps a working thread company in the Read view. Click either to say hi.</span>
          </div>
          <Switch id="set-pet" on={prefs.pet !== false} onChange={(on) => void savePrefs({ ...prefs, pet: on })} />
        </div>
        <div className="setting">
          <div className="setting-text">
            <label className="setting-label" htmlFor="set-menubar">
              Keep running in the menu bar
            </label>
            <span className="setting-hint">
              Closing the window hides it. The menu bar icon counts tasks waiting on you; ⌘Q quits.
            </span>
          </div>
          <Switch
            id="set-menubar"
            on={prefs.keepInMenuBar !== false}
            onChange={(on) => void savePrefs({ ...prefs, keepInMenuBar: on })}
          />
        </div>
        <div className="setting">
          <div className="setting-text">
            <label className="setting-label" htmlFor="set-capture">
              Quick capture hotkey
            </label>
            <span className="setting-hint">Starts a new task from any app: pick the project, type, done.</span>
          </div>
          <select
            id="set-capture"
            className="setting-input"
            value={prefs.quickCapture ?? QUICK_CAPTURE_DEFAULT}
            onChange={(e) => void savePrefs({ ...prefs, quickCapture: e.target.value })}
          >
            {QUICK_CAPTURE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="setting setting-stack">
          <div className="setting-text">
            <span className="setting-label" id="accent-label">
              Color theme
            </span>
            <span className="setting-hint">The accent color, shared with the TUI's theme.</span>
          </div>
          <div className="swatches" role="radiogroup" aria-labelledby="accent-label">
            {THEMES.map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                className={`swatch${theme === t ? " is-on" : ""}`}
                onClick={() => save("theme", t)}
              >
                <span className="swatch-dot" style={{ background: ACCENTS[t][shade] }} aria-hidden />
                {t}
              </button>
            ))}
          </div>
        </div>
      </Group>
      <TerminalType />
      <SoundsAndEditor />
      <Group title="Terminal app" note="only changes how the TUI looks">
        <Rows rows={TUI_APPEARANCE} settings={settings} save={save} />
      </Group>
    </>
  );
}

/** The desktop app's sounds, quiet hours and editor. */
function SoundsAndEditor() {
  const { prefs } = useAppState();
  const editors = useEditors();
  const editor = chosenEditor(editors);
  return (
    <Group title="Sounds and focus">
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-sounds">
            Sounds
          </label>
          <span className="setting-hint">
            A soft chime when a turn ends or a task starts waiting on you, unless you're looking at it. The TUI plays its
            own.
          </span>
        </div>
        <div className="setting-inline">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.soundVolume ?? 0.5}
            disabled={prefs.sounds === false}
            onChange={(e) => void savePrefs({ ...prefs, soundVolume: Number(e.target.value) })}
            onMouseUp={() => play("done", true)}
            onKeyUp={() => play("done", true)}
            aria-label="Volume"
            className="volume"
          />
          <Switch id="set-sounds" on={prefs.sounds !== false} onChange={(on) => void savePrefs({ ...prefs, sounds: on })} />
        </div>
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-sand-sound">
            Sand when a thread finishes
          </label>
          <span className="setting-hint">
            A soft hiss of settling sand instead of the chime, only while the app is in the background.{" "}
            <button className="link-btn" onClick={() => play("sand", true)} disabled={prefs.sounds === false}>
              Play it
            </button>
          </span>
        </div>
        <Switch
          id="set-sand-sound"
          on={prefs.sandSound === true}
          onChange={(on) => void savePrefs({ ...prefs, sandSound: on })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <span className="setting-label" id="quiet-label">
            Quiet hours
          </span>
          <span className="setting-hint">
            No chimes or banners between these times. The badge and the menu bar still count what's waiting.
          </span>
        </div>
        <div className="setting-inline" role="group" aria-labelledby="quiet-label">
          <input
            type="time"
            className="setting-input time-input"
            value={prefs.quietFrom ?? ""}
            onChange={(e) => void savePrefs({ ...prefs, quietFrom: e.target.value || undefined })}
            aria-label="From"
          />
          <span className="git-muted">to</span>
          <input
            type="time"
            className="setting-input time-input"
            value={prefs.quietTo ?? ""}
            onChange={(e) => void savePrefs({ ...prefs, quietTo: e.target.value || undefined })}
            aria-label="To"
          />
        </div>
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-editor">
            Code editor
          </label>
          <span className="setting-hint">
            What a branch's {"</>"} button opens its checkout in.{" "}
            {editors.length === 0 && "No editor this app knows was found in Applications."}
          </span>
        </div>
        <select
          id="set-editor"
          className="setting-input"
          value={editor ?? ""}
          disabled={!editors.length}
          onChange={(e) => void savePrefs({ ...prefs, editor: e.target.value })}
        >
          {editors.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>
    </Group>
  );
}

function Rows({ rows, settings, save }: { rows: Row[]; settings: Settings; save: (k: string, v: unknown) => void }) {
  return (
    <div className="settings-rows">
      {rows.map((row) => (
        <SettingRow key={row.key} row={row} v={value(settings, row)} save={save} />
      ))}
    </div>
  );
}

function SettingRow({ row, v, save }: { row: Row; v: unknown; save: (k: string, v: unknown) => void }) {
  const id = `set-${row.key}`;
  return (
    <div className="setting">
      <div className="setting-text">
        <label className="setting-label" htmlFor={id}>
          {row.label}
          {row.tui && <span className="setting-tag">TUI</span>}
        </label>
        <span className="setting-hint">{row.hint}</span>
      </div>
      {row.type === "bool" ? (
        <Switch id={id} on={row.invert ? !v : !!v} onChange={(on) => save(row.key, row.invert ? !on : on)} />
      ) : row.type === "choice" ? (
        <select id={id} className="setting-input" value={String(v)} onChange={(e) => save(row.key, e.target.value)}>
          {/* A value set by hand, or by a newer TUI, still shows as itself. */}
          {!row.options.includes(String(v)) && <option value={String(v)}>{String(v)}</option>}
          {row.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <TextSetting
          id={id}
          value={String(v ?? "")}
          placeholder={row.placeholder}
          suggestions={row.suggestions}
          // Cleared means the default: for model and effort that's the TUI's
          // "default", not an empty string it would treat as a name.
          onCommit={(t) => save(row.key, t === "" && row.def === "default" ? "default" : t)}
        />
      )}
    </div>
  );
}

export function Switch({ id, on, onChange }: { id: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={on} className={`switch${on ? " is-on" : ""}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" aria-hidden />
    </button>
  );
}

/** A typed value, saved when you press Enter or leave the field. */
function TextSetting({
  id,
  value: initial,
  placeholder,
  suggestions,
  onCommit,
}: {
  id: string;
  value: string;
  placeholder?: string;
  suggestions?: string[];
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  const commit = () => text !== initial && onCommit(text.trim());
  return (
    <>
      <input
        id={id}
        className="setting-input"
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        list={suggestions ? `${id}-list` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(initial);
            e.currentTarget.blur();
          }
        }}
      />
      {suggestions && (
        <datalist id={`${id}-list`}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}

/** Per-project commands, kept under the project's entry in `projects`. */
function ProjectTab({ settings, onChange }: { settings: Settings; onChange: () => void }) {
  const state = useAppState();
  const projects = sortedProjects(state);
  const [pid, setPid] = useState(state.selectedProject ?? projects[0]?.id ?? "");
  const project = state.projects[pid];
  if (!project) return <p className="usage-empty">Add a project first.</p>;
  const repo = project.repo_path;
  const commit = async (field: string, v: string) => {
    try {
      await writeProjectSetting(repo, field, v);
      onChange();
    } catch (e) {
      flash(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-project">
            Project
          </label>
        </div>
        <select id="set-project" className="setting-input" value={pid} onChange={(e) => setPid(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-rows">
        <div className="setting">
          <div className="setting-text">
            <label className="setting-label" htmlFor="set-run">
              Run command
            </label>
            <span className="setting-hint">
              What Start runs in a worktree, e.g. npm run dev. Empty uses the checkout's .nebula.json "run".
            </span>
          </div>
          <TextSetting key={`run-${pid}`} id="set-run" value={projectSetting(settings, repo, "run_command")} placeholder=".nebula.json" onCommit={(v) => commit("run_command", v)} />
        </div>
        <div className="setting">
          <div className="setting-text">
            <label className="setting-label" htmlFor="set-open">
              Open command
              <span className="setting-tag">TUI</span>
            </label>
            <span className="setting-hint">
              What the TUI's ⇧O runs to open a worktree, e.g. open http://localhost:3000. Empty uses the checkout's .nebula.json "open".
            </span>
          </div>
          <TextSetting key={`open-${pid}`} id="set-open" value={projectSetting(settings, repo, "open_command")} placeholder=".nebula.json" onCommit={(v) => commit("open_command", v)} />
        </div>
      </div>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘K", "Command palette: jump to anything, run any action"],
  ["⌘N", "New task in the selected project"],
  ["⌘O", "Add a project"],
  ["⌘P", "Filter projects"],
  ["⌘1 – ⌘9", "Jump to a project"],
  ["⌘J", "Next in the triage queue, or the next session waiting on you"],
  ["⌘I", "Write an idea down for later"],
  ["⇧⌘I", "Ideas: everything written down to start later"],
  ["⌘U", "Agent usage"],
  ["⌘,", "Settings"],
  ["⌘+ ⌘− ⌘0", "Terminal text: larger, smaller, back to normal"],
  ["⌘B", "Hide or show the projects sidebar"],
  ["⌥⌘B", "Hide or show the tasks column"],
  ["⌘G", "Watch up to four tasks in a grid"],
  ["⇧↵", "Newline in a Claude Code prompt"],
  ["⇧⌘M", "Mark this moment: save what the app was doing, and copy where"],
];

function Shortcuts() {
  return (
    <Group title="Desktop app" note="the TUI's hotkeys are edited in the TUI">
      <dl className="shortcuts">
        {SHORTCUTS.map(([k, what]) => (
          <div key={k} className="shortcut">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Group>
  );
}
