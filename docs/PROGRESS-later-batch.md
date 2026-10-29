# Later batch: files and rows

Branch `later-batch-files-and-rows`, from `origin/main` (f6c25fd). Six "wanted, set aside" items
from LATER.md, one commit each (plus one fix from the self-review), each taken off LATER.md
when done. Draft PR: https://github.com/yobazy/observatory/pull/102

## Done

1. **Send a file to the agent from the Files list** (47207f1, fffbd17). Right-click a chip, or
   a row in All (its ⋯ menu too): **Send to <thread>**. The path goes where the thread reads
   next (`fileTarget` in `src/nebula/drafts.ts`):
   - Read view up: into the reply box, focused, cursor at the end.
   - A prompt queued for its next turn: added to the end of the last one.
   - Otherwise: pasted (bracketed, no Enter) into its prompt line in the terminal, like a
     dropped file.
   - Asleep, or waiting on you: into the reply box (switching to the Read view), since typing
     into the terminal would wake it or could answer its menu. Waiting with no readable log:
     refused, with a line saying to answer first.
   The Read view's drafts moved out of `Reader.tsx` into `drafts.ts` so the Files list can add
   to them.
2. **Pin a file on a task's shelf** (87bc193). Right-click → **Pin to the front** / **Unpin**.
   Pinned chips show a pin in place of the kind mark and an accent edge; they stay first, never
   get dropped to make room, and **Clear the shelf** keeps them (it reads **Clear all but
   pinned** then). × still removes a pinned file.
3. **Open several files at once** (19332d5). In All: a pick box on each row (on hover, and on
   every row once one is picked), ⌘-click a row to pick it, Shift-click picks a run. The footer
   turns into **N files picked · Unpick · Open N as tabs**. They open as preview tabs in list
   order, the first in front, each keeping the session it came from (for comments).
4. **Files most recent first** (e39d6f8). The chips and each All section sort by when a file
   was last shown or opened, pinned first. "Shown" counts a file landing on the shelf for the
   first time and an agent's `nebula open` of it; "opened" is any open in the preview (kept in
   localStorage, last 200 files). A terminal rescan that finds a file already there changes
   nothing, so the row still doesn't reshuffle on rescans. Pure logic in `src/nebula/shelfList.ts`.
5. **Drag projects onto folders, out of them, and drag folders** (a840091). `useReorder` takes
   an optional `DropInto`: held over another `data-drop-into` group, the item drops there
   instead of reordering. A folder's whole section is a target (its heading lights up); the
   loose list is the target for taking one out (it keeps a drop area even when every project
   is in a folder). Folders drag by their heading, and ⌥↑/⌥↓ on a heading moves it too. The
   folder menu's Move up/down stays.
6. **A picked color fills the row** (0b80748). Project rows in the sidebar and task rows in the
   list are a solid fill of their color in both themes, with hover and selected shades, and a
   ring when selected. The row redefines `--text`, `--muted`, `--faint` and `--line` for what's
   on it; badges and spectrum segments get an edge; the spinner, flag, safe mark and
   waiting time take the row's text color. `tests/rowcolor.test.mjs` reads the declarations
   from styles.css and checks contrast for all 8 picker colors on fill, hover and selected, in
   both themes (names and details ≥ 4.5:1, times ≥ 3:1, ring ≥ 2.5:1). It caught dark orange
   and yellow below 4.5 in a first pass; the dark fills went down to 25 to 30% lightness.

## Decisions

- Send's path is shell-quoted (as a dropped file is), so a path with spaces stays one path.
- A pinned file stays pinned through Clear; only × or Unpin take it off.
- Dropping a project into a folder puts it at the folder's end (Move to folder does the same).
- Opening a chip now moves it to the front of the row (that's "most recent first" applied to
  opens). Clicking a chip far right will make the row shift; it's what the note asked for.
- Black mode uses the dark fills.
- The `UPPERCASE` section headings in the Files panel and "Needs you" card are existing styles;
  left alone.

## Checks

- `npm run build`: passes.
- `npm test`: 282 pass, 10 fail. The 10 are all `tests/automations.test.mjs` and fail on main
  too on this Linux box: they shell out to macOS `plutil` (`spawnSync plutil ENOENT`).
- Rust: no changes under `src-tauri/` on this branch. `cargo` isn't on this session's PATH
  and running it directly needed approval, so `cargo fmt/clippy/test` weren't run here; CI
  runs them.
- Self-review of `git diff origin/main...HEAD`: found that a file sent to a thread waiting on
  a permission menu would be pasted into the menu; fixed (fffbd17). Also made the queued-prompt
  edit fall back if the prompt was sent in the meantime.

## Try it

```sh
npm ci
npm run dev            # browser preview with demo data
npm run build && npm test
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
```

In the preview: open storefront → Sequential Cart Sync. Its Files row has the demo's mockups.
Right-click a chip (send, pin), open **All** (⌘-click rows, Open N as tabs). Make two folders
from the Projects heading and drag projects onto them. Give projects and tasks colors from
their right-click menus, and flip Settings › Appearance between dark and light.

## Screenshots

All in `/data/tmp/overnight-2026-10-28/observatory/` (browser preview, demo data, Playwright):

- 1: `1-send-menu.png`, `1-send-after.png` (waiting thread: to the reply box),
  `1-send-reply-dark.png` (idle thread in the Read view)
- 2: `2-pin-dark.png`
- 3: `3-pick-dark.png`, `3-pick-light.png`, `3-tabs-dark.png`, `3-tabs-light.png`
- 4: `4-recent-before-dark.png`, `4-recent-after-dark.png`
- 5: `5-folders-before-{dark,light}.png`, `5-drag-onto-folder-{dark,light}.png`,
  `5-drag-out-{dark,light}.png`, `5-drag-folder-{dark,light}.png`,
  `5-folders-after-{dark,light}.png`
- 6: `6-colors-before-{dark,light}.png`, `6-colors-after-{dark,light}.png`

## Left

- Nothing from the six is half-done. Not checked in the real Tauri app on a Mac (no Mac
  window here): drag and drop, the pick box, and the fills were seen only in the browser
  preview.
- No vault note: this run was limited to the repo and the scratch dir.

## Needs Bazil

1. Run the app (`scripts/sandbox.sh app`) and try the folder drags and the colored rows on the
   Mac; the preview can't show WebKit's rendering.
2. Say if opening a chip should move it to the front (item 4 as written) or only `nebula open`
   should.
3. Run `cargo fmt/clippy/test` (or let CI), since they couldn't run in this session.

## Review pass 2026-10-29

An independent read of the whole batch (`git diff origin/main...0e51a16`) against the brief, by
a run that didn't write it. #102 had already been squash-merged (8f9bbd3) and its branch
deleted by then, so the two fixes below sit on current main under the same branch name, in a
new draft PR: https://github.com/yobazy/observatory/pull/118

### Confirmed and fixed

1. **A full shelf dropped the file you'd just opened** (33022fa).
   The row sorts by when a file was last shown *or opened*, but making room for a new file
   dropped the oldest by *shown* time only. A file shown long ago and opened a minute ago sat
   first in the row and was the one thrown out. Reproduced with `shelve` (keep 2: y shown at 5,
   x shown at 1 and opened at 100, z arrives: x went). Now `shelve` ranks by the same
   `lastTouched` the row uses; `addToShelf` passes `fileOpened`. Test: "making room drops the
   file least recently shown or opened" in `tests/shelf.test.mjs`.
2. **Send didn't add a path that a longer one in the reply starts with.** `withPath` checked
   `text.includes(path)`, so sending `/r/a.html` to a reply that said `/r/a.html.bak` changed
   nothing, while the flash still said "Added". Now only the whole path, between spaces or the
   ends, counts as there already (49d1f49). Tests added to `tests/drafts.test.mjs` (also covers a quoted
   path with a space).

### Looked at and left

- Sending to a thread that's asleep and has no readable log goes to its terminal, not the reply
  box as the "Done" list says (the box needs a log). Dropping a file on that terminal does the
  same, and an error is flashed, so I left it; the notes line is a little broader than the code.
- `sendFile` decides "reading" from `hasLog` alone, while the pane also shows the Read view for
  a stand-in transcript (`useStandIn`). With a stand-in and no log, the path goes to the
  terminal while the Read view is up. Rare, and which way is right depends on what a stand-in
  is for, so not changed.
- Pinned chips sort among themselves by recency, not in the order they were pinned (`pin`
  puts a new pin at the end of the pinned, `byRecent` then reorders them). Matches "pinned
  first, most recent first"; not a bug.
- Opening picked files that are already open as tabs leaves those tabs where they were, so the
  tabs aren't strictly in list order then. The first picked file is still put in front.
- Drag and drop: the drop group under the pointer works because the held row has
  `pointer-events: none`; folders drag only by their heading, and the projects inside keep
  their own drag. Checked by reading; not driven again (no Mac, and the earlier run's
  Playwright screenshots cover it).
- `tests/rowcolor.test.mjs` really reads the declarations from `styles.css` (`--pc` is a bare
  hue, as the test assumes) and the light block inherits only `--text`/`--amber`, which point at
  the redefined `--on-fill`. Passes for the right reason.
- Notes' claims checked true: 282 pass / 10 fail, the 10 all `tests/automations.test.mjs` with
  `spawnSync plutil ENOENT`; no changes under `src-tauri/`; the six LATER.md lines removed.

### Checks run

- `npm ci && npm run build`: passes.
- `npm test`: on the old branch head plus the fixes, 283 pass, 10 fail; on current main plus
  the fixes, 294 pass, 10 fail. The 10 are the same `plutil` tests (macOS only).
- Rust: still not run. Only `rustup` is in `~/.cargo/bin` on this box, and running it (or
  cargo) needed an approval this unattended session can't give. Nothing under `src-tauri/`
  changed, and CI runs them.

### Left

- The two "Looked at and left" items about where Send goes, if Bazil wants them changed.
- Rust checks on a machine where cargo runs (or CI).

### Needs Bazil (review pass)

1. Sending a file to an asleep thread with no log: terminal (as now, like a dropped file) or
   refuse with a line? Same question for a stand-in Read view with no log.
