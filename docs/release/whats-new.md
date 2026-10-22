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

### See where an agent's dev server is running

When an agent starts a dev server itself, its address now shows on the thread's row and above its terminal, as it already did for **Start**. No more scrolling back through the chat for `localhost:5173`. Only addresses that answer are shown, newest first, and one that stops goes grey.

### Hop between your last few projects

A **Recent** panel above Projects lists the ones you were just in, newest first, with their badges. Click to switch; pick 3, 5 or 7 from its heading.

<img src="docs/release/recent.jpg" width="250" alt="The Recent panel: billing-api, marketing-site with one waiting, and admin-dashboard, above the project list">

### Page through a long terminal

**⌘↑ / ⌘↓** move a page at a time through a terminal's output, and **⇧⌘↑ / ⇧⌘↓** jump to either end. While you're scrolled up, **Jump to latest** takes you back. The scrollbar is a thin pill again, and a terminal holding a big block of wrapped output stays responsive.

### Restart a nebula that's stuck

If an older nebula is still running but the app can't reach it, the start screen now says so and offers **Restart nebula**, telling you first how many sessions a restart ends. Before, **Start nebula** just flipped back with nothing said.

### And a few smaller things

- The icon picker offers the project's own logos and icons, and **Choose image…** opens in the project's folder.
- Quick capture's yellow button saves what you typed as an idea, and says where it goes.
- The Ideas card stays in the sidebar when there are none.
- An optional usage log (Settings › General) and **⇧⌘M** to mark a moment: they save what the app was doing, on your Mac only, so a rough spot is easy to report.
