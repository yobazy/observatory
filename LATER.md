# Later

- Cross-project tasks as linked subtasks: one subtask per project, each in its own worktree, grouped under a parent row. Plans are approved together, and each subtask gets its sibling's approved plan as a contract. Optional ordering: a dependent subtask starts after the other finishes and receives its diff summary. The parent is done when all children are done. Why: valuable, but MVP routing works fine with single-project tasks.
- Persistent rolling to-do list: unfinished items carry over from day to day. Why: moves Dispatch toward replacing a scheduling app, which is not needed to prove routing and dispatch.
- Learning from routing corrections: offer to update a project card when the user re-routes a task. Why: needs real correction data first; cards can be edited by hand in the meantime.
- Smarter file-contention handling in Shared projects beyond concurrency caps. Why: per-project caps (plus the project's own writer locks) cover the MVP risk.
- Other input sources beyond paste (for example, pulling lists from Notion). Why: paste plus quick capture covers the core loop, and integrations go against the "nothing hardwired" principle unless they are done through agents.
- Native plan mode for Claude tasks (`--permission-mode plan`) in place of the prompt postfix. Why: `CreateAgent` has no field for launch flags, so this needs a nebula-core protocol change. The postfix works for every harness in the meantime.
- Home as a plain (non-git) folder: nebula's AddProject only takes a git repo (or `git init`s one with `create_missing`, which needs the user's OK), so Home and `you` tasks there stay blocked with "Home needs to be a git folder for now". Why: letting Home sessions run outside a repo needs a daemon change, or an explicit "make it a git repo" confirm in the app.
- More activities for the sidebar cat, beyond stargazing, catching stars, grooming and stretching (#37). Why: wanted, set aside for now (2026-10-16).
- Pick the sidebar pet: a cat or a dog, in Settings beside the on/off switch; the dog needs its own frames for every activity. Why: wanted, set aside for now (2026-10-16).
- Enable and disable a launchd job from the Automations view (`launchctl bootstrap` / `bootout`, with a confirm), and the same for a cloud routine (`enabled` through the routines API). Why: the panel starts read-only plus Run now (2026-10-22).
- Add a job from the Automations view (write a plist, or create a routine). Why: jobs are made in agent threads today; the view only watches them.
- Thread tags, beyond S15 and S16: several chips on at once, tag colors, tagging several picked threads from the multi-select menu, and a tag filter across projects (⌘K or the sidebar). Why: one chip in one project covers the one-repo, several-clients case (2026-10-22).
- Tagging prompt suggestions for new tags: the prompt proposes a tag that isn't in the project's list for the user to accept. Why: S16 only picks from the list, so a hand-made list stays the source of truth.
- Thread tags: archived threads' menu has no "Tags…", since it lacks the arrange group; their tags can only be changed by unarchiving (S15).
