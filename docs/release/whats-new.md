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

### See what's running in your projects

Activity (⌥⌘U, or the pulse button in the sidebar's footer) shows every process running in your projects: what it is, its CPU and memory, how long it's been going, and the ports it serves, as links. Each project is one row with a bar for its share and a line of its recent CPU; open it to see its processes. Ones nothing started, like a dev server or a test browser an agent left behind, are marked "left running", and you can stop them from here. A project using a lot gets a small meter in the sidebar.

<img src="docs/release/activity.jpg" width="880" alt="The Activity view: billing-api at 110% CPU with two processes left running, storefront serving :5173, marketing-site opened to its node and claude processes">

### Folders, names and tags for your projects

<img src="docs/release/folders.jpg" width="252" align="right" alt="The sidebar's projects: a Clients folder holding billing-api and admin-dashboard, storefront tagged #work, and tag chips above the list">

Put projects in folders, from a project's right-click menu or the New folder button beside Projects. A folder folds away and still shows what inside needs you. Give a project a name of your own, shown everywhere in Observatory, and tags. Tag chips above the list filter by one, and the filter box finds a project by its name, its real name, its folder or a tag.

<br clear="right">

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

### Every file a task showed you

The Files row above a thread's terminal has an All list: each file it showed, with its folder and when, the files other sessions on the branch showed, and the ones its last turn changed. Open one here, in your editor or in Finder, or copy its path.

<img src="docs/release/files.jpg" width="880" alt="The Files list open over a terminal: two files shown in this session and two changed in the last turn">

### Dispatch your to-do list

Press ⇧⌘N and paste a to-do list. Observatory proposes which project each item goes to. You edit the plan, then it starts the agents a few at a time and tracks them on one board.

### Also new

- The sidebar scrolls as one, so long lists never push your projects out of reach; "While you were away" and "Follow up" show three tasks, then Show all.
- Hiding the sidebar (⌘B) or a project's tasks (⌥⌘B) slides them away.
- Hover anything in the sidebar to see what it is.
- The summary above a terminal can be hidden, and Summary in the header brings it back.
- The sidebar cat stargazes through a telescope, catches falling stars, grooms and stretches.
- **Merge** a pull request whose checks pass, right from its branch, then clean up the checkout in the next step.
- Uncommitted work is listed under the thread that left it.
- **Review changes** on a finished turn, and your comments go back to that thread.
- Web addresses in a terminal open with a click.
- An agent can hand a task to another project with an `observatory://` link.
- A newer nebula that still speaks this version's protocol is fine: Observatory offers to start it instead of asking you to update.
