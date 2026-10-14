# Contributing to Observatory

Thanks for wanting to help. Bug reports, fixes and ideas are all welcome.

## Before you start

**Open a PR straight away** for bug fixes, docs, typos, and small UI polish.

**Open an issue first** for a new feature, a new setting, a new dependency, a change to how the
app talks to nebula, or anything over roughly 200 lines. Say what you want to change and why, and
wait for a reply before building it. That way nobody spends a weekend on something that doesn't
fit the app.

If an issue is labeled `good first issue` or `help wanted`, it's open to anyone. Comment on it so
two people don't build the same thing.

## Setting up

```sh
./scripts/setup.sh        # build tools, nebula at the pinned version, and the app
npm run tauri dev         # run it against your real nebula daemon
```

To work without touching your own sessions, run the app against a throwaway daemon with fake
agents:

```sh
scripts/sandbox.sh app
scripts/sandbox.sh stop
```

`npm run dev` on its own serves a browser preview with demo data, which is enough for styling
work. The README's [Layout](README.md#layout) section says where things live.

## Checks

CI runs these on every PR. Run them before you push:

```sh
npm run build                                   # typecheck and build the frontend
npm test
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

If you changed how the app talks to the daemon, also run `scripts/sandbox.sh e2e`.

## Pull requests

- Keep one change per PR. Two unrelated fixes go in two PRs.
- Show that it works. For anything visible, attach a screenshot or a short recording. For logic,
  add or update a test.
- PRs are squash-merged, so the PR title becomes the commit message. Write it the way this
  repo's history reads: what the app now does, in plain words, such as "Remove a project from
  the list, from its menu".
- Don't bump the version or edit `latest.json`. Releases are cut separately.
- Written with an AI agent? That's fine. You're still responsible for it, so read the diff and
  run the app before you open the PR.

The maintainer may rebase a stale PR onto `main` themselves rather than ask you to. You stay the
commit's author.

## Reviews

Claude reviews PRs and leaves inline comments. Treat them like any reviewer's: fix what's right,
and reply when you disagree. A person makes the final call.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same as the project.
