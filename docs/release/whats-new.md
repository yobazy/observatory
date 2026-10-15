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

### Answer a session without hunting for its terminal

When a session asks permission, its choices sit above the terminal as buttons. Click one and it's answered.

<img src="docs/release/answer.jpg" width="880" alt="A session waiting on an edit, with Yes, Yes and don't ask again, and No as buttons above its terminal">

### See what a turn did at a glance

Each Claude and Codex thread has one line above its terminal: whether the tests passed, which files it edited, whether it committed. Click it to see what you asked, every file it changed, and the agent's last words. It's built from what the agent actually ran, not from what it says it did.

<img src="docs/release/turn.jpg" width="880" alt="A finished turn's line opened: the prompt, the two files it changed, and Claude's last words">

### Read a session as a conversation

Switch a thread from **Terminal** to **Read**. You get the replies as text, each run of tool calls folded into one line, and a reply box at the bottom.

<img src="docs/release/reader.jpg" width="880" alt="A session in the reader: the prompt, Claude's replies with a code block, and folded tool calls">

### Come back to what finished

<img src="docs/release/away.jpg" width="255" align="right" alt="The sidebar: two sessions waiting on you, and two that finished while you were away">

Step away for ten minutes or more, and the sidebar lists what finished while you were gone, each with a line on what it did. Whatever is waiting on you stays above it, and notifications now say what a session is asking, or what its turn did.

Working agents stay quiet in the sidebar, so the ones that need you stand out.

<br clear="right">

### A terminal font you'll want to read

Pick from eleven fonts in Settings → Appearance, each shown with the same session text, at your size and spacing. They come with the app, so they look the same on every Mac. IBM Plex Mono is the new default, and ⌘+ and ⌘− resize the text.

<img src="docs/release/fonts.jpg" width="880" alt="The font picker in Settings, with IBM Plex Mono, JetBrains Mono, SF Mono, Menlo and others side by side">

### Dispatch your to-do list

Press ⇧⌘N and paste a to-do list. Observatory proposes which project each item goes to. You edit the plan, then it starts the agents a few at a time and tracks them on one board.

### Also new

- **Merge** a pull request whose checks pass, right from its branch, then clean up the checkout in the next step.
- Uncommitted work is listed under the thread that left it.
- **Review changes** on a finished turn, and your comments go back to that thread.
- Web addresses in a terminal open with a click.
- An agent can hand a task to another project with an `observatory://` link.
- A newer nebula that still speaks this version's protocol is fine: Observatory offers to start it instead of asking you to update.
