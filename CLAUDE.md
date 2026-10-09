# Observatory

A macOS Tauri app (React + TypeScript in `src/`, Rust in `src-tauri/`) that's a client for the
nebula daemon. README.md covers the layout, setup and releasing; CONTRIBUTING.md covers the PR
rules. Both apply to agents too.

## Checks

Run these before calling a change done. CI runs the same ones.

```sh
npm run build && npm test
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
```

## Rules

- Test against the sandbox (`scripts/sandbox.sh app`), never the user's real daemon, unless asked.
- `src/nebula/types.ts` mirrors nebula's protocol at the tag pinned in `src-tauri/Cargo.toml`.
  Change them together; `scripts/sandbox.sh e2e` catches drift.
- Don't bump versions or touch `latest.json`; `scripts/release.sh` handles releases.
- Commit subjects say what the app now does, in plain words ("Remove a project from the list,
  from its menu"), not "feat:" prefixes.
- Match the surrounding code's style and comment density. Rust is formatted by `cargo fmt`.

## Reviewing

When reviewing a PR, flag correctness bugs, breaks in the rules above, and protocol changes
that don't update `types.ts`. Don't flag style that `cargo fmt` or `tsc` already enforce.
