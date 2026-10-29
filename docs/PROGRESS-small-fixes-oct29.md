# Small fixes, 2026-10-29 (overnight run f-obs-small)

Branch `small-fixes-oct29`, worktree `/data/tmp/overnight-2026-10-29/wt/f-obs-small`.

## Plan

1. Dispatch dialog line reuses the board's `batchSummary`, so a plan stop says "needs you".
2. Router's `claude -p` defaults to `--no-session-persistence --tools ""`; a Settings override still wins.
3. A banner when an automation job turns red, through `notify.ts`, respecting quiet hours, only for what the view shows red.

## Done

### 1. Dispatch dialog line

- `Summary` (board.ts) gained `working` (working or launching) and `pending` counts; `text` is unchanged
  (the settle banner only fires when nothing is working, so its words can't change).
- New `dispatchedLine(summary)` in board.ts; `DispatchDialog` uses it with the queue, the same inputs
  as the board. Order: working · waiting for a slot · done · needs you · failed · blocked · on your list · cancelled.
- `batchCounts` stays for batchRunner's "Started ... Dispatch: N working, M waiting for a slot" flash:
  that line is about slots, and `occupies()` is what the caps count.
- Test: `tests/board.test.mjs` "the Dispatch dialog's line counts a session stopped at its plan...".

### 2. Router defaults

- `router.rs` `DEFAULT_COMMAND` is now `claude -p --no-session-persistence --tools ""` (the same flags
  title.rs already uses). A `routerCommand` pref still replaces it whole, run as typed.
- New `router_words()` so the default/override choice is unit tested
  (`the_default_router_saves_no_session_and_uses_no_tools`).
- Settings shows the new default as the placeholder and first suggestion; the haiku suggestion carries the
  same flags. theme.ts doc comment updated.
- Not run for real here (`router_smoke` is `#[ignore]` and calls the real CLI). Try:
  `cd src-tauri && cargo test -- --ignored router_smoke`.

### 3. Banner when an automation turns red

- Pure `turnedRed(prev, jobs)` and `redBanner(jobs)` in automations.ts; red means `toneOf(health) === "red"`
  (only `failing`), the same tone the view and footer dot use. Stale and not loaded (orange) never banner.
- `automationsLoad.ts` runs it after each read, on `jobList()` with the saved label prefixes
  (`loadPrefs()`, so a job hidden in Settings can't banner before prefs reach the store).
  The red labels are kept in localStorage (`observatory.automations.red`).
- Decisions:
  - First read ever (nothing saved) only remembers what's red: no burst of banners on first launch.
  - A job that turns red during quiet hours, or while you're looking at the Automations view, is
    remembered as red and never bannered later. It banners again only after it recovers and fails again.
    Same as budget nudges, which `notify()` drops in quiet hours.
  - Several jobs turning red in one read share one banner: "2 automations are failing", names in the body.
  - One job: "<name> is failing", body is the view's reason ("Exited with code 1").
- README's Automations line mentions the banner.
- Tests: two "red banner:" tests in `tests/automations.test.mjs`.

### Extra: automations tests on Linux

- The 10 tests that shell out to macOS `plutil` failed on `pc`. The test helper now falls back to
  Python's plistlib when `plutil` isn't there. Test-only change; on the Mac it still uses plutil.

## Checks run (on pc)

- `npm run build && npm test`: 306 pass, 0 fail.
- `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings`: clean.
- `cargo test --locked`: 84 pass, 5 fail, all in `automations.rs` (untouched here). They call
  `/usr/bin/plutil` and other macOS-only parts, so they fail on Linux before this branch too; CI runs on macOS.
  All router tests, including the new one, pass.
- Not seen in the running app: no sandbox screenshot. The dialog line needs a batch with a session
  stopped at its plan, and the banner is a native notification.

## How to try it

- Dialog line: `scripts/sandbox.sh app`, dispatch a task with a plan checkpoint, let it stop at its plan,
  reopen the Dispatch dialog: the line reads "1 needs you" (it said "1 done" before).
- Router: route a list with Settings > Dispatch > Router empty, then check no new session shows in
  `claude --resume` / the usage view.
- Banner: `scripts/sandbox.sh automations` makes a throwaway launchd job; make it exit 1, switch away from
  the Automations view, wait for the next read (30 s with the view open, 5 min otherwise).

## Needs Bazil

1. Try the red banner once on the Mac (native notification, can't check it on pc).
2. Confirm the quiet-hours call: a job that turns red in quiet hours gets no banner afterwards, only the
   footer dot. Say if you'd rather it banner once quiet hours end.
3. Run `cd src-tauri && cargo test -- --ignored router_smoke` once to confirm the real `claude` accepts
   the new default flags (title.rs already uses the same ones).
