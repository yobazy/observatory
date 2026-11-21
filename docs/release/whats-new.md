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

### Decisions, one card at a time

Decisions now shows its queue down the side with one card beside it. Pick answers as you go, then send every picked answer at once. Cards stay inside their column when you asked something long, so their summary and details stay readable.

### A dispatch board sorted by what needs you

The dispatch board sorts tasks into Needs you, To review, Running, Up next and Done, with short rows and an Undo.

### Answer and move on

In the Read view, Send & next (⌘↵) answers a thread and opens the next one waiting on you.

### Leads you can steer

Set each project lead's level in Settings, and every lead keeps to its own project. A lead's questions for you stand out in its chat with an Answer button, a line about a thread opens that thread, and each task it starts has an Open link. Messaging a sleeping lead wakes it, instead of failing after 20 seconds.

### Threads that stay put

A project's threads keep their place when they finish, wait on you or are read; only a new prompt moves one up. Threads that said ✅ Safe to close close on their own a day later. A working thread's plate hums, with a faint ring rippling out from its rim until it stops.

### And smaller things

- A moment's reviewer runs its usual review, check and merge commands without asking.
