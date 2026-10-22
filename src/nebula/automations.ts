// Background jobs on this Mac (launchd agents), read-only: what each one is,
// when it runs, and whether it's healthy. Pure: automations.rs reads the
// plists, `launchctl print` and the log files; this turns them into rows.
// The app knows kinds of job, never particular ones: which labels show is a
// prefix list in Settings, and names come from ~/.config/observatory/automations.json.

/** A launchd plist as `plutil -convert json` gives it (EnvironmentVariables
 *  stripped on the Rust side). Only the keys read here are typed. */
export interface Plist {
  Label?: string;
  ProgramArguments?: string[];
  Program?: string;
  StartInterval?: number;
  StartCalendarInterval?: CalendarEntry | CalendarEntry[];
  KeepAlive?: boolean | Record<string, unknown>;
  WatchPaths?: string[];
  RunAtLoad?: boolean;
  StandardOutPath?: string;
  StandardErrorPath?: string;
}

/** launchd's calendar keys; a missing key matches any value. Weekday 0 and 7
 *  are both Sunday. */
export interface CalendarEntry {
  Month?: number;
  Day?: number;
  Weekday?: number;
  Hour?: number;
  Minute?: number;
}

/** One plist and what launchd and its logs say about it (automations.rs). */
export interface RawJob {
  label: string;
  plistPath: string;
  plist: Plist;
  /** `launchctl print gui/<uid>/<label>`, top-level lines only, or its
   *  "Could not find service" error. */
  launchctl: string;
  /** The newer mtime of StandardOutPath and StandardErrorPath, ms; null
   *  when neither exists. One sign of a last run; the other is `runs`
   *  going up (`track`). */
  lastWrite: number | null;
  /** The last lines of those logs, oldest first. */
  tail: string[];
}

export interface AutomationsReport {
  jobs: RawJob[];
  /** ~/.config/observatory/automations.json as text, or null when absent. */
  config: string | null;
}

export type Health = "ok" | "failing" | "not loaded" | "stale" | "running";
export type Tone = "green" | "orange" | "red";

export interface Job {
  label: string;
  /** From automations.json, else the label. */
  name: string;
  where: string;
  command: string;
  plistPath: string;
  schedule: string;
  /** ms; "about", since it's read off the logs. */
  lastRun: number | null;
  nextRun: number | null;
  health: Health;
  reason: string;
  pid: number | null;
  tail: string[];
  logs: string[];
}

// ---- launchctl ----

export interface Launchd {
  loaded: boolean;
  pid: number | null;
  /** null when it never exited (or never ran). */
  lastExitCode: number | null;
  runs: number | null;
}

/** The fields of `launchctl print` this view uses. */
export function parseLaunchctl(text: string): Launchd {
  if (/Could not find service/i.test(text) || !/=\s*\{/.test(text)) {
    return { loaded: false, pid: null, lastExitCode: null, runs: null };
  }
  const field = (key: string) => text.match(new RegExp(`^\\s*${key} = (.*)$`, "m"))?.[1].trim();
  const int = (v: string | undefined) => {
    const m = v?.match(/^-?\d+/);
    return m ? Number(m[0]) : null;
  };
  return { loaded: true, pid: int(field("pid")), lastExitCode: int(field("last exit code")), runs: int(field("runs")) };
}

// ---- schedule ----

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const alwaysOn = (p: Plist) => p.KeepAlive === true || (typeof p.KeepAlive === "object" && p.KeepAlive !== null);
const calendar = (p: Plist): CalendarEntry[] =>
  p.StartCalendarInterval == null ? [] : Array.isArray(p.StartCalendarInterval) ? p.StartCalendarInterval : [p.StartCalendarInterval];

/** "2 min", "2 h", "90 s": a duration in its largest whole unit. */
export function span(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s % 86400 === 0) return s === 86400 ? "1 day" : `${s / 86400} days`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  if (s < 60) return `${s} s`;
  // Not a whole unit: round to what reads well.
  return s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`;
}

/** "9:00 am" */
export function clock(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** One calendar entry in words, or null for shapes too unusual to say well. */
function calendarText(e: CalendarEntry): string | null {
  if (e.Minute == null) return null;
  if (e.Hour == null) {
    return e.Month == null && e.Day == null && e.Weekday == null ? `Hourly at :${String(e.Minute).padStart(2, "0")}` : null;
  }
  const at = clock(e.Hour, e.Minute);
  if (e.Month != null) return null;
  if (e.Day != null && e.Weekday == null) return `Monthly on day ${e.Day} at ${at}`;
  if (e.Weekday != null && e.Day == null) return `${WEEKDAYS[e.Weekday % 7]}s at ${at}`;
  if (e.Day == null && e.Weekday == null) return `Daily at ${at}`;
  return null;
}

function calendarScheduleText(entries: CalendarEntry[]): string {
  const daily = entries.every((e) => e.Hour != null && e.Minute != null && e.Day == null && e.Weekday == null && e.Month == null);
  if (daily) {
    const times = [...entries]
      .sort((a, b) => a.Hour! * 60 + a.Minute! - (b.Hour! * 60 + b.Minute!))
      .map((e) => clock(e.Hour!, e.Minute!));
    return `Daily at ${times.length > 1 ? `${times.slice(0, -1).join(", ")} and ${times.at(-1)}` : times[0]}`;
  }
  const parts = entries.map(calendarText);
  if (parts.some((p) => p == null)) return "On a calendar schedule";
  return parts.join(", ");
}

/** When the job runs, in words: "Every 5 min, and when 3 files change". */
export function scheduleText(p: Plist): string {
  if (alwaysOn(p)) return "Always on";
  const parts: string[] = [];
  if (p.StartInterval) parts.push(`every ${span(p.StartInterval * 1000)}`);
  const cal = calendar(p);
  if (cal.length) {
    const t = calendarScheduleText(cal);
    parts.push(t[0].toLowerCase() + t.slice(1));
  }
  const watched = p.WatchPaths?.length ?? 0;
  if (watched) parts.push(`when ${watched === 1 ? "a file changes" : `${watched} files change`}`);
  if (!parts.length) return p.RunAtLoad ? "At login" : "On demand";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
  return text[0].toUpperCase() + text.slice(1);
}

/** How often the job should leave a mark, ms; null when it has no clock
 *  (always on, file-triggered, on demand). */
export function expectedEvery(p: Plist): number | null {
  if (alwaysOn(p)) return null;
  if (p.StartInterval) return p.StartInterval * 1000;
  const cal = calendar(p);
  if (!cal.length) return null;
  const each = cal.map((e) =>
    e.Minute == null ? MIN : e.Hour == null ? HOUR : e.Month != null || e.Day != null ? 31 * DAY : e.Weekday != null ? 7 * DAY : DAY,
  );
  // Several entries of the same kind share the period between them.
  const longest = Math.max(...each);
  return longest / each.filter((x) => x === longest).length;
}

const matches = (want: number | undefined, got: number) => want == null || want === got;

/** The first minute at or after `from` that matches an entry, local time. */
export function nextCalendarRun(entries: CalendarEntry[], from: number): number | null {
  const start = new Date(from);
  start.setSeconds(0, 0);
  if (start.getTime() < from) start.setMinutes(start.getMinutes() + 1);
  for (let d = 0; d < 400; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    let best: number | null = null;
    for (const e of entries) {
      const weekdayOk = e.Weekday == null || e.Weekday % 7 === day.getDay();
      if (!matches(e.Month, day.getMonth() + 1) || !matches(e.Day, day.getDate()) || !weekdayOk) continue;
      for (let h = e.Hour ?? 0; h <= (e.Hour ?? 23); h++) {
        for (let m = e.Minute ?? 0; m <= (e.Minute ?? 59); m++) {
          const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
          if (t >= start.getTime() && (best == null || t < best)) best = t;
        }
      }
    }
    if (best != null) return best;
  }
  return null;
}

/** When it should run next: the last run plus its interval, or the next
 *  calendar match. null when nothing schedules it, or launchd doesn't have it. */
export function nextRun(p: Plist, lastRun: number | null, loaded: boolean, now: number): number | null {
  if (!loaded || alwaysOn(p)) return null;
  const cal = calendar(p);
  const byCal = cal.length ? nextCalendarRun(cal, now) : null;
  const byInterval = p.StartInterval ? (lastRun ?? now) + p.StartInterval * 1000 : null;
  if (byCal != null && byInterval != null) return Math.min(byCal, byInterval);
  return byCal ?? byInterval;
}

// ---- health ----

const ERROR_LINE = /Traceback \(most recent call last\)|\b\w*Error\b|error:/;

/** One line, clipped. */
export function clip(line: string, max = 140): string {
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The last error line among the tail's last few lines, or null. */
export function lastError(tail: string[]): string | null {
  const last = tail.slice(-5);
  if (!last.some((l) => ERROR_LINE.test(l))) return null;
  // Prefer the exception line over the Traceback header above it.
  const lines = [...last].reverse();
  return lines.find((l) => ERROR_LINE.test(l) && !/^Traceback/.test(l.trim())) ?? lines.find((l) => ERROR_LINE.test(l))!;
}

// ---- watching runs ----

/** What the app has seen of a job's `runs` count (launchctl print), kept per
 *  label in localStorage: launchd doesn't record when a job last ran, and a
 *  job that rarely writes its log still counts up. */
export interface Watch {
  /** When the app first read this label, ms. */
  since: number;
  runs: number | null;
  /** When the app last saw `runs` go up, ms. */
  ranAt: number | null;
}
export type Watches = Record<string, Watch>;

/** The watches after a read at `now`: new labels start being watched, a
 *  `runs` count that went up marks a run, labels gone are dropped. */
export function track(prev: Watches, jobs: Pick<RawJob, "label" | "launchctl">[], now: number): Watches {
  const next: Watches = {};
  for (const j of jobs) {
    const runs = parseLaunchctl(j.launchctl).runs;
    const was = prev[j.label];
    if (!was) {
      next[j.label] = { since: now, runs, ranAt: null };
      continue;
    }
    const ran = runs != null && was.runs != null && runs > was.runs;
    next[j.label] = { since: was.since, runs, ranAt: ran ? now : was.ranAt };
  }
  return next;
}

/** The newest sign of a run: the log's mtime, or `runs` going up. */
export function lastRunOf(lastWrite: number | null, watch: Watch | undefined): number | null {
  const ranAt = watch?.ranAt ?? null;
  if (lastWrite == null) return ranAt;
  return ranAt == null ? lastWrite : Math.max(lastWrite, ranAt);
}

export const NOT_SEEN = "Last run not seen yet";

export function health(
  raw: Pick<RawJob, "plist" | "launchctl" | "lastWrite" | "tail">,
  now: number,
  watch?: Watch,
): { health: Health; reason: string } {
  const ld = parseLaunchctl(raw.launchctl);
  if (!ld.loaded) return { health: "not loaded", reason: lastError(raw.tail) ? clip(lastError(raw.tail)!) : "Not loaded in launchd" };
  if (alwaysOn(raw.plist) && ld.pid != null) return { health: "running", reason: `Running, pid ${ld.pid}` };
  if (ld.lastExitCode != null && ld.lastExitCode !== 0) return { health: "failing", reason: `Exited with code ${ld.lastExitCode}` };
  const err = lastError(raw.tail);
  if (err) return { health: "failing", reason: clip(err) };
  if (alwaysOn(raw.plist)) return { health: "stale", reason: "Always on, but not running" };
  const every = expectedEvery(raw.plist);
  const last = lastRunOf(raw.lastWrite, watch);
  if (every != null && (last == null || now - last > 3 * every)) {
    // No sign of a run in 3× its interval. Only stale once the app has
    // watched that long: a quiet job may have run before it started looking.
    const watched = watch ? now - watch.since : 0;
    if (watched < 3 * every) return { health: "ok", reason: NOT_SEEN };
    const gap = last == null ? watched : now - last;
    return {
      health: "stale",
      reason: `No run ${last == null ? "seen " : ""}in ${span(roundTo(gap))} (expected every ${span(every)})`,
    };
  }
  return { health: "ok", reason: ld.lastExitCode === 0 ? "Last run exited cleanly" : "" };
}

/** A gap rounded to a readable unit: minutes under a day, else hours. */
function roundTo(ms: number): number {
  if (ms < HOUR) return Math.round(ms / MIN) * MIN;
  if (ms < 2 * DAY) return Math.round(ms / HOUR) * HOUR;
  return Math.round(ms / DAY) * DAY;
}

const TONE: Record<Health, Tone> = { ok: "green", running: "green", stale: "orange", "not loaded": "orange", failing: "red" };
export const toneOf = (h: Health): Tone => TONE[h];

/** The footer dot: red if anything fails, orange if anything is stale or
 *  not loaded, else green; null with no jobs. */
export function worstHealth(healths: Health[]): Tone | null {
  if (!healths.length) return null;
  const tones = healths.map(toneOf);
  return tones.includes("red") ? "red" : tones.includes("orange") ? "orange" : "green";
}

// ---- which jobs, and their names ----

const VENDORS = /^com\.(apple|google|adobe|valvesoftware)\./i;

/** The prefixes to show when Settings has none: those of the plists not
 *  from Apple, Google, Adobe or Valve ("com.bazil.", "ai.hermes."). */
export function defaultPrefixes(labels: string[]): string[] {
  const out = new Set<string>();
  for (const l of labels) {
    if (VENDORS.test(l)) continue;
    const parts = l.split(".");
    out.add(parts.length > 2 ? `${parts.slice(0, 2).join(".")}.` : l);
  }
  return [...out].sort();
}

/** The labels to list, in order. */
export function shownLabels(labels: string[], prefixes: string[] | undefined): string[] {
  const use = prefixes?.length ? prefixes : defaultPrefixes(labels);
  return labels.filter((l) => use.some((p) => l.startsWith(p))).sort();
}

/** "com.bazil., ai.hermes." to a list, and back. */
export const parsePrefixes = (text: string) =>
  text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export interface ConfigEntry {
  label?: string;
  name?: string;
}

/** automations.json: `{"jobs": [{"label": "...", "name": "..."}]}`. A file
 *  that doesn't parse is reported, not fatal. */
export function parseConfig(text: string | null): { entries: ConfigEntry[]; error: string | null } {
  if (!text?.trim()) return { entries: [], error: null };
  try {
    const raw = JSON.parse(text);
    const list = Array.isArray(raw) ? raw : raw?.jobs;
    if (!Array.isArray(list)) return { entries: [], error: "automations.json has no \"jobs\" list" };
    return { entries: list.filter((e) => e && typeof e === "object"), error: null };
  } catch (e) {
    return { entries: [], error: `automations.json doesn't parse: ${(e as Error).message}` };
  }
}

const ORDER: Record<Health, number> = { failing: 0, "not loaded": 1, stale: 2, running: 3, ok: 4 };

/** The rows: shown labels only, named from the config, worst first. */
export function jobList(
  report: AutomationsReport,
  prefixes: string[] | undefined,
  now: number,
  watches: Watches = {},
): { jobs: Job[]; configError: string | null } {
  const { entries, error } = parseConfig(report.config);
  const names = new Map(entries.filter((e) => e.label && e.name).map((e) => [e.label!, e.name!]));
  const shown = new Set(shownLabels(report.jobs.map((j) => j.label), prefixes));
  const jobs = report.jobs
    .filter((r) => shown.has(r.label))
    .map((r): Job => {
      const ld = parseLaunchctl(r.launchctl);
      const watch = watches[r.label];
      const h = health(r, now, watch);
      const last = lastRunOf(r.lastWrite, watch);
      const args = r.plist.ProgramArguments ?? (r.plist.Program ? [r.plist.Program] : []);
      return {
        label: r.label,
        name: names.get(r.label) ?? r.label,
        where: "This Mac (launchd)",
        command: args.join(" "),
        plistPath: r.plistPath,
        schedule: scheduleText(r.plist),
        lastRun: last,
        nextRun: nextRun(r.plist, last, ld.loaded, now),
        health: h.health,
        reason: h.reason,
        pid: ld.pid,
        tail: r.tail,
        logs: [...new Set([r.plist.StandardOutPath, r.plist.StandardErrorPath].filter((p): p is string => !!p))],
      };
    })
    .sort((a, b) => ORDER[a.health] - ORDER[b.health] || a.name.localeCompare(b.name));
  return { jobs, configError: error };
}

// ---- times, in words ----

/** "about 5 min ago": last runs come off log mtimes, so never exact. */
export function ago(ms: number | null, now: number): string {
  if (ms == null) return "Not seen yet";
  const gap = now - ms;
  if (gap < MIN) return "Just now";
  return `About ${span(roundTo(gap))} ago`;
}

/** "in 3 min", "at 2:30 am", "tomorrow at 9:00 am", "overdue". */
export function until(ms: number | null, now: number): string {
  if (ms == null) return "—";
  const gap = ms - now;
  if (gap < 0) return "Overdue";
  if (gap < MIN) return "Any moment";
  if (gap < HOUR) return `In ${span(roundTo(gap))}`;
  const d = new Date(ms);
  const at = clock(d.getHours(), d.getMinutes());
  const today = new Date(now);
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      DAY,
  );
  if (days === 0) return `At ${at}`;
  if (days === 1) return `Tomorrow at ${at}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${at}`;
}
