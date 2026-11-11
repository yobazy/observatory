#!/bin/bash
# Stand-in agent CLI for the sandbox: echoes prompts and fires the managed
# hooks nebula installed, so statuses change without a real model.
hook() { # $1 = hook event name
  local cmd
  cmd=$(python3 -c "import json,sys;d=json.load(open('.claude/settings.local.json'));print(d['hooks']['$1'][0]['hooks'][0]['command'])" 2>/dev/null) || return
  echo "{\"session_id\":\"fake-$$\",\"cwd\":\"$PWD\",\"prompt\":\"$2\"}" | bash -c "$cmd" >/dev/null 2>&1
}
printf '\e[1;38;5;111mfake agent\e[0m in %s\n' "$PWD"
# A turn whose reply ends on $2, written as Claude Code logs it, into the
# sandbox's own CLAUDE_CONFIG_DIR (sandbox.sh), so the app reads its verdict.
verdict() { # $1 = prompt, $2 = the verdict line
  hook UserPromptSubmit "$1"
  echo "$2"
  # A daemon started before sandbox.sh set it falls back to the same place.
  local dir="${CLAUDE_CONFIG_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.sandbox/claude}/projects/sandbox"
  mkdir -p "$dir"
  python3 -c 'import json,sys,time
t=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
u={"type":"user","timestamp":t,"message":{"content":sys.argv[1]}}
a={"type":"assistant","timestamp":t,"message":{"content":[{"type":"text","text":"Did it.\n\n"+sys.argv[2]}]}}
print(json.dumps(u));print(json.dumps(a))' "$1" "$2" >>"$dir/fake-$$.jsonl"
  hook Stop
}
reply() { # $1 = a prompt, typed or given at start
  local line="$1"
  case "$line" in
    ask*) hook UserPromptSubmit "$line"; echo "Allow me to edit README.md? (reply y)"; hook PermissionRequest ;;
    # A Claude-style menu, then a slow command nebula hears nothing about
    # until it ends, like `gh pr checks --watch` after you allow it.
    menu*)
      hook UserPromptSubmit "$line"
      printf '────────────────────────────────\n Bash command\n\n   gh pr checks 114 --watch\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No, and tell Claude what to do differently\n'
      hook PermissionRequest
      # Answered: the panel goes, as Claude Code clears it.
      read -rs -n1 _
      printf '\r\e[8A\e[J  ⎿  Running gh pr checks 114 --watch…\n'; sleep 20; echo "checks passed."; hook Stop ;;
    # An MCP server asking for input, as Claude Code draws it: Accept and
    # Decline on one row, ← and → to move between them, Enter to pick.
    mcp*)
      hook UserPromptSubmit "$line"
      printf '────────────────────────────────\n  MCP server “sandbox db” requests your input\n\n  This SQL includes destructive operations (DROP, DELETE, TRUNCATE or UPDATE without WHERE).\n  Run it on project sandbox?\n\n  ❯ Accept    Decline\n\n  Esc to cancel · ↑/↓ to navigate\n'
      hook PermissionRequest
      pick=Accept
      while IFS= read -rsn1 k; do
        [ -z "$k" ] && break
        [ "$k" = $'\e' ] && read -rsn2 k && case "$k" in '[C'|'[D') [ $pick = Accept ] && pick=Decline || pick=Accept ;; esac
      done
      printf '\r\e[9A\e[J  ⎿  %s\n' "$pick"; sleep 2; echo "done."; hook Stop ;;
    # AskUserQuestion, as Claude Code draws it: tabs for each question, a note
    # under each choice, and "Chat about this" under a rule. A digit answers
    # and moves on; on the boxes it toggles, and Tab moves on.
    quiz*)
      hook UserPromptSubmit "$line"
      rule='────────────────────────────────'
      foot='Enter to select · Tab/Arrow keys to navigate · Esc to cancel'
      printf '%s\n←  ☐ Bus  ☐ Food  ✔ Submit  →\n\nDo you want the shuttle from the hotel?\n\n❯ 1. No, thank you\n     You get to the venue yourself.\n  2. Yes, please\n     Take the 5:30 PM shuttle.\n  3. Type something.\n%s\n  4. Chat about this\n\n%s\n' "$rule" "$rule" "$foot"
      hook PermissionRequest
      read -rsn1 _
      fish=' '
      while :; do
        printf '\e[14A\e[J%s\n←  ☒ Bus  ☐ Food  ✔ Submit  →\n\nWhat should we order?\n\n❯ 1. [%s] Fish\n        The Friday special.\n  2. [ ] Tofu\n        Marinated overnight.\n  3. [ ] Type something\n     Next\n%s\n  4. Chat about this\n\n%s\n' "$rule" "$fish" "$rule" "$foot"
        IFS= read -rsn1 k
        [ "$k" = 1 ] && { [ "$fish" = ' ' ] && fish=✔ || fish=' '; }
        [ "$k" = $'\t' ] && break
        printf '\e[1A'
      done
      printf '\e[15A\e[J%s\n←  ☒ Bus  ☒ Food  ✔ Submit  →\n\nReview your answers\n\n ● Do you want the shuttle from the hotel?\n   → Yes\n\nReady to submit your answers?\n\n❯ 1. Submit answers\n  2. Cancel\n' "$rule"
      read -rsn1 _
      printf '\e[12A\e[J  ⎿  answered\n'; sleep 2; echo "done."; hook Stop ;;
    # A command run outside any turn, as Claude Code does "! cmd": no hooks,
    # so the status doesn't move. Slept on, never run: it may be a replay's.
    '! '*) echo "running: ${line#! }"; sleep "${FAKE_RUN_SECONDS:-20}"; echo "done." ;;
    # Subagents sent off and the turn over: the prompt is back, but nebula
    # holds the thread at running until they report in, which here is never.
    agents*)
      hook UserPromptSubmit "$line"
      hook SubagentStart
      echo "two agents are working in the background."
      hook Stop ;;
    # A reply ending on a close verdict, logged where the app reads it.
    safe*) verdict "$line" "✅ Safe to close" ;;
    keep*) verdict "$line" "🟠 Keep open: waiting on you" ;;
    *) hook UserPromptSubmit "$line"; echo "working on: $line"; sleep 3; echo "done."; hook Stop ;;
  esac
}
# A task it starts on: the prompts above work as tasks too, so scripts/drive
# can start one without typing into a terminal.
case "$1" in
  ask* | menu* | mcp* | quiz* | agents* | safe* | keep*) reply "$1" ;;
  ?*) hook UserPromptSubmit "$1"; echo "task: $1"; sleep 2; hook Stop ;;
esac
while IFS= read -r -p $'\e[38;5;244m›\e[0m ' line; do reply "$line"; done
