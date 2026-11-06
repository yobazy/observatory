# Small fixes, 2026-10-29 (overnight run f-obs-small)

Branch `small-fixes-oct29`, worktree `/data/tmp/overnight-2026-10-29/wt/f-obs-small`.
Draft PR: #121 small fixes (https://github.com/yobazy/observatory/pull/121). Status: all three items done.

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
  - (Changed by decision 35B, see below: a job that turns red in quiet hours now banners once they end.)
    A job that turns red during quiet hours, or while you're looking at the Automations view, is
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

## Decisions applied 2026-10-30 (run obs-121)

### Decision 35B: banner once quiet hours end

- A job that turns red in quiet hours is now held (localStorage `observatory.automations.held`)
  instead of being dropped. At the first read after quiet hours end, if it's still red, it gets
  the usual banner (several held jobs share one banner, as before). If it recovered in the
  meantime, nothing.
- If you look at the Automations view while it's held, it's dropped: you've seen it.
- Pure `redToBanner(last, jobs, { quiet, looking })` in automations.ts does this; `bannerRed` in
  automationsLoad.ts feeds it. Quiet hours are read from the saved prefs (`loadPrefs()`), so a
  launch inside quiet hours holds too, even before the store's prefs have loaded.
- `quiet.ts` gained a pure `inQuietHours(prefs, now)` (`isQuietNow` uses it) and now imports
  `./store.ts` with its extension so the Node tests can load it.
- Timing: reads run every 5 min with the view closed (and not while the window is hidden), so the
  banner comes within about 5 min of quiet hours ending, or at the next read once the window is shown.
- README's Automations line says so.
- Test, fake clock (22:00 to 08:00): "red banner: a job that turns red in quiet hours banners once
  they end, if still red" in `tests/automations.test.mjs`. It walks reads at 23:00, 02:00, 05:00,
  07:55, 08:00, 08:05 and covers a job that recovers overnight, one that's seen in the view, and no
  quiet hours set.

### Rule 3A (sentence case)

- No labels added or changed in this run; the new banner words are the existing sentence-case ones.

### Checks run (on pc)

- `npm run build && npm test`: build clean, 307 pass, 0 fail.
- `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`: clean.
- `cargo test --locked`: the same 5 `automations.rs` failures as before (macOS-only `plutil`);
  no Rust changed in this run.
- Not seen in the running app: the banner is a native notification. Try it on the Mac: set quiet
  hours to start a minute ago and end in a few minutes, make the sandbox automation exit 1
  (`scripts/sandbox.sh automations`), switch away from the Automations view, wait past the end.

### Needs Bazil

1. Try the held banner once on the Mac (native notification; can't check it on pc).
2. Still open from before: `cd src-tauri && cargo test -- --ignored router_smoke`.
