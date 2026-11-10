# Marked-moment fixtures

Each file here is a marked moment (⇧⌘M) that found a Read view bug, cut down to the input that
showed it and what the Read view should have made of it. They keep fixed bugs fixed.

- `tests/moments.regression.test.mjs` runs every check except `transcript` (`npm test`).
- `src-tauri/src/transcript.rs` (`marked_moments_read_as_they_should`) runs the `transcript`
  checks (`cargo test`).

## Adding a moment

When you fix a bug someone marked a moment for, add a fixture in the same PR.

1. Open the moment: `~/Library/Application Support/dev.bazil.observatory/moments/<ts>/`.
   `moment.json` has the note, the last 60s of events and a state snapshot; `thread.json` (newer
   moments) has the thread's entries as the Read view got them; `screenshot.png` shows the screen.
2. Find the input the bug was in. A reply's text is in `thread.json`. Terminal rows aren't saved,
   so copy them from the screenshot. A message the Read view hid isn't in `thread.json` at all;
   its raw record is in the thread's Claude log (`~/.claude/projects/<project>/<session>.jsonl`).
3. Write `<ts>.json`, named after the moment:

   ```json
   {
     "moment": "2026-10-29T10-27-18-608Z",
     "family": "choices",
     "note": "what the moment's note said",
     "fixedBy": "#113 Read a decision's options when one quotes a line with dots in it",
     "source": "where the input came from, and what you changed or had to infer",
     "checks": [{ "reads": "card", "input": { "text": "…" }, "expect": { "asks": [{ "n": 1, "letters": "ABCD" }] } }]
   }
   ```

   `family` is `choices` (options not shown or not answerable), `sent` (something you sent, or a
   change, not showing) or `queue` (a reply stuck in the queue). Add a family if a new kind of
   failure turns up.
4. Make it anonymous. Moments come from real work, client work included: replace client and
   people's names, project names, ids, URLs, tokens and home or scratchpad paths with neutral
   ones, and cut what the check doesn't need. Keep the shape that broke (the separators, the
   block layout, the rows) exactly.
5. Check it fails on the code from before your fix, then passes with it.

If the input can't be rebuilt (the moment didn't keep it, and the logic lives in a component),
don't invent one: leave it out and say so in the PR.

## Checks

| `reads` | Runs | `input` | `expect` |
|---|---|---|---|
| `card` | `readCard` | `text`: a reply | `asks`: `[{ n, letters, labels?, labelsStart? }]`, `verdict`: tone or `null` |
| `screen` | `findQuestion` | `screen`: terminal rows | `choices`: labels, `promptEnds?`, `selected?` |
| `landed` | `readCard` + `landedNote` | `text`, `states`: `{ "136": "merged" }` | `landed`: the note |
| `queue` | `queuegate.ts` | `agent`, `sends`, `onScreen`, `now`, `turnEndedAt?` | `hold`, `canSendNow`, `held` |
| `reports` | `isReport` | `data`: what the terminal wrote | `report` |
| `transcript` | Rust `transcript.rs` | `log`: Claude log records | `you`: every message, or `youContains` |

Times may be ISO strings. In `queue`, `sends` takes `sendingSince`, `lastSent` and `lastTyped`.

## A bug that's still live

Give the fixture `"todo": "what's wrong, and where"` in place of `fixedBy`. Its checks then have
to fail: the test passes while the bug is there, and fails once it's fixed, so whoever fixes it
swaps `todo` for `fixedBy`.

## Moments without a fixture

- `2026-10-25T05-46-55-612Z` ("the reader isn't updating on its own", #75): the bug was in when
  `useTranscript` in `Reader.tsx` polled, not in reading anything.
- `2026-11-03T14-48-25-732Z` ("Didnt specify what I have to accept?"): the permission prompt's
  terminal rows weren't saved, and the thread's log has no tool call waiting at that time
  (likely a subagent's), so what it asked can't be rebuilt.
