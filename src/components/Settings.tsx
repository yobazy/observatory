import { useEffect, useRef, useState } from "react";
import { useOverlayKeys } from "./Overlay";
import { flash, setState, useAppState } from "../nebula/store";
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
import { QUICK_CAPTURE_CHOICES, QUICK_CAPTURE_DEFAULT } from "../nebula/desktop";
import { play } from "../nebula/delight";
import { chosenEditor, useEditors } from "./Editor";
import { getVersion } from "@tauri-apps/api/app";
import { isPreview } from "../nebula/client";
import { DEFAULT_CAP, globalCap } from "../nebula/batch";
import { checkForUpdates, restartToUpdate, useUpdateState } from "../nebula/updates";
import { clearUseLog, useLogPath } from "../nebula/uselog";

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
          {TABS.map((t) => (
            <button
              key={t}
              className={`settings-tab${tab === t ? " is-on" : ""}`}
              aria-current={tab === t ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="settings-pane">
          {!settings ? (
            <p className="usage-empty">Reading settings…</p>
          ) : tab === "Appearance" ? (
            <Appearance settings={settings} save={save} />
          ) : tab === "General" ? (
            <>
              <Rows rows={GENERAL} settings={settings} save={save} />
              <Previews />
              <DispatchSettings />
              <Updates />
              <UsageLog />
            </>
          ) : tab === "Sessions" ? (
            <Rows rows={SESSIONS} settings={settings} save={save} />
          ) : tab === "Agents" ? (
            <>
              <Rows rows={AGENTS_HEAD} settings={settings} save={save} />
              <Handoffs />
              {harnessRows().map((h) => (
                <Group key={h.title} title={h.title}>
                  <Rows rows={h.rows} settings={settings} save={save} />
                </Group>
              ))}
            </>
          ) : tab === "Project" ? (
            <ProjectTab settings={settings} onChange={() => void loadSettings().then(setSettings)} />
          ) : tab === "Shortcuts" ? (
            <Shortcuts />
          ) : (
            <Rows rows={EXPERIMENTAL} settings={settings} save={save} />
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

/** The agent CLI Dispatch routes a list with (router.rs), and how many
 *  sessions it runs at once (batch.ts). */
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
          placeholder="claude -p"
          suggestions={["claude -p", "claude -p --model haiku", "codex exec --skip-git-repo-check"]}
          onCommit={(v) => void savePrefs({ ...prefs, routerCommand: v || undefined })}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <label className="setting-label" htmlFor="set-dispatch-cap">
            Sessions at once
          </label>
          <span className="setting-hint">
            How many dispatched tasks run at the same time. The rest wait and start as these finish. A Shared
            project's own limit applies too.
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
        <div className="setting">
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
            <span className="setting-hint">A pixel cat that plays at the bottom of the sidebar. Click it to say hi.</span>
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
  ["⌘J", "Next session waiting on you"],
  ["⌘U", "Agent usage"],
  ["⌘,", "Settings"],
  ["⌘+ ⌘− ⌘0", "Terminal text: larger, smaller, back to normal"],
  ["⌘B", "Hide or show the projects sidebar"],
  ["⌥⌘B", "Hide or show the tasks column"],
  ["⌘G", "Watch up to four tasks in a grid"],
  ["⇧↵", "Newline in a Claude Code prompt"],
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
