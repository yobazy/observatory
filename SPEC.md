# Observatory: Dispatch

## Problem
I start the day with a messy to-do list that spans several projects and my own errands. Turning it into running agent sessions means a lot of manual launching, and there is no single place to see which tasks are moving and which are waiting on me. Dispatch takes the pasted list, routes each item to a project (or to Home, or to me), launches the agents after I review the plan, and tracks everything on one board.

## Stack
Existing app: Tauri 2 (macOS), React 19 + TypeScript + Vite in `src/`, Rust in `src-tauri/src/`. It is a client of the external nebula daemon, which has no task concept, so all Dispatch state lives app-side in localStorage (same pattern as `src/nebula/fanout.ts` and `src/nebula/queue.ts`). Tests use Node's built-in runner (`tests/*.test.mjs`), not Vitest, to match the repo.

Design principle: the app knows only lists, projects, project cards, and sessions. It contains no code for any specific calendar, scheduler, or tool. Tool-based work goes through agents and whatever connectors the user has. The router runs through the user's preferred agent CLI in headless mode (for example `claude -p` or `codex exec`), so it does not depend on Claude.

## Run
```
npm install
npm run tauri dev      # full app (needs nebula daemon running)
npm run dev            # frontend only (mock data via src/nebula/mock.ts)
npm test               # node --test tests/*.test.mjs
npm run build          # tsc + vite build (type check)
```

## Worked example (illustration)
Pasted list:
```
go to the gym
apply to some jobs
work through practice problems on Formation
work through personal coding problems
update my resume
send it to Lauren for the Akkodis role
message Roger about referral to Swiftly
```
Expected plan:
- **go to the gym** goes to Home. The Home agent checks the calendar, asks for a time, and books it, following the Home card's scheduling instruction.
- **apply to some jobs** goes to the career-ops project, with the prompt invoking its apply skill.
- **update my resume** and **send it to Lauren for the Akkodis role** are merged into one task in career-ops. If an existing chat already holds the call transcript, the task goes there as a follow-up.
- **message Roger about referral to Swiftly** goes to career-ops.
- **Formation practice** and **personal coding problems** go to You. They are scheduled through Home if Home has a scheduling instruction; otherwise they stay on the board as checkable items.
- career-ops uses the Shared policy: its tracker and data are git-tracked and it has its own writer locks, so tasks run as sibling sessions in the main checkout, limited by the project's concurrency cap.

## Stories

### S1: Paste a to-do list into Dispatch
As a user, I want to paste a multi-line list into a Dispatch dialog and check items off, so that my day's tasks live in Observatory.
Notes: new `src/nebula/dispatch.ts` (parser and storage, modeled on `fanout.ts`) and `src/components/DispatchDialog.tsx`. Also reachable from the quick-capture hotkey in `src/nebula/desktop.ts`. No AI.
Acceptance criteria:
- Given the text `"a\n  ctx for a\nb\n\n"`, when `parseList()` runs, then it returns 2 items: `{text:"a", context:["ctx for a"]}` and `{text:"b", context:[]}`. Blank lines are dropped and indented lines attach to the previous unindented item (unit test in `tests/dispatch.test.mjs`).
- Given an indented line with no parent above it, when parsed, then it becomes its own item (unit test).
- Given items were saved, when the store is reloaded from localStorage, then the same items come back with the same ids and checked state (unit test using a localStorage stub).
- Given the app is running, when the user presses the quick-capture hotkey and chooses Dispatch (or opens Dispatch from the main UI), then the Dispatch dialog opens. Pasting a list shows one row per item, and ticking a row stays ticked after reloading the app (manual check in `npm run tauri dev`).

Status: done

### S2: Project cards with run policy and Home
As a user, I want each project to have an editable card that describes what lives there and how tasks run, so that the router has something to route against.
Notes: card storage lives in localStorage, keyed by project id. The draft is built from `CLAUDE.md`, `AGENTS.md`, `.claude/skills/*`, and `README*` in the project root (read through the Rust side or an existing file read path). The card is edited from the project menu (the same place as remove-project, near `src/components/AddProject.tsx`).
Card fields: `description`, `skills[]`, `taskKinds[]`, `policy: "isolated" | "shared"`, `concurrency` (shared only), `isHome`, `homeFolder`, `schedulingInstruction`.
Acceptance criteria:
- Given a fixture folder containing `CLAUDE.md` and `.claude/skills/apply/SKILL.md`, when `draftCard()` runs, then `skills` includes `"apply"` and `description` is non-empty (unit test).
- Given a project that is a git repo, when a card is first drafted, then `policy === "isolated"` (unit test). Given `policy` is set to `"shared"`, then `concurrency` defaults to 1 and can be edited (unit test).
- Given the user picks a plain folder (not a git repo) as Home, when it is saved, then exactly one card has `isHome: true`, its policy is `"shared"`, and flagging a second project as Home clears the first (unit test).
- Given the Home card's `schedulingInstruction` is empty, then `canSchedule(home) === false`; given it is non-empty, then it returns `true` (unit test).
- Given the user edits a card and reloads the app, then the edits persist (manual check).

Status: done

### S3: Routing review
As a user, I want one headless LLM call to turn my list into a proposed plan that I can edit before anything starts, so that routing is fast but stays under my control.
Notes: `buildRouterPrompt(items, cards, openSessions)` and `parsePlan(json)` go in `src/nebula/router.ts`. The router CLI is a setting (`claude -p`, `codex exec`, and so on) and is invoked headless from the Rust side. Each open session is passed in with its worktree, kind, status, and its recent prompts.
Plan schema per task: `{ sourceItemIds[], text, target: "project" | "home" | "you", projectId?, mode?: "new_worktree" | "existing_worktree" | "existing_chat", worktreeId?, sessionId?, confidence, question?, planCheckpoint: true }`.
Acceptance criteria:
- Given items, cards, and sessions, when `buildRouterPrompt()` runs, then the output contains every item's text, every card's description, and every open session's id and recent prompt (unit test).
- Given a router JSON fixture in which 2 source items map to 1 task, when `parsePlan()` runs, then the task has 2 `sourceItemIds` (merge). Given 1 item maps to 2 tasks, then both tasks reference it (split) (unit test).
- Given a task with `confidence` below the threshold, when parsed, then `projectId` is cleared and the task is flagged for user choice (unit test).
- Given 2 tasks that target the same existing worktree or the same existing chat, when `validatePlan()` runs, then it reports a conflict and confirm stays disabled. Given 2 tasks that target a Shared project's main checkout, then no conflict is reported (unit test).
- Given invalid or non-JSON router output, when `parsePlan()` runs, then it returns an error and the review shows it with a Retry button. No sessions are created (unit test plus manual check).
- Given a plan, when the review dialog opens, then every task's text, target, project, mode, worktree or chat, and plan-checkpoint box can be edited. Router `question` fields appear inline, and nothing launches until the user clicks Dispatch (manual check).
- Given the router is set to `codex exec` instead of `claude -p`, when routing runs, then a plan is produced (manual check).

Status: done

### S4: Dispatch with concurrency caps and plan checkpoint
As a user, I want confirmed tasks to launch as sessions or follow-ups while staying within my limits, so that I can hand off a whole list at once without flooding my machine.
Notes: new `src/nebula/batch.ts` modeled on `fanout.ts` (a batch is a group of task ids mapped to session ids). It launches with `createAgent()` (with `starting_prompt`) and follows up with `followUp()`, or with `src/nebula/queue.ts` when the chat is busy. Tasks that target a new worktree reuse the `LaunchDialog` / `runOnWorktree()` path. Note that `createAgent()` currently selects the new session; batch launches must not steal focus, so add an option to skip that.
Acceptance criteria:
- Given 6 tasks and a global cap of 4 (default, editable in settings), when Dispatch runs, then `nextLaunchable()` returns 4 tasks and 2 remain `pending`. When one session reaches finished or terminated, then exactly one pending task launches (unit test on the scheduler with fake session states).
- Given a Shared project with `concurrency: 1` and 2 tasks for it, then only 1 of them is running at any time, even when global slots are free (unit test).
- Given a task with mode `existing_chat` whose session is `running`, when it is dispatched, then the prompt is enqueued in the queue and not sent directly. Given the session is idle, then `followUp()` is called (unit test with a stubbed `actions.ts`).
- Given `planCheckpoint: true`, then the starting prompt ends with the plan-and-stop postfix, for every agent kind. Given `planCheckpoint: false`, then no postfix is added (unit test on `buildStartingPrompt()`). (`CreateAgent` has no permission-mode field, so Claude's native plan mode would need a daemon change; see LATER.md.)
- Given a task that targets a project whose card lists a skill, when the router chose that skill, then the starting prompt references it (unit test).
- Given a `you` task and a Home card with a scheduling instruction, then a Home session is created whose prompt includes the instruction and the task text. Given there is no instruction, then no session is created and the task stays on the list (unit test).
- Given the app is restarted while tasks are pending, when it reloads, then pending tasks are still pending and keep launching as slots free up (unit test of persistence plus manual check).

Status: done

### S5: Dispatch board
As a user, I want one board that shows every dispatched task and lets me act on it, so that I can unblock agents quickly and know when the batch is done.
Notes: new `src/components/DispatchBoard.tsx`. Ordering uses `urgency()` from `src/nebula/store.ts`, waiting detection uses `waitingAgents()`, inline answers use `QuickAnswer.tsx`, the last screen line comes from `src/nebula/screen.ts`, diff stat and PR come from `diff.ts` and `prs.ts`, and notifications go through `notify.ts`.
Acceptance criteria:
- Given tasks whose sessions are needs_feedback, running, and finished, when the board renders, then rows are ordered so needs_feedback comes first, matching `urgency()` (unit test on the row sort function).
- Given each row, then it shows the task text, target (project / branch / chat, or Home / You), status, and the last screen line for running sessions (manual check).
- Given a session stopped at its plan checkpoint, then the row shows Approve, Redirect (text input), and Cancel. Approve sends the approval follow-up, Redirect sends the entered text, and Cancel archives the session (`ArchiveAgent`) (manual check; the follow-up payloads are unit tested).
- Given a waiting session, then QuickAnswer is rendered inline in its row (manual check).
- Given a finished session, then the row shows the diff stat, and the PR link when one exists (manual check).
- Given a batch of 5 tasks where 4 finish and 1 is needs_feedback, when the last one settles, then exactly one notification fires with the text "4 done, 1 needs you", and no per-task notification fires for batch sessions, except "waiting on you": a batch session that needs you still gets its own banner, since holding that back until the batch settles would leave the agent stuck (unit test on `batchSummary()` and the notification suppression check).
- Given `you` tasks, then they appear as rows with a checkbox, and checking them off persists across reloads (manual check plus unit test on storage).

Status: done

### S6: Hand a task to another project
As a user, when an agent in one project finds work that belongs in another (say, an Observatory fix noticed while working in career-ops), I want that agent to start the task there for me to confirm, so that I don't have to switch projects and explain the context again.
Notes: Observatory registers an `observatory://` URL scheme (`tauri-plugin-deep-link`, plus `tauri-plugin-single-instance` so a link reaches the running app). An agent hands off with `open "observatory://new-task?project=<name or path>&prompt=<brief>&from=$NEBULA_AGENT_ID"`; every nebula session has `NEBULA_AGENT_ID` set. Any agent CLI can run `open`, and nebula needs no change. The link only fills in the existing `LaunchDialog`; nothing starts until the user clicks Start. Agents learn the convention from a short instruction Observatory offers to copy from Settings, for the user's global `CLAUDE.md` / `AGENTS.md`: write a self-contained brief (what you found, where, why it matters, what done looks like) and open the link. Parsing and matching go in a new `src/nebula/handoff.ts`. Once nebula ships `nebula read` (AgentSystemLabs/nebula#163), the brief can tell the new task to read the source session for more context.
Acceptance criteria:
- Given `observatory://new-task?project=observatory&prompt=fix%20the%20thing&from=01K…`, when `parseHandoff()` runs, then it returns `{project:"observatory", prompt:"fix the thing", from:"01K…"}`. Given a link with no prompt, an unknown action, or a prompt over 20,000 characters, then it returns an error (unit test).
- Given projects named `observatory` and `career-ops`, when `matchProject()` gets `"Observatory"`, a repo path, or a path inside the repo, then it returns that project. Given no match or several, then it returns null and the dialog asks the user to pick (unit test).
- Given the app is running in the background, when the link opens, then Observatory comes to the front with the New task dialog filled in with the project, the prompt (editable), and the default agent kind, and no session has been created (manual check).
- Given `from` names a live agent, then the dialog shows "From <task title> in <project>". Given `from` is missing or unknown, then it shows "From a link" instead, so a link opened by a web page can't pass as one of your agents (unit test on the label, plus manual check).
- Given the user clicks Start, then a task starts in the target project the same way a New task from the dialog does. Given they dismiss it, then nothing is created (manual check).
- Given the app isn't running, when the link opens, then the app launches and shows the same dialog once it has connected to the daemon (manual check).
- Given an agent in another project is given the Settings instruction and asked to "hand this to Observatory", then it opens a link and the dialog shows a brief someone could act on without the original conversation (manual check with Claude and Codex).

Status: done. Not yet checked by hand: a link opened while the app is closed, and briefs written by Claude and Codex from the Settings instruction.

## Automations (S11 to S14)

Problem: I have background jobs in three places: launchd agents on this Mac, Claude cloud routines, and a vault backup inside Obsidian. Nothing shows me whether they're healthy, so a broken job stays broken until I notice what it was supposed to do didn't happen. The check-up done while scoping this (2026-10-22) found exactly that. `com.bazil.todos-notion` isn't loaded in launchd, and its last log lines are a `PermissionError` on `~/Documents/Programming`. `wispr-watch --status` says "trigger url: missing, token: missing, last fired: never", so the meeting-finished trigger has never fired. The Hermes gateway's error log ends in `sqlite3.OperationalError: disk I/O error`. An Automations view puts every job in one list with its health, and lets me run it now.

Principles, as above: nothing hardwired. The app knows kinds of job (launchd agent, cloud routine, watched folder), never specific jobs. Which agents show up comes from a label filter in Settings. Display names, status commands and watched folders come from an optional `~/.config/observatory/automations.json` that the user (or an agent) edits. Health checks are deterministic, with no model call. Tests use fixtures (plists, `launchctl print` output, API JSON, log tails) on Node's built-in runner and `cargo test`. Manual checks that run something use throwaway jobs, never the real ones. Build order: S11, S12, S13, S14. Enabling and disabling jobs comes later (see LATER.md).

Where it lives: a view laid over sessions and terminal like Usage and Activity (`view: "automations"` in `store.ts`), opened from a sidebar footer button beside the usage chip. The button carries one dot for the worst health across all jobs, so a red job shows without opening anything.

Decided (2026-10-22):
1. Routines API: Run now goes through each routine's API trigger token, kept in the keychain (the `wispr-sync-routine` item wispr-watch already expects, one item per routine). Status, runs and logs come from a headless `claude -p --model haiku` call allowed only the RemoteTrigger tool, made when the view opens and on Refresh, never on a background timer. The app never holds the claude.ai login. The footer dot counts routines by their last fetched state.
2. Placement: an overlay view like Usage, opened from a sidebar footer button carrying the health dot.

### S11: Automations view with local launchd jobs (read-only)
As a user, I want one view listing my launchd agents, each with where it runs, its schedule, its last run and result, its next run, a log tail and a health dot, so that I can see at a glance which background jobs are working.
Notes: new `src-tauri/src/automations.rs` reads `~/Library/LaunchAgents/*.plist` (through `plutil -convert json`) and `launchctl print gui/<uid>/<label>` (loaded or not, pid, `last exit code`, `runs`). New `src/nebula/automations.ts` (pure: schedule text, next run, health, the job list) and `src/components/Automations.tsx`. Which labels show is set by a `automationLabels` pref in Settings, a list of prefixes. It starts as the prefixes of plists not from Apple, Google, Adobe or Valve, which today is `com.bazil.` and `ai.hermes.`. Schedule comes from `StartInterval`, `StartCalendarInterval`, `KeepAlive` and `WatchPaths`. launchd doesn't record when a job last ran, so last run is the newest of two signs: the mtime of the job's `StandardOutPath` or `StandardErrorPath`, and the moment the app saw `launchctl print`'s `runs` count go up (kept per label in localStorage, with the time the app started watching). It's shown as "about". A job that rarely writes its log still counts as running from its `runs` count. Next run is that time plus `StartInterval`, or the next `StartCalendarInterval` match. The log tail is the last 20 lines of those paths. Health: `ok`, `failing` (last exit code isn't 0, or the tail's last lines hold a traceback, `Error` or `error:`), `not loaded` (a plist with no launchd service), `stale` (no sign of a run in 3× its interval, counted only once the app has watched it that long; before that, a job with no sign shows "Last run not seen yet" and keeps the health its exit code gives), `running` (always-on with a pid). The reason is one line: the exit code, or the last error line, clipped. Refreshes every 30 s while the view is open and every 5 min otherwise, for the footer dot (same pattern as `usage.ts`).
Acceptance criteria:
- Given the `com.bazil.todos-notion` plist fixture, when `scheduleText()` runs, then it returns "Every 5 min, and when 3 files change". Given `StartInterval: 7200`, then "Every 2 h". Given `KeepAlive: true`, then "Always on". Given a `StartCalendarInterval` of `{Hour: 9, Minute: 0}`, then "Daily at 9:00 am" (unit test).
- Given `launchctl print` output reading "Could not find service", when `health()` runs, then it returns `not loaded`. Given `last exit code = 1`, then `failing` with "Exited with code 1". Given exit code 0 and a tail ending in `PermissionError: [Errno 1] Operation not permitted: '/Users/x/Documents/Programming'`, then `failing` with that line as the reason (unit test with fixtures).
- Given a job every 120 s whose logs were last written 10 minutes ago, then `stale` with "No run in 10 min (expected every 2 min)". Given a `KeepAlive` job with a pid, then `running` (unit test).
- Given plists for `com.bazil.a`, `com.google.keystone.agent` and `ai.hermes.gateway` with the default prefixes, then only `com.bazil.a` and `ai.hermes.gateway` are listed (unit test on the filter).
- Given an `automations.json` entry naming `com.bazil.wispr-watch` "Wispr watcher", then the row shows that name, and the label otherwise (unit test).
- Given one job `failing` and the rest `ok`, then the footer dot is red. All `ok` makes it green, and any `stale` or `not loaded` with nothing failing makes it orange (unit test on `worstHealth()`).
- Given the app is running on this Mac, when the view is opened, then the four agents show. todos-notion shows `not loaded` with its PermissionError, and expanding a row shows its log tail (manual check, read-only).

Status: todo

### S12: Run now, open logs, and a status command for local jobs
As a user, I want to run a launchd job now, open its full log, and see the job's own status command output, so that I can check a fix without waiting for the next interval.
Notes: Run now is `launchctl kickstart gui/<uid>/<label>`. For an always-on job the button reads Restart and uses `kickstart -k`, after a confirm. A `not loaded` job's Run now is disabled, with "Not loaded in launchd" as its tooltip (loading it is the enable/disable work in LATER.md). Open log opens the log file in the app's file preview (`Preview.tsx`). An `automations.json` entry can give a `statusCommand` (for wispr-watch, `wispr-watch --status`). It runs through the Rust side with a 10 s timeout and no shell, and its output is shown under the log tail. After Run now, the row refreshes every 2 s for 30 s so the new run shows up. Manual checks use a throwaway agent that `scripts/sandbox.sh automations` installs (`com.observatory.sandbox-job`, echoes a line every 10 min to a log in the sandbox folder) and `scripts/sandbox.sh automations-clean` removes.
Acceptance criteria:
- Given a job with `StartInterval`, when Run now is pressed, then `kickstart` is called without `-k`. Given an always-on job, then the button reads Restart, a confirm appears, and `kickstart -k` is called only after it's accepted (unit test with a stubbed invoke).
- Given a `not loaded` job, then Run now is disabled with "Not loaded in launchd" (unit test).
- Given a `statusCommand` that prints 3 lines, then they show under the log tail. Given one that runs past 10 s, then "Status command timed out" shows instead and the app stays responsive (Rust test with `sleep`).
- Given the sandbox job, when Run now is pressed, then a new line appears in its log tail within 5 s and its last run says "just now" (manual check).

Status: todo

### S13: Claude cloud routines in the view
As a user, I want my Claude cloud routines in the same list, with schedule, last run and result, next run and the last run's log, plus Run now, so that cloud jobs and local jobs are checked in one place.
Notes: the routines API (`/v1/code/triggers` and `/v1/code/sessions`) gives everything needed: `list` and `get` return `cron_expression`, `enabled`, `next_run_at` and `last_run` (`status`, `fired_at`, `finished_at`, `failure_reason`, `session_id`). `list_runs` gives recent runs, and `get_run_log` gives a run's condensed events. A per-routine API trigger token can only fire a run, not read anything, so reading needs the user's claude.ai login. How Observatory gets that is decision 1 above. New `src/nebula/routines.ts` (pure: maps API JSON to the same job rows as S11, cron to schedule text in the user's time zone, run status to health) and a Rust fetcher behind one `routines_*` command set. Health: `ok` (last run succeeded), `failing` (last run failed, with `failure_reason` or the log's last error as the reason), `paused` (`enabled: false`), `stale` (no run since a scheduled time more than 1 h ago). The log tail is the last 20 events of the last run. "Open on claude.ai" opens the routine's page. Run log text is data from a remote run: it's shown as plain text and never sent to a model.
Acceptance criteria:
- Given the Wispr routine's `get` fixture (`cron_expression: "0 1,13 * * *"`, UTC), when `scheduleText()` runs with zone America/Toronto, then it returns "Daily at 9:00 am and 9:00 pm". Given its `next_run_at`, then next run shows in local time (unit test).
- Given `last_run.status: ROUTINE_RUN_STATUS_SUCCEEDED`, then `ok` with the run's duration. Given a failed run, then `failing` with its reason. Given `enabled: false`, then `paused` (unit test with fixtures).
- Given a routine whose `next_run_at` is 3 h in the past and no newer run, then `stale` (unit test).
- Given Run now is pressed, then the run call goes out once, the button shows "Starting…", and the new run is picked up from `list_runs` within 30 s (unit test with a stubbed fetcher).
- Given the fetcher fails (signed out, network), then routines show one "Couldn't reach claude.ai: <error>" row, and local jobs are unaffected (unit test).
- Given a throwaway test routine made for the check, when Run now is pressed in the app, then a run starts, finishes, and its log tail shows in the row (manual check; the two real routines are only read).

Status: todo

### S14: Watched folders, for jobs that run inside other apps
As a user, I want jobs I can't run or query, such as the Obsidian Git vault backup, shown by when they last left a mark, so that a stopped backup turns red too.
Notes: an `automations.json` entry of kind `folder`: `{name, path, every, match}`. Last run is the newest commit in `path` whose subject matches `match` (for Obsidian Git, `vault backup`), read through the existing `git.rs`. Without `match`, it's the newest file mtime in the folder. Health is `ok` within 3× `every` and `stale` past that. There's no Run now, and the row says "Runs inside Obsidian".
Acceptance criteria:
- Given a fixture repo whose last "vault backup" commit is 15 min old and `every: "10m"`, then `ok`. At 45 min, then `stale` with "No backup in 45 min (expected every 10 min)" (unit test).
- Given a `path` that doesn't exist, then `failing` with "Folder not found" (unit test).
- Given the real vault entry, then the row shows the last backup time (manual check, read-only).

Status: todo

