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

### The Read view keeps up with the whole thread

When an agent asks you questions one step at a time, the Read view shows each question with its choices, so you can answer it there. A command you run yourself with `! cmd` shows **Running…** while it works, then stays in the thread as a step with what it printed. You can keep talking to a thread while its subagents are still working. A finished reply can offer a few next prompts to send in one click (off by default; turn it on under Settings → Next-prompt suggestions).

### Tags that do more

Turn on several tag chips at once to narrow the list. Give each tag a color, tag many picked threads at once with **Tags…**, and type `#tag` in ⌘K to find threads with that tag in every project.

### The night watch

In dark mode the sky changes through the night. A thread's sand plate fills in as its turns add up and warms the longer it waits. The Dock icon shows the plate of the thread that has waited longest. Projects with no icon get a sand plate of their own, and archived threads show as a grid of plates.

### And smaller things

- The preview shows every page of a PDF, with a page count and zoom.
- A thread waiting on pull requests says **#N merged since** once they land.
- Mark a draft pull request ready with one click from its branch.
- Text you typed in the terminal and didn't send moves into the Read view's reply box.
- Decisions stays open after you send an answer.
- Follow up lists the newest flags first, and its header flips the order.
- A prompt queued in the Read view no longer gets stuck behind a finished turn, and **Send now** sends it at once.
- Long project names shrink to fit and end in an ellipsis.
- A long archive opens without freezing the window.
