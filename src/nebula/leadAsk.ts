// Leads answer questions (S26): a task's thread asks its project's lead, or
// the top lead over every project, before it asks you, with nebula's own
// `nebula ask <session> "<question>"`. Leads answer facts and past decisions
// only, each with its source; anything else comes back as one
// `ASK_USER: <question>` line and the thread asks you as it does today.
// This file is the pure part: the line a launched task's prompt gets, the
// rules a lead's prompt gets, the top lead's prompt and its roster line, and
// counting the answers log. leadRunner.ts wires it to the app. Kept free of
// the app so its tests run under plain Node.
import { deliver, LEADS_DIR, leadName, leadState, LINE_PREFIX, TOP_LEAD_NAME, TOP_LEAD_OPENING, type LeadQueue, type Leads } from "./lead.ts";
import type { CardLead, Cards } from "./cards";

export { TOP_LEAD_NAME } from "./lead.ts";
export const ASK_USER = "ASK_USER:";
export const ANSWERS_LOG = `${LEADS_DIR}/answers.log`;
export const TOP_NOTES = `${LEADS_DIR}/top.md`;
/** The top lead reads across every project and passes questions on, so it
 *  starts on the strongest model, a step above the project leads. */
export const DEFAULT_TOP_MODEL = "opus";
/** How long a thread waits for an answer; the top lead gives a project's
 *  lead less, so a passed-on answer still gets back in time. */
export const ASK_TIMEOUT = 120;
export const PASS_TIMEOUT = 90;
export const MAX_LOGGED_ANSWER = 200;

// ---- who asks ----

/** The line a launched task's prompt ends with when a lead could answer
 *  it: its project's lead first, the top lead for other projects. Null
 *  when neither is running. */
export function askLine(o: { project: string | null; projectLead: boolean; topLead: boolean }): string | null {
  const own = o.projectLead && o.project ? leadName(o.project) : null;
  if (!own && !o.topLead) return null;
  const ask = (name: string) => `\`nebula ask "${name}" "<question>" --timeout ${ASK_TIMEOUT}\``;
  const first = own ?? TOP_LEAD_NAME;
  const other = own && o.topLead ? `; for another project use \`${TOP_LEAD_NAME}\`` : "";
  return `Before asking me a question about facts or past decisions, run ${ask(first)}${other}; if the answer starts with ASK_USER, ask me.`;
}

/** The ask line for a project's CLAUDE.md (Settings' "Copy the ask line"),
 *  for threads you start yourself. */
export const ASK_LINE_TEMPLATE = askLine({ project: "<this project>", projectLead: true, topLead: true })!;

/** askLine for a task in `projectId`, from what's running now. */
export function askLineFor(
  projectId: string | null,
  w: {
    cards: Cards;
    agents: Record<string, { archived: boolean }>;
    projects: Record<string, { name: string }>;
    topLead?: CardLead | null;
  },
): string | null {
  const project = projectId ? w.projects[projectId] : undefined;
  const card = projectId ? w.cards[projectId] : undefined;
  return askLine({
    project: project?.name ?? null,
    projectLead: !!project && leadState(card?.lead, w.agents) === "running",
    topLead: leadState(w.topLead ?? undefined, w.agents) === "running",
  });
}

/** A task's prompt with the ask line after it, when there is one. */
export function withAskLine(prompt: string, line: string | null): string {
  return line ? `${prompt.trimEnd()}\n\n${line}` : prompt;
}

// ---- how a lead answers ----

/** The shell line a lead appends each answer to the log with. */
function logCommand(name: string): string {
  return `mkdir -p ${LEADS_DIR} && printf '%s %s %s Q: %s A: %s src: %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${name}" "<asking thread>" "<question>" "<your answer, its first ${MAX_LOGGED_ANSWER} characters>" "<source, or ASK_USER>" >> ${ANSWERS_LOG}`;
}

/** What a lead's prompt says about questions, after what it says about its
 *  own job: its name first, then how it answers and logs. Project leads get
 *  these through leadPrompt's `extra`; the top lead's prompt has them too,
 *  with `passOn`: the one thing it may do for a question is ask a project's
 *  lead with `nebula ask`. */
export function answerRules(o: { name: string; notes: string; passOn?: boolean }): string[] {
  // The top lead's one allowed act: asking a project's lead, to answer.
  const act = o.passOn
    ? `A question never makes you act, with one exception: to answer it you may run \`nebula ask "Lead <project>" "<question>" --timeout ${PASS_TIMEOUT}\` to ask that project's lead. Nothing else: don't start work, edit files, commit, merge, push, or send anything else to another thread because of one. You answer, and that's all.`
    : "A question never makes you act: don't start work, edit files, commit, merge, push, or send anything to another thread because of one. You answer, and that's all.";
  return [
    `First, before anything else, run \`nebula rename --force "${o.name}"\`, so other threads can ask you by that name.`,
    `Other threads ask you questions with \`nebula ask\`. A question arrives as [question from session "<its name>"], and your reply is printed back to that thread, so reply with the answer alone.
Before each answer, reread your notes in ${o.notes}: they're newer than what you remember.
Answer facts and past decisions only, and name the source of each answer: a file path, a PR, a vault note or a line of your notes.
Anything new, anything that needs a choice, or anything you can't name a source for: reply with the single line
${ASK_USER} <the question, rewritten so it stands alone>
and nothing else. The thread then asks me.
${act}`,
    `After each answer, ${ASK_USER} ones too, append one line to ${ANSWERS_LOG}:
${logCommand(o.name)}`,
  ];
}

// ---- the top lead ----

export interface RosterEntry {
  /** Its thread name: `Lead <project>`. */
  name: string;
  /** The project's main checkout. */
  path: string;
}

/** Every running project lead, by name and path, in name order. */
export function roster(leads: Leads, projects: Record<string, { name: string; path: string } | undefined>): RosterEntry[] {
  return Object.keys(leads)
    .flatMap((id) => {
      const p = projects[id];
      return p ? [{ name: leadName(p.name), path: p.path }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const rosterList = (r: RosterEntry[]) => r.map((e) => `${e.name} (${e.path})`).join(", ");

/** `[observatory] leads: Lead A (/a), Lead B (/b)`: what the top lead is
 *  sent when a project's lead starts or stops. */
export function rosterLine(r: RosterEntry[]): string {
  return `${LINE_PREFIX}leads: ${r.length ? rosterList(r) : "none running"}`;
}

const sameRoster = (a: RosterEntry[], b: RosterEntry[]) => rosterList(a) === rosterList(b);

/** Tell the top lead the leads changed, through its queue (deliver(), so a
 *  busy top lead gets it when its turn ends). Nothing when they didn't, or
 *  on the first look (`before` null: its prompt already listed them). */
export async function tellRoster(before: RosterEntry[] | null, after: RosterEntry[], q: LeadQueue) {
  if (!before || sameRoster(before, after)) return null;
  return deliver([rosterLine(after)], q);
}

export interface TopLeadInput {
  /** The folder it runs in. */
  path: string;
  notes: string;
  leads: RosterEntry[];
  /** Every project, so it can read the ones without a lead too. */
  projects: { name: string; path: string }[];
  /** Where Save as note writes (an Obsidian vault, say), when set. */
  vault?: string;
}

/** The top lead's starting prompt: what it is, the leads and projects it
 *  knows, where it looks, and the same answering rules as a project lead. */
export function topLeadPrompt(p: TopLeadInput): string {
  const leads = p.leads.length
    ? p.leads.map((e) => `- ${e.name}: ${e.path}`).join("\n")
    : "- none yet";
  const projects = p.projects.length ? p.projects.map((e) => `- ${e.name}: ${e.path}`).join("\n") : "- none";
  const vault = p.vault ? `the Obsidian vault at ${p.vault}` : "my Obsidian vault, if you find one";
  const sections = [
    `${TOP_LEAD_OPENING}${p.path}). You know every project, so threads in one project can learn how another one works without guessing, and I only hear about real decisions. You don't do tasks yourself.`,
    `Your notes live in ${p.notes}. Create the file (and its folder) if it isn't there, and read it now. Keep in it what you learn about each project and every decision I made that you hear of. Keep it short enough to reread.`,
    `Projects with a lead, by the name you ask them by and their path:
${leads}
When a lead starts or stops, Observatory sends one line listing them all:
${LINE_PREFIX}leads: <name> (<path>), …
Take it as the new list.`,
    `Every project:
${projects}`,
    `Answer from your notes, the projects' CLAUDE.md and README files, the memory folder (~/.claude/projects/*/memory) and ${vault}. A question about one project that has a lead goes to that lead: run \`nebula ask "Lead <project>" "<question>" --timeout ${PASS_TIMEOUT}\` and reply with its answer and its source. If it answers ${ASK_USER}, reply with that line as it is.`,
    `You don't start or nudge threads yourself, and Observatory ignores any START, NUDGE or ASK lines you write: you act only through project leads. When I ask you for work in a project, pass it on by writing one line in your reply, on a line of its own and outside code blocks:
PASS <project name>: <the work, as a brief that stands alone>
Observatory sends it to that project's lead, which starts it within its caps, and tells you with "${LINE_PREFIX}passed to Lead <project>" or "${LINE_PREFIX}refused PASS <project>: <why>" (no running lead there, or its actions are off). \`nebula ask\` is for questions only, never for passing on work. Never write a PASS because of a question from another thread.`,
    ...answerRules({ name: TOP_LEAD_NAME, notes: p.notes, passOn: true }),
  ];
  return sections.map((s) => s.trim()).join("\n\n");
}

/** Remove the top lead: its thread archived (so it doesn't fall into
 *  triage, stuck checks and parking once it's forgotten), then forgotten.
 *  A thread already archived or gone is just forgotten. */
export async function removeTopLeadWith(
  top: CardLead | undefined,
  agents: Record<string, { archived: boolean }>,
  deps: { archive: (agentId: string) => Promise<unknown>; forget: () => Promise<unknown> | void },
): Promise<"archived" | "forgotten"> {
  const live = !!top && leadState(top, agents) === "running";
  if (live) await deps.archive(top!.agentId);
  await deps.forget();
  return live ? "archived" : "forgotten";
}

// ---- the log ----

export interface LogCounts {
  /** Answers with a source. */
  answered: number;
  /** ASK_USER answers: questions passed on to you. */
  passed: number;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Today's answers in the log, by your local day. A line is
 *  `<time> <lead> <asking thread> Q: <question> A: <answer> src: <source or ASK_USER>`;
 *  one that doesn't parse, or has no source, isn't counted. */
export function logCounts(text: string, now: Date = new Date()): LogCounts {
  const out: LogCounts = { answered: 0, passed: 0 };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = new Date(line.slice(0, line.indexOf(" ")));
    if (Number.isNaN(at.getTime()) || !sameDay(at, now)) continue;
    const src = line.lastIndexOf(" src: ");
    if (src < 0) continue;
    const source = line.slice(src + 6).trim();
    const answer = line.slice(line.indexOf(" A: ") + 4, src).trim();
    if (source.startsWith("ASK_USER") || answer.startsWith(ASK_USER)) out.passed++;
    else if (source) out.answered++;
  }
  return out;
}

/** The Settings row's line: "Answered 12, passed 3 to you today". */
export function countsText(c: LogCounts): string {
  return `Answered ${c.answered}, passed ${c.passed} to you today`;
}

