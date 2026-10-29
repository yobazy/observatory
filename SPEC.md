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

## Fewer threads reaching me (S7 to S10)

Problem: with many agents going, too much of it reaches me at once. What limits me is my attention and checking the work, not how many agents can run. A usage-log hour on 2026-10-18 (64 minutes, the only stretch the log holds) showed it: 26 sessions opened, 1 every 2.5 minutes, across 6 projects (19 of 20 opens switched project). Only 1 of those opens found an agent waiting on me. 16 were check-ins on a session that was still running or that I'd already seen finish, and 13 lasted under 20 seconds. ⌘J (next session waiting on you) wasn't pressed once. nebula holds 107 unarchived sessions in 28 projects, but only 2 are running. 104 show "finished", which only means their turn ended. 68 haven't changed in 3 days and 44 in a week. So the pile is finished threads I still have to triage by hand, not agents running at once. These stories cut down what reaches me. They add no orchestration.

Principles, as above: nothing hardwired (every model call goes through a CLI command set in Settings, the same way the router's does), all state app-side in localStorage or the desktop prefs, and tests on Node's built-in runner. Build order: S7, S8, S9, S10.

### S7: Triage queue
As a user, I want a cheap headless model to read the end of each thread and tell me in one line what it needs from me, ranked in one queue, so that I stop opening threads just to find out where they stand.
Notes: this pulls the LATER item "cheap Haiku progress summaries" forward and widens it to every open session, not only Dispatch tasks. New `src/nebula/triage.ts` (pure: picks what to read, builds the prompt, parses the reply, ranks the queue) and `triageRunner.ts` (wires it to the store on a timer, like `batchRunner.ts`). The CLI is a new `triageCommand` pref beside `routerCommand`, and it runs headless through the same Rust runner (`router.rs`). The default is a cheap Claude call that leaves no saved session behind (`claude -p --model haiku --no-session-persistence`), and it can be changed to `codex exec` or any other CLI. The input per session is the tail of its transcript (`transcript.rs`), its latest turn summary (`turnsummary.ts`), its last prompt and its status. Labels: `decision` (needs a decision), `review` (needs review), `checked` (done and checked), `stuck`, `stale`. Only the labels and one-line needs are kept, never the transcripts. The queue goes at the top of the Dispatch board and covers every open session, dispatched or not.
Acceptance criteria:
- Given 30 sessions of which 3 have changed since their last triage (by status, `status_changed_at`, or transcript length), when a triage pass runs, then only those 3 are sent to the model. Given none changed, then no model call is made (unit test on `toTriage()`).
- Given a session unchanged for longer than the stale threshold (default 3 days, editable), then it's labelled `stale` without a model call (unit test).
- Given sessions to triage, when `buildTriagePrompt()` runs, then each session's part has at most 3,000 characters of transcript tail plus its turn summary, last prompt and status. Sessions go in batches of up to 10 per call (unit test on the prompt's size and batching).
- Given a reply fixture, when `parseTriage()` runs, then each session gets one of the five labels and a need of at most 100 characters (longer ones are clipped). Given an unknown label, a missing session, or non-JSON, then those sessions keep their previous labels and the pass reports one error (unit test).
- Given a session whose status is `needs_feedback`, or one held at a usage limit (`limits.ts`), then its label is `decision` whatever the model says. Given a running session, then it isn't in the queue (unit test).
- Given triage results, then the stored record per session holds only `{label, need, key, at}`, with no transcript text (unit test on what `saveTriage()` writes).
- Given labelled sessions, when the queue is ranked, then `decision` comes first, then `stuck`, `review`, `checked`, with `stale` folded away at the end. Within a label the longest-waiting comes first (unit test on `rankQueue()`).
- Given the queue, when I press "Got it" on a row, then the row leaves the queue until the session changes again. Given a `checked` row, then it also offers Archive (unit test on the acknowledged state, plus a manual check).
- Given the queue isn't empty, when I press ⌘J, then the top unacknowledged row's session opens, and pressing again moves down the queue. Today's ⌘J only walks sessions with status `needs_feedback`, which was 1 of the 26 opens in the log (unit test on the next pick, plus a manual check).
- Given the usage log is on, then opening a session from the queue logs `queue.open` with its label, and a session's wait on me is logged as `wait` with how long it was `needs_feedback`. That way the next log can show whether opens move from checking to acting (unit test on `changes()`).
- Given `triageCommand` is set to `codex exec`, when a pass runs, then the labels come back the same way (manual check). Given the sandbox with 10 sessions in mixed states, then the queue renders with labels and needs within one pass of the app starting (manual check against `scripts/sandbox.sh app`).

### S8: Park idle threads in Ideas, and one cap on running tasks
As a user, I want threads that have sat idle for days filed away as Ideas with a short brief, and new work to wait when enough is already running, so that what's open is what I'm actually working on.
Notes: the log changed this story's weight. Only 2 sessions are running, so a global cap rarely binds. The 68 threads idle for 3 days or more are the overload, so parking is the main part. Parking writes the brief with `moveBrief()` (`movebrief.ts`; no model call), adds an Idea (`addIdea()` in `ideas.ts`) with a new `source.kind: "parked"` and the agent's id, and archives the session (`ArchiveAgent`). Since `UnarchiveAgent` exists, every park can be undone. The cap: Dispatch already has one (`DEFAULT_CAP = 4` in `batch.ts`), but `nextLaunchable()` counts only batch tasks. Here it counts every working session, however it was started.
Acceptance criteria:
- Given sessions whose last change is older than the park threshold (default 3 days, editable, separate from the stale threshold), when `toPark()` runs, then it returns them. It never returns one that's running, waiting on me, pinned, or in a Dispatch batch that hasn't settled (unit test).
- Given a thread to park, then the Idea's text is the thread's title, its brief is `moveBrief()`'s output, its project is the thread's repo, and its source is `{kind:"parked", agent}`. Given the thread's triage label was `review` or it was unseen, then the Idea's priority is `high` (unit test).
- Given parking is on for the first time and threads are due, then they're listed for me to confirm, and I can untick any of them. After that first OK, due threads park on their own, and the sidebar says "Parked 5 idle threads" with Undo (manual check).
- Given a parked Idea, when I pick Resume, then the session is unarchived and the Idea is marked started. When I pick "Start fresh", then a new task opens in the New task box with the brief (unit test on the actions, plus a manual check).
- Given Undo right after a park, then every thread from that park is unarchived and its Idea removed (unit test with a stubbed `request`).
- Given a global cap of 4 and 3 sessions working that were started from New task, then `nextLaunchable()` launches only 1 batch task (unit test).
- Given 4 sessions working, when I start a task from New task, then the box says "4 running, this will wait in Dispatch's queue" and offers Start anyway. Queued, it launches when a slot frees, the same way a batch task does (unit test on the queueing, plus a manual check).

### S9: Stuck and over-budget tasks flagged in the queue
As a user, I want a task that keeps hitting the same error, or has used most of its budget, flagged as stuck in the queue, so that I step in before it burns time and money.
Notes: these checks are deterministic, with no model call, and they run inside the triage pass (S7). They override the model's label. Repeated errors are read from the turn's steps (`turns.rs` and `turnsummary.ts`, a failed command or tool and its result). budget.ts has day and week budgets in API-equivalent dollars, plus `costBySession()`, but no per-task budget. So this adds a per-task budget in the same dollars the usage view shows, with a default in Settings (it starts at $10 and can be edited) and an optional override on a Dispatch task.
Acceptance criteria:
- Given a session whose last steps include the same failing error 3 times (compared after numbers, paths and timestamps are taken out), when `stuckReason()` runs, then it returns "Same error 3 times: <error, clipped>". Given 3 different errors, or the same one twice, then it returns null (unit test with step fixtures).
- Given a session whose cost has reached 85% of its budget, then `stuckReason()` returns "Used 87% of its $10 budget". Given a Dispatch task with its own budget, then that budget is used instead of the default (unit test with a stubbed usage report).
- Given a stuck reason, then the session's label is `stuck` with the reason as its need, whatever the model said. The flag holds until the session runs again because I replied, or I press "Got it" (unit test).
- Given a session that crosses 85%, then one banner fires for it, through `notify.ts` and respecting quiet hours, and no more until it crosses 100% (unit test on the nudge check, like budget.ts's 80% and 100% ones).
- Given a stuck session, then nothing is stopped or archived on its own; the row offers Open, Stop, and a Redirect box (manual check).

### S10: A check before "done"
As a user, I want a read-only reviewer to check a finished task (its checks, lint, and acceptance criteria) before it shows as done, and to send any failure straight back to the builder, so that "done" means checked and I review less.
Notes: most "finished" threads are conversations with no code (`general` alone has 12). So the check only runs when a turn ends with changes in the checkout (`uncommitted.ts`, or new commits on the branch from `diff.ts`) and triage hasn't labelled the session `decision`. The reviewer is a headless CLI set in a new `reviewCommand` pref. Its default is read-only by its own flags (for Claude, a plan-mode `claude -p`; for Codex, `codex exec --sandbox read-only`). The app also checks that the reviewer changed nothing: it compares `git status` and HEAD before and after. The checks to run come from a new card field `checks` (drafted from the `## Checks` block in CLAUDE.md, or else from `package.json`'s `test` and `lint` scripts, and editable). The acceptance criteria are the Dispatch task's text, or else the thread's first prompt. New `src/nebula/review.ts` holds the trigger, the prompt and the verdict parser.
Acceptance criteria:
- Given a turn ends with a diff, a non-`decision` label and checks on the card, when `needsReview()` runs, then it returns true. Given no diff, then it returns false. Given the same HEAD and diff already passed, then it returns false (unit test).
- Given a fixture folder with a CLAUDE.md `## Checks` block, when `draftCard()` runs, then `checks` holds those commands. Given only `package.json` with `test` and `lint` scripts, then it holds `npm test` and `npm run lint` (unit test).
- Given a reviewer reply fixture, when `parseVerdict()` runs, then it returns `{pass, failures[]}`. Given output that isn't JSON, then the verdict counts as a failed review run, not a failed task, and the row says "Couldn't check: <error>" (unit test).
- Given a pass, then the label becomes `checked`. Without one, a session with changes is never labelled `checked`, even when the model says so (unit test on the label rule).
- Given a fail, then the builder gets one follow-up that lists the failures (queued with `queue.ts` when it's busy), and the row shows "Fixing: 2 checks failed". Given a second fail on the same task, then no more follow-ups are sent, and the label becomes `stuck` with "Failed review twice" (unit test with a stubbed `actions.ts`).
- Given the reviewer changed the checkout, then its verdict is thrown away and the row says "Reviewer changed files; not trusted" (unit test on the before/after comparison).
- Given a card with the check turned off, then no review runs for that project (unit test).
- Given a sandbox task that edits a file and breaks a test, when it finishes, then the reviewer fails it, the builder gets the failure and fixes it, and the second review passes and shows it as done and checked (manual check against the sandbox).

## Automations (S11 to S14)

Problem: I have background jobs in three places: launchd agents on this Mac, Claude cloud routines, and a vault backup inside Obsidian. Nothing shows me whether they're healthy, so a broken job stays broken until I notice what it was supposed to do didn't happen. The check-up done while scoping this (2026-10-22) found exactly that. `com.bazil.todos-notion` isn't loaded in launchd, and its last log lines are a `PermissionError` on `~/Documents/Programming`. `wispr-watch --status` says "trigger url: missing, token: missing, last fired: never", so the meeting-finished trigger has never fired. The Hermes gateway's error log ends in `sqlite3.OperationalError: disk I/O error`. An Automations view puts every job in one list with its health, and lets me run it now.

Principles, as above: nothing hardwired. The app knows kinds of job (launchd agent, cloud routine, watched folder), never specific jobs. Which agents show up comes from a label filter in Settings. Display names, status commands and watched folders come from an optional `~/.config/observatory/automations.json` that the user (or an agent) edits. Health checks are deterministic, with no model call. Tests use fixtures (plists, `launchctl print` output, API JSON, log tails) on Node's built-in runner and `cargo test`. Manual checks that run something use throwaway jobs, never the real ones. Build order: S11, S12, S13, S14. Enabling and disabling jobs comes later (see LATER.md).

Where it lives: a view laid over sessions and terminal like Usage and Activity (`view: "automations"` in `store.ts`), opened from a sidebar footer button beside the usage chip. The button carries one dot for the worst health across all jobs, so a red job shows without opening anything.

Decided (2026-10-22):
1. Routines API: Run now goes through each routine's API trigger token, kept in the keychain (the `wispr-sync-routine` item wispr-watch already expects, one item per routine). Status, runs and logs come from a headless `claude -p --model haiku` call allowed only the RemoteTrigger tool, made when the view opens and on Refresh, never on a background timer. The app never holds the claude.ai login. The footer dot counts routines by their last fetched state.
2. Placement: an overlay view like Usage, opened from a sidebar footer button carrying the health dot.

### S11: Automations view with local launchd jobs (read-only)
As a user, I want one view listing my launchd agents, each with where it runs, its schedule, its last run and result, its next run, a log tail and a health dot, so that I can see at a glance which background jobs are working.
Notes: new `src-tauri/src/automations.rs` reads `~/Library/LaunchAgents/*.plist` (through `plutil -convert json`) and `launchctl print gui/<uid>/<label>` (loaded or not, pid, `last exit code`, `runs`). New `src/nebula/automations.ts` (pure: schedule text, next run, health, the job list) and `src/components/Automations.tsx`. Which labels show is set by a `automationLabels` pref in Settings, a list of prefixes. It starts as the prefixes of plists not from Apple, Google, Adobe or Valve, which today is `com.bazil.` and `ai.hermes.`. Schedule comes from `StartInterval`, `StartCalendarInterval`, `KeepAlive` and `WatchPaths`. launchd doesn't record when a job last ran, so last run is the newest of two signs: the mtime of the job's `StandardOutPath` or `StandardErrorPath`, and the moment the app saw `launchctl print`'s `runs` count go up (kept per label in localStorage, with the time the app started watching). It's shown as "about". A job that rarely writes its log still counts as running from its `runs` count. Next run is that time plus `StartInterval`, or the next `StartCalendarInterval` match. The log tail is the last 20 lines of those paths. Health: `ok`, `failing` (last exit code isn't 0, or the tail's last lines hold a traceback, `Error` or `error:`), `not loaded` (a plist with no launchd service), `stale` (no sign of a run in 3× its interval, counted only once the app has watched it that long; before that, a job with no sign shows "Watching for its next run" and keeps the health its exit code gives), `running` (always-on with a pid), or `running with errors` (orange) when an always-on job's log ends in an error, since the error may be old (decided 2026-10-29). The reason is one line: the exit code, or the last error line, clipped. Refreshes every 30 s while the view is open and every 5 min otherwise, for the footer dot (same pattern as `usage.ts`).
Acceptance criteria:
- Given the `com.bazil.todos-notion` plist fixture, when `scheduleText()` runs, then it returns "Every 5 min, and when 3 files change". Given `StartInterval: 7200`, then "Every 2 h". Given `KeepAlive: true`, then "Always on". Given a `StartCalendarInterval` of `{Hour: 9, Minute: 0}`, then "Daily at 9:00 am" (unit test).
- Given `launchctl print` output reading "Could not find service", when `health()` runs, then it returns `not loaded`. Given `last exit code = 1`, then `failing` with "Exited with code 1". Given exit code 0 and a tail ending in `PermissionError: [Errno 1] Operation not permitted: '/Users/x/Documents/Programming'`, then `failing` with that line as the reason (unit test with fixtures).
- Given a job every 120 s whose logs were last written 10 minutes ago, then `stale` with "No run in 10 min (expected every 2 min)". Given a `KeepAlive` job with a pid, then `running` (unit test).
- Given plists for `com.bazil.a`, `com.google.keystone.agent` and `ai.hermes.gateway` with the default prefixes, then only `com.bazil.a` and `ai.hermes.gateway` are listed (unit test on the filter).
- Given an `automations.json` entry naming `com.bazil.wispr-watch` "Wispr watcher", then the row shows that name, and the label otherwise (unit test).
- Given one job `failing` and the rest `ok`, then the footer dot is red. All `ok` makes it green, and any `stale` or `not loaded` with nothing failing makes it orange (unit test on `worstHealth()`).
- Given the app is running on this Mac, when the view is opened, then the four agents show. todos-notion shows `not loaded` with its PermissionError, and expanding a row shows its log tail (manual check, read-only).

Status: done. Not yet checked by hand in the running app: opening a row (checked in the browser preview and by a read-only run against the real agents).

### S12: Run now, open logs, and a status command for local jobs
As a user, I want to run a launchd job now, open its full log, and see the job's own status command output, so that I can check a fix without waiting for the next interval.
Notes: Run now is `launchctl kickstart gui/<uid>/<label>`. For an always-on job the button reads Restart and uses `kickstart -k`, after a confirm. A `not loaded` job's Run now is disabled, with "Not loaded in launchd" as its tooltip (loading it is the enable/disable work in LATER.md). Open log opens the log file in the app's file preview (`Preview.tsx`). An `automations.json` entry can give a `statusCommand` (for wispr-watch, `wispr-watch --status`). It runs through the Rust side with a 10 s timeout and no shell, and its output is shown under the log tail. After Run now, the row refreshes every 2 s for 30 s so the new run shows up. Manual checks use a throwaway agent that `scripts/sandbox.sh automations` installs (`com.observatory.sandbox-job`, echoes a line every 10 min to a log in the sandbox folder) and `scripts/sandbox.sh automations-clean` removes.
Acceptance criteria:
- Given a job with `StartInterval`, when Run now is pressed, then `kickstart` is called without `-k`. Given an always-on job, then the button reads Restart, a confirm appears, and `kickstart -k` is called only after it's accepted (unit test with a stubbed invoke).
- Given a `not loaded` job, then Run now is disabled with "Not loaded in launchd" (unit test).
- Given a `statusCommand` that prints 3 lines, then they show under the log tail. Given one that runs past 10 s, then "Status command timed out" shows instead and the app stays responsive (Rust test with `sleep`).
- Given the sandbox job, when Run now is pressed, then a new line appears in its log tail within 5 s and its last run says "just now" (manual check).

Status: done. Not yet checked by hand in the running app: pressing Run now and Restart (Run now's Rust path was checked on the sandbox job).

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

## Thread tags (S15 to S16)

Problem: one busy repo can hold work for several clients. client-branding-strategy has threads for blkwtr, hoam and others, and today the only way to see one client's threads is to read every title or split the repo into projects. Tags on threads, with chips above the project's thread list, let me see one client's threads in one click and keep the repo whole.

Principles, as above: nothing hardwired (the tagging prompt goes through a CLI command set in Settings, the same way the router's does), all state app-side in the desktop prefs, and tests on Node's built-in runner. Tags are the app's own marks, like task colors and pins. They aren't nebula protocol, so `src/nebula/types.ts` doesn't change. They're separate from the existing project tags (`projectTags`, used by the sidebar filter in `folders.ts`): those tag projects, these tag threads inside one project. Build order: S15, then S16.

### S15: Tag threads by hand, and filter a project's threads by tag
As a user, I want a project's own list of tags, to tag threads with them from a thread's menu, and chips above the thread list that show only one tag's threads, so that one repo can hold several clients' work and I can see one client at a time.
Notes: new `src/nebula/threadtags.ts` (pure: the tag list edits, a thread's tags, the filter) with tests in `tests/threadtags.test.mjs`. Two new prefs in `DesktopPrefs` (`src/nebula/theme.ts`): `threadTagLists?: Record<string, string[]>` (a project's tags, by repo path, in the order added) and `threadTags?: Record<string, {tags: string[]; by: "you" | "prompt"; at: number}>` (by agent id). Writes go through `save()` in `src/nebula/organize.ts`, and `pruned()` drops entries for gone projects (`ofRepo`) and gone threads (`keep`), as it does for `projectTags` and `taskColors`. Tag names are cleaned with `cleanTag()` from `folders.ts` (no `#`, lower case, spaces to dashes) and shown with a `#`. The thread menu gets a "Tags…" item in `agentItems()`'s `arrange` group in `src/components/RowMenu.tsx`, beside "Color…". It opens a dialog (new `ThreadTagsDialog`, next to `TaskColorDialog` in `src/components/Organize.tsx`) with a checkbox per project tag and a "New tag" field that also adds the tag to the project's list. Anything set from this dialog, clearing every tag included, is stored with `by: "you"`. The chips row goes in `src/components/Sessions.tsx` between the header and `.sessions-search`. It has one chip per tag with its thread count, plus "Edit tags…", which opens the same tag list editor (add, rename, delete); with no tags yet the row holds only that link, and the sidebar project menu has a "Thread tags…" item that opens it too. The active chip is held in Sessions' state next to `query`, and it resets when the project changes, the same way the search does. `Band` hides the rows that don't match, the same way it does for `terms`, and dragging rows to reorder is off while a chip is on, as it is while searching. Archived threads keep their tags and follow the same filter.
Acceptance criteria:
- Given a project with no tags, when `addTag(prefs, repo, "#BLK Wtr")` runs, then the project's list is `["blk-wtr"]`. Given the tag is already there, then the list doesn't change. Given it's empty after cleaning (`"#"`, `"  "`), then it's refused (unit test).
- Given threads A and B tagged `blkwtr`, when `renameTag(prefs, repo, "blkwtr", "blackwater")` runs, then the list holds `blackwater` in the same place and both threads carry `blackwater`. Given the new name is already in the list, then the two merge and no thread carries it twice (unit test).
- Given threads A and B tagged `blkwtr`, and A also tagged `hoam`, when `deleteTag(prefs, repo, "blkwtr")` runs, then the tag leaves the list, B has no tags and A keeps `hoam`. Tags in another project's list don't change (unit test).
- Given a thread, when `setThreadTags(prefs, agentId, ["hoam"])` runs from the menu, then its record is `{tags: ["hoam"], by: "you"}`. Given every tag is cleared from the menu, then the record stays as `{tags: [], by: "you"}`, so S16's prompt leaves it alone (unit test).
- Given a thread is deleted, or its project is removed, when the prefs are next saved, then `pruned()` drops its `threadTags` entry, and the project's `threadTagLists` entry with it (unit test on `pruned()`).
- Given 5 threads across 2 branches, 3 tagged `blkwtr` (one of them archived) and 1 tagged `hoam`, when `filterThreads(threads, prefs, "blkwtr")` runs, then it returns exactly the 3 `blkwtr` threads. Given no active tag, then it returns all 5. Given a tag that no thread carries, then it returns none (unit test).
- Given a search typed and a chip on, then a row shows only when it matches both (unit test on the combined match).
- Given the sandbox with a project holding 4 threads, when I add tags `blkwtr` and `hoam` from "Edit tags…" and tag 2 threads `blkwtr` and 1 `hoam` from their "Tags…" menu item, then the chips read `#blkwtr 2` and `#hoam 1`. Clicking `#blkwtr` shows only those 2 threads, across their branches. Clicking it again shows all 4 (manual check against the sandbox `scripts/sandbox.sh app`).
- Given a chip whose tag no thread carries, when it's clicked, then the list says "No threads tagged #<tag>" with a "Show all" button that clears the chip. Given I switch projects and come back, then no chip is on (manual check against the sandbox `scripts/sandbox.sh app`).
- Given the app is restarted, then the project's tags and every thread's tags are still there (manual check against the sandbox `scripts/sandbox.sh app`).

Status: done. Not yet checked by hand in the sandbox: the chip counts and filter, the "No threads tagged" message, and tags surviving a restart.

### S16: A tagging prompt for untagged threads
As a user, I want a cheap headless model to read each untagged thread's title, first prompt and files touched and pick tags from the project's list, so that new threads land under the right client without my tagging each one, and my own tags are never changed.
Notes: new `src/nebula/tagging.ts` (pure: picks which threads to send, builds the prompt, parses the reply, applies it) with tests in `tests/tagging.test.mjs`, and `src/nebula/taggingRunner.ts`, which wires it to the store on a timer like `batchRunner.ts` (every 10 minutes, and once when the app connects). The CLI is a new `tagCommand` pref in `DesktopPrefs` (`theme.ts`), set in `src/components/Settings.tsx` beside `routerCommand`. It has no default: empty means off. It runs headless through the runner in `src-tauri/src/router.rs`, by a new `tag_threads` command beside `route_list` that reads `tagCommand` instead of `routerCommand`. `run()` stays as it is, but its messages stop naming the router ("to route the list"). The webview calls it through `src/nebula/client.ts`, the way it calls `route_list`. Per thread, the prompt holds its id, its title (`agent.name`), its first prompt (`recent_prompts[0]`, clipped to 1,000 characters), and up to 30 files it touched, relative to the repo, from the `thread_edits` command (`src-tauri/src/thread_edits.rs`). The project's tag list goes in once per call, and threads go in batches of up to 20 per call. The reply asked for is `{"threads":[{"id":"…","tags":["…"]}]}`. Tags the prompt sets are stored as `{tags, by: "prompt", at}`, so they show like hand tags, and changing one from the menu makes it `by: "you"`. A thread the prompt gave no tag is stored as `{tags: [], by: "prompt", at, list}` (`list` a short key of the tag list it was asked against), so it isn't sent again until the project's tags change. The chips row also gets a "Tag untagged" button that runs a pass for this project now, and a pass's error shows in the notice line (`flash`).
Acceptance criteria:
- Given a project with tags and 6 threads, of which 2 are tagged by hand, 1 is tagged by the prompt, 1 is cleared by hand (`{tags: [], by: "you"}`) and 2 have no record, when `toTag()` runs, then only the 2 with no record are returned (unit test).
- Given a thread the prompt already gave no tag against the current tag list, then `toTag()` leaves it out. Given a tag has since been added to the project, then it's returned again (unit test).
- Given `tagCommand` is empty or unset, then no pass runs and `tag_threads` is never called. Given the project's tag list is empty, then no call is made for that project. Given no thread needs tagging, then no call is made (unit test on the runner's decision with a stubbed invoke).
- Given threads to tag, when `buildTagPrompt()` runs, then it holds the project's tags and, per thread, its id, title, first prompt clipped to 1,000 characters and at most 30 file paths. Given 45 threads, then they go in 3 calls of at most 20 (unit test on the prompt's contents and batching).
- Given a reply fixture that gives thread A `["blkwtr", "#HOAM"]` and thread B `["acme"]` when the project's list is `["blkwtr", "hoam"]`, when `parseTagReply()` runs, then A gets `["blkwtr", "hoam"]` (cleaned with `cleanTag()`) and B gets no tags, since `acme` isn't in the list. Given an id that wasn't sent, then it's ignored (unit test).
- Given a reply that isn't JSON, or has no `threads` array, then `parseTagReply()` returns one error and no thread's record changes (unit test).
- Given a thread tagged by hand while its pass was running, when the reply lands with tags for it, then `applyTagReply()` leaves its hand tags as they are (unit test).
- Given a thread the prompt tagged `hoam`, when I change its tags from its "Tags…" menu, then its record becomes `by: "you"`, and later passes don't send it (unit test).
- Given `tagCommand` is `sh -c 'cat >/dev/null; echo "{\"threads\":[]}"'`, when `tag_threads` runs, then it returns that JSON. Given it's empty, then it returns "No tagging command is set" without running anything (Rust test in `router.rs`).
- Given the sandbox project from S15 with 2 untagged threads, one whose first prompt names blkwtr and one about hoam, and `tagCommand` set to `claude -p --model haiku --no-session-persistence`, when I press "Tag untagged", then each gets the matching chip's tag, the chip counts go up by one each, and the threads I tagged by hand are unchanged (manual check against the sandbox `scripts/sandbox.sh app`).
- Given `tagCommand` is set to `codex exec`, when a pass runs, then the tags come back the same way (manual check against the sandbox `scripts/sandbox.sh app`).

Status: done. Not yet checked by hand in the sandbox: "Tag untagged" with claude -p --model haiku, and a pass with codex exec.
