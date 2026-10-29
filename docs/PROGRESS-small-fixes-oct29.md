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

## Notes

- On `pc` (Linux), 10 tests in `tests/automations.test.mjs` fail before any change: they shell out to
  macOS `plutil`. Everything else passes.
