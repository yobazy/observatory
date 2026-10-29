#!/bin/bash
# Stand-in agent CLI for the sandbox: echoes prompts and fires the managed
# hooks nebula installed, so statuses change without a real model.
hook() { # $1 = hook event name
  local cmd
  cmd=$(python3 -c "import json,sys;d=json.load(open('.claude/settings.local.json'));print(d['hooks']['$1'][0]['hooks'][0]['command'])" 2>/dev/null) || return
  echo "{\"session_id\":\"fake-$$\",\"cwd\":\"$PWD\",\"prompt\":\"$2\"}" | bash -c "$cmd" >/dev/null 2>&1
}
printf '\e[1;38;5;111mfake agent\e[0m in %s\n' "$PWD"
[ -n "$1" ] && { hook UserPromptSubmit "$1"; echo "task: $1"; sleep 2; hook Stop; }
while IFS= read -r -p $'\e[38;5;244m›\e[0m ' line; do
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
    *) hook UserPromptSubmit "$line"; echo "working on: $line"; sleep 3; echo "done."; hook Stop ;;
  esac
done
