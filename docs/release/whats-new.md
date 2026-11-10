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

### A lead for each project

Start a lead from a project's card: a thread that hears about each task as it finishes, fails, needs you or opens a pull request. It answers tasks' questions about facts and past decisions, starts tasks from a sentence, nudges threads that stall, and asks you before it merges or archives anything. A top lead sits over every project and passes questions down to the project leads. Talk to a lead as its pet, in a dialogue along the bottom of the window (⌘L). Pick each lead's model from a list: leads start on Sonnet and the top lead on Opus, without changing your default.

### A triage queue that knows what needs you

Open threads are ranked by what they need from you. Threads stuck on the same error, or close to their budget, are flagged. Threads idle for days move to Ideas, and new work waits when enough is already running. Dispatch tasks wait once spend is over budget, can go to projects without a card yet, and follow-ups reach finished and archived threads.

### Finished means checked and pushed

A read-only reviewer checks a finished thread's changes before it shows as done. Turn on a card setting to push a thread's branch each time its turn ends.

### And smaller things

- Answer Decisions from the keyboard, put a card off till later, and see answered threads move along. Threads stopped on a terminal prompt show up there too.
- Search every Settings tab from a box above the tabs.
- Long decision options that wrap show as rounded boxes, and long links wrap instead of being cut off.
- Decisions read correctly under "**Needs you.** My pick is in bold", and from an indented line under the question.
- A decision asked again shows why it was asked the first time.
- The sidebar and Read view cats are redrawn.
- The terminal scrollbar stays faint until you scroll.
- A dev build keeps its own settings, usage log and moments.
