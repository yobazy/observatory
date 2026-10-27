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

### Stay in the Read view

The Read view now does most of what you'd go to the terminal for. Say or type `2 a, 3 b` and those options light up on the card. Decisions you haven't answered wait in a tray above the reply box, and **Other…** takes an answer in your own words. Select part of a reply and click **Reply about this** to quote just that part, or **Copy** it. A "New since you were here" line marks where you left off, and older turns fold away. **⌘F** searches the thread, and **⌘↑**/**⌘↓** jump between your messages. Edits show a **Diff**, and a failed step shows the end of its output. The view also keeps up on its own now: a reply that lands just as the thread finishes shows up without switching to the terminal and back.

### Close a thread in one click

When an agent ends a reply with **✅ Safe to close**, a **Close thread** button appears in the header and at the foot of the reply. Clicking it archives the thread and takes you back to the thread you had open before, with **Undo** in case you didn't mean it. **🟠 Keep open** and **🔴 Don't close** show their reason in the header instead.

### Tags and priorities

Tag threads from their menu, then tap a tag's chip above a project's list to see only those threads. **Tag untagged** asks an agent to tag the rest from the project's own tags. Right-click a thread or project and choose **Priority…**, or press **P** on a selected thread: urgent and high go to the top of their list, low to the bottom.

### See your scheduled jobs

A new **Automations** view lists your launchd jobs with when each last ran and its schedule, and flags jobs that are stale or failing. A health dot in the footer shows when something needs a look. Run a job now, or open its log.

### Watch videos a reply names

A reply that names a `.mp4`, `.mov` or `.webm` file shows a player right in the Read view, and the preview plays it too.

### And smaller things

- Start a task straight from a marked moment (**⇧⌘M**), in the project you pick, without leaving what you're doing.
- **Open** in the preview and Files menus opens any file in its default app, not just pages in the browser.
- Paths with spaces in the terminal are clickable, even when the line wraps at a space.
