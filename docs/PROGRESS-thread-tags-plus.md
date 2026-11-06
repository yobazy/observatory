# Thread tags, beyond S15 and S16

Branch `thread-tags-plus` (local `ov/f-obs-tags`), from `origin/main` (4c5095d). Draft PR: https://github.com/yobazy/observatory/pull/120 The LATER.md
item "Thread tags, beyond S15 and S16", built in four parts. This was an overnight run with
nobody to ask, so the calls I made are listed under Decisions.

## Plan

1. Several chips on at once (Sessions' chip state becomes a list).
2. Tag colors: a color per tag, per project, picked in the tag list editor. Chips, the Tags
   dialog and the thread rows show it.
3. Tag several picked threads at once: "Tags…" in the multi-select menu and on the pick bar,
   with a checkbox per tag that reads on, off or mixed.
4. A tag filter across projects: `#tag` in ⌘K lists every project's threads carrying it, and
   the sidebar's tag chips and `#tag` filter also find projects whose threads carry it. A
   project opened while that filter is on opens with the tag's chip on.

## Decisions

- **Several chips narrow (AND).** A row shows only when its thread carries every chip that's
  on, the same as search words. Two client tags on at once show nothing, and the empty line
  then says "No threads tagged #a and #b". OR is a small change (`hasTag` in `threadtags.ts`)
  if it reads wrong in use. Bazil confirmed AND on 2026-10-30 (decision 34A).
- **Colors are per project**, like the tag lists (`threadTagColors[repo][tag]`), using the
  same eight colors as projects and tasks. A rename carries the color. When the rename merges
  into a tag that already has a color, that color wins. Delete drops it, and `pruned()` drops
  a removed project's entry. Rows show a small dot per tag, gray when it has no color, with
  the names in the tooltip (no text, to keep rows short).
- **Tagging picked threads** uses the same Tags dialog with a list of threads. A mixed box
  tags all of them when clicked. Every touched thread is stored `by: "you"`, so the tagging
  prompt leaves it alone, as S15 does for one thread. The dialog only acts on picks in the
  first pick's project (picks come from one project's list anyway).
- **Across projects, only live threads count** (not archived ones), the same as the sidebar's
  counts and ⌘K's task list.
- **The sidebar's `#tag` filter is the cross-project filter.** It's mirrored into a new store
  field `tagFilter`, and ⌘K's "Threads tagged #x, in every project" sets it, shows the
  sidebar and opens a project that has the tag (it stays in the open one if that one has it).
  Hiding the sidebar clears it, so no chip turns on where you can't see why. The sidebar's
  tag chips now include thread tags beside project tags. `#tag` matches both, by prefix, as
  before.
- **S15's reset still holds:** with no `#tag` filter, switching projects and coming back
  clears the chips.
- Small extra: archived threads' menu now has "Tags…" (the LATER.md item about it is gone too).
- `src/nebula/types.ts` and Rust are untouched; these are app-side prefs.

## Done

- `src/nebula/threadtags.ts`: `toggleChip`, `hasTag`/`filterThreads`/`threadShows` take a
  list, `tagColor`/`setTagColor` (rename/delete carry them), `tagThreads`/`tagShare`,
  `carriedTags`, `threadAnswersTag`, `chipFor`.
- `folders.ts`: `allTags` and `matches` take the tags a project's threads carry.
- `prune.ts`, `theme.ts` (`threadTagColors`), `organize.ts` (`tagPicked`, `setThreadTagColor`),
  `store.ts` (`tagFilter`).
- UI: `Organize.tsx` (`TagChip`, `TagDot`, `TagMarks`, the multi-thread `ThreadTagsDialog`, the
  color picker in `TagListRow`), `Sessions.tsx`, `RowMenu.tsx`, `Sidebar.tsx`, `Palette.tsx`,
  `App.tsx` (`showProjects`), `styles.css`.
- Tests: 5 new in `tests/threadtags.test.mjs`, 1 in `tests/folders.test.mjs`, existing ones
  moved to chip lists. `npm run build` passes. `npm test`: 299 pass, and 10 fail, all in
  `automations.test.mjs`, because they need macOS `plutil`. They fail the same way on main on
  this Linux box.
- LATER.md: removed the "beyond S15 and S16" item and the archived-menu item. SPEC.md has a
  short entry under S16.

## Left

- ~~No screenshots.~~ Taken 2026-10-30 (see below). Originally: this box has no Playwright browser, and downloading one
  (`npx playwright install chromium-headless-shell`) needed an approval nobody could give
  overnight. The full sandbox would build the Tauri app in a shared dir outside the worktree,
  which this run's rules don't allow. A ready Playwright check is at
  `/data/tmp/overnight-2026-10-29/scratch/f-obs-tags/shots.mjs`. It seeds tags into the
  preview's demo data, walks all four features with 20 assertions, and saves light and dark
  PNGs. I haven't run it yet, so its selectors may need a tweak on the first run.

## Try it

```sh
npm run build && npx vite preview --port 4377 --strictPort   # browser preview, demo data
# once a Playwright browser is installed:
node /data/tmp/overnight-2026-10-29/scratch/f-obs-tags/shots.mjs "$PWD" 4377
```

By hand in the preview or the sandbox (`scripts/sandbox.sh app`):

1. Storefront → Edit tags… → add `blkwtr`, `logo`, `hoam`. Click the round button left of a
   tag to give it a color.
2. ⌘-click three threads → **Tags…** on the pick bar (or right-click → "Tags on 3 tasks…").
   Tick `blkwtr`. Untick it on one thread, then reopen: the box reads mixed.
3. Turn on `#blkwtr` and then `#logo`: only threads carrying both show.
4. Tag a thread in another project `blkwtr`. ⌘K → type `#blk` → pick "Threads tagged #blkwtr,
   in every project". The sidebar reads `#blkwtr` and lists only those projects, and opening
   one shows its `#blkwtr` chip on. Esc in the sidebar filter clears it.

## Decisions applied 2026-10-30

- **Decision 34A (several chips: a thread must have all of them). No code change.** This branch
  already does that. `hasTag` in `src/nebula/threadtags.ts` checks
  `active.every(...)`, and `threadShows` and `filterThreads` both go through it. The unit test
  "several chips on at once show only the threads carrying every one" in
  `tests/threadtags.test.mjs` covers it, and the browser run below checks it in the UI:
  `#blkwtr` alone shows 3 threads, adding `#logo` narrows to the 2 carrying both, and adding
  `#hoam` shows "No threads tagged #blkwtr and #logo and #hoam".
- **Decision 3A (sentence case, no all-caps letter-spaced labels).** The branch adds no
  `text-transform: uppercase` or `letter-spacing` to `styles.css`, and its new labels ("Tags on
  3 threads", "Edit tags…", "Tag untagged", "Threads tagged #x, in every project") are in
  sentence case. Nothing to change.
- **Screenshots, taken.** `npx playwright install chromium` fetched the headless shell
  Playwright 1.57 wants (build 1200). The script from last night is now at
  `/data/tmp/overnight-2026-10-30/scratch/obs-120/shots.mjs`, with one fix: `shot()` blurs
  focus, so the Enter that picks the ⌘K row went nowhere. It now focuses the palette input
  again first, and that was a bug in the script, not in the app. All 20 checks pass in dark
  and light. The shots are in `/data/tmp/overnight-2026-10-30/scratch/obs-120/`: `1-two-chips`,
  `1b-no-match`, `2-tag-colors`, `3-tag-picked`, `4-palette-tag` and `5-sidebar-tag`, each as
  `-light.png` and `-dark.png`.
- **Checks run:** `npm run build` passes. `npm test`: 299 pass and 10 fail, the same
  `automations.test.mjs` ones as before (they need macOS `plutil`). Rust is untouched, so I
  didn't run cargo.
- **Self-review** of `git diff origin/main...HEAD` (filter, colors, multi-tag, cross-project
  parts) found no bugs. One thing to notice in use: a chip's count is how many threads carry
  that tag, not how many would still show if you added it to the chips already on. So with
  `#blkwtr` and `#logo` on, `#hoam 1` still reads 1, though turning it on shows nothing. I left
  it as it is (Needs Bazil 1).

## Needs Bazil

1. With AND, should a chip's count show how many threads would remain if you added it (so
   `#hoam` would read 0 while `#blkwtr` and `#logo` are on)? It's a small change.
2. Look over the screenshots (above) for the colored chips and row dots in light and dark.
3. Try the ⌘K tag pick and the sidebar `#tag` in the sandbox. The PR is a draft for that.
