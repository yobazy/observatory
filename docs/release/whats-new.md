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

### Zoom into pictures

Click a picture in the preview to zoom in where you clicked, and click again to fit. Pinch, ⌘-scroll, **+** and **−** zoom too, and **0** fits. A bar under the picture shows **‹ 2 of 5 ›** and steps through the files you have open.

### Answer more from the Read view

When an MCP server asks for input with **Accept / Decline**, the Read view shows the question and both buttons, so you no longer have to switch to the terminal. After you say **Yes** to a permission prompt, the thread shows Working while the command runs, not Waiting on you. **Catch me up** spins and says *Catching you up…* until the fresh card arrives.

### And smaller things

- Web links open in your browser instead of inside the app.
- A worktree whose folder was deleted says **The folder is gone** and offers **Remove from list**, instead of showing git's error.
- An always-on job that's running but whose log ends in an error shows **Running, with errors** in orange.
- Waiting on you uses the same calm card as While you were away and Follow up.
- A numbered list under a line like "Before you sign:" stays in place in the Read view, instead of turning into empty decisions.
