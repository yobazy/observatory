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
- Given a batch of 5 tasks where 4 finish and 1 is needs_feedback, when the last one settles, then exactly one notification fires with the text "4 done, 1 needs you", and no per-task notification fires for batch sessions (unit test on `batchSummary()` and the notification suppression check).
- Given `you` tasks, then they appear as rows with a checkbox, and checking them off persists across reloads (manual check plus unit test on storage).

Status: todo
