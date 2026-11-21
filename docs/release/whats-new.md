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

### Notes on a picture

Zoom into a picture in the preview and drag it around to look closer. Comment pins numbered notes on spots in it, so you can point at exactly what you mean.

### Your lead, in its own window

A project's lead now opens in its own window from the project card, and the card itself is tidier. Settings › Leads sets each lead up.

### Threads that tell the truth

A thread that says something is still running gets checked in on every 30 minutes, so it doesn't sit there quietly. A turn that ended without telling nebula now shows as done instead of running forever, and a run started on the PC shows as running in Decisions, not as waiting on you.

### And smaller things

- New replies fade in word by word, in the Read view and the lead chat.
- Delete a worktree from its branch header, even when it has no tasks.
- The preview no longer opens files outside a project through `..` in a path.
- Tasks a lead starts at the same moment each get their own id.
- A thread's stuck flag stays when one of its turns can't be read.
