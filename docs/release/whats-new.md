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

### Answers to a sleeping thread get sent

A thread goes to sleep after it's been idle for a while. If you answered one from the Read view, your reply stayed stuck at "Queued, sent when its turn ends", even though its turn was already over. Now the thread you're looking at wakes up and takes the reply. Sleeping threads you aren't looking at still wait until you open them.

### Tables you can read

Tables in the Read view now wrap at whole words instead of breaking them, scroll sideways when they're wide, and have columns you can drag to resize.
