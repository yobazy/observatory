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

### A new look: Night watch

Observatory is night blue now, with ivory text and names set in Bricolage Grotesque. Light mode is the same design by day, with ivory pages and ink-blue text. The terminal follows whichever mode you're in.

### Sand plates show what each thread is doing

Every thread's status dot is now a small plate of sand. Each prompt or tool step moves the sand into a new figure: a working thread's plate keeps shifting, a waiting one holds and pulses, and finished ones settle. A larger plate tops the Read view, and each project gets its own as an emblem.

### The Live strip

A row of lenses under the pane header shows every thread that's working, waiting on you or unread, across all your projects. Click one to open that thread.

### And a smaller thing

- In dark mode the terminal no longer gets stuck on the light theme.
