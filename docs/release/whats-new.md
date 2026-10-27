<!--
  The top of the next GitHub release page, under the download button:
  what's worth trying in this version, in a reader's words. Rewrite it for
  every release; scripts/release.sh won't build one while it's unchanged
  since the last tag. docs/release/cover.jpg leads the page, so retake it
  when the app looks different; a highlight gets its own picture when one
  helps, and can go without. Images are paths in this repo
  (docs/release/…), loaded from the release's own tag, so each release
  keeps the pictures of what it shipped. The full list of commits goes
  underneath on its own.
-->

### Works with nebula 0.45

This version talks to nebula 0.45.0. If yours is older, the start screen offers **Update nebula to 0.45.0**. The daemon that's running keeps the old version until it restarts, so run `nebula kill` once your agents are idle. With 0.45, **Locate…** follows a project folder you've moved instead of saying it can't yet.

### Answer a reply without typing

Replies written as cards (a bold headline, status dots, a **Needs you** list, folded **Details**) now read as cards. Lettered options are buttons that build `1 A, 2 B` in the reply box, and when there's a recommended answer the empty box suggests it and **Tab** takes it. **Enter** sends and **⇧↵** adds a line. A card you've answered keeps a ✓ on what you sent.

### Go back to the thread you were just in

**⌘[** returns to the thread you had open before this one, and **⌘K** lists your recent threads before you type. Archiving a thread now lands you on the one before it instead of an empty pane.

### Write an idea down with ⌘I

**⌘I** opens a small **New idea** box over whatever you're doing: type, pick a project if it isn't the one you're in, and **↵** saves it. The full Ideas view moves to **⇧⌘I**.

### And a smaller thing

- The project you're in stays in **Recent**, highlighted, so the list doesn't reshuffle every time you switch.
