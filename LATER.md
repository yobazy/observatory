# Later

- Cross-project tasks as linked subtasks: one subtask per project, each in its own worktree, grouped under a parent row. Plans are approved together, and each subtask gets its sibling's approved plan as a contract. Optional ordering: a dependent subtask starts after the other finishes and receives its diff summary. The parent is done when all children are done. Why: valuable, but MVP routing works fine with single-project tasks.
- Persistent rolling to-do list: unfinished items carry over from day to day. Why: moves Dispatch toward replacing a scheduling app, which is not needed to prove routing and dispatch.
- Cheap Haiku progress summaries per running task. Why: the last screen line is enough for "what it's doing now" in the MVP.
- Learning from routing corrections: offer to update a project card when the user re-routes a task. Why: needs real correction data first; cards can be edited by hand in the meantime.
- Smarter file-contention handling in Shared projects beyond concurrency caps. Why: per-project caps (plus the project's own writer locks) cover the MVP risk.
- Other input sources beyond paste (for example, pulling lists from Notion). Why: paste plus quick capture covers the core loop, and integrations go against the "nothing hardwired" principle unless they are done through agents.
- Native plan mode for Claude tasks (`--permission-mode plan`) in place of the prompt postfix. Why: `CreateAgent` has no field for launch flags, so this needs a nebula-core protocol change. The postfix works for every harness in the meantime.
- Rust checks fail on HEAD under the installed toolchain (rustc 1.98): `cargo fmt --check` wants to reformat several existing files and clippy flags `double_ended_iterator_last` in src-tauri/src/title.rs:65. Why: pre-existing and outside Dispatch; fix in its own commit (or pin a rust-toolchain).
