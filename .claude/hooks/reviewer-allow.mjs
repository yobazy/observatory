#!/usr/bin/env node
// Pre-approves the shell commands a moment task's reviewer runs, so its
// thread doesn't stop on a permission prompt for each one.
//
// Claude Code calls this before every Bash command in this project. It only
// ever says "allow" or nothing: when it says nothing, the usual permission
// rules (and prompt) apply. It says "allow" when:
//   - the session is the reviewer a moment task spawns (its first prompt is
//     "Review PR #… as a fresh reviewer", from src/nebula/moments.ts), and
//   - every part of the command is on the list below, with nothing the list
//     doesn't parse ($(…), backticks, redirects to files, globs, …).
// Builds and tests run the PR's code, so they're only pre-approved when the
// branch leaves alone the files CLAUDE.md says to read before building one
// (RUNS_ON_ITS_OWN); otherwise they ask as usual.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Files that run on their own during an install, build or test. */
export const RUNS_ON_ITS_OWN = [
  "CLAUDE.md",
  ".claude/",
  "package.json",
  "package-lock.json",
  ".npmrc",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.node.json",
  "src-tauri/build.rs",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "src-tauri/.cargo/",
  ".cargo/",
  "scripts/",
  ".github/",
];

/** Whether a session whose first prompt is `prompt` is a moment's reviewer. */
export function isReviewer(prompt) {
  return typeof prompt === "string" && /^Review PR #\d+ /.test(prompt) && prompt.includes("as a fresh reviewer");
}

/** Whether none of `files` (paths from the repo root) runs on its own. */
export function checksSafe(files) {
  return !files.some((f) => RUNS_ON_ITS_OWN.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)));
}

/** Split a command into simple commands, as word lists, with "(" and ")"
 *  kept as their own items for subshells. Null for anything outside the
 *  plain subset this understands: expansions, escapes, globs, background
 *  jobs, input redirects and output redirects other than to another fd or
 *  /dev/null. */
export function parse(command) {
  const out = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  const s = command;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
      word = (word ?? "") + s.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      let text = "";
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === "$" || s[j] === "`" || s[j] === "\\" || s[j] === "!") return null;
        text += s[j];
      }
      if (j >= s.length) return null;
      word = (word ?? "") + text;
      i = j;
    } else if (c === " " || c === "\t") {
      endWord();
    } else if (c === "\n" || c === ";") {
      endCommand();
    } else if (c === "&" || c === "|") {
      if (s[i + 1] === c) i++;
      else if (c === "&") {
        // "&>/dev/null" is fine; a lone "&" backgrounds a job.
        const m = /^&>>?[ \t]*\/dev\/null(?=[\s;&|)]|$)/.exec(s.slice(i));
        if (!m || word !== null) return null;
        i += m[0].length - 1;
        continue;
      }
      endCommand();
    } else if (c === "(" || c === ")") {
      endCommand();
      out.push([c]);
    } else if (c === ">") {
      if (word !== null && !/^\d$/.test(word)) return null;
      const m = /^>(?:&\d|>?[ \t]*\/dev\/null)(?=[\s;&|)]|$)/.exec(s.slice(i));
      if (!m) return null;
      word = null;
      i += m[0].length - 1;
    } else if (c === "~" && word !== null) {
      word += c; // HEAD~1; only a leading ~ expands.
    } else if ("$`\\<*?[]{}~!#".includes(c)) {
      return null;
    } else {
      word = (word ?? "") + c;
    }
  }
  endCommand();
  return out;
}

const READ_ONLY = new Set(["tail", "head", "grep", "wc", "cat", "echo", "sleep", "pwd", "ls", "true"]);
const GIT_READ = new Set(["log", "diff", "show", "status", "rev-parse", "merge-base", "ls-files", "rev-list", "shortlog", "describe", "blame"]);
const GH_PR_READ = new Set(["view", "diff", "checks", "list", "status"]);

const isRef = (w) => /^[A-Za-z0-9][\w./-]*$/.test(w);
const isPr = (w) => /^\d+$/.test(w) || /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(w);
const within = (dir, root) => dir === root || dir.startsWith(root + path.sep);

/** Whether `words`, run in `cwd`, is on the reviewer's list. `ctx` has the
 *  repo `root`, the current `branch`, the `defaultBranch` and `checksSafe`.
 *  Returns the directory the command leaves the shell in, or null. */
export function allowed(words, cwd, ctx) {
  let w = words;
  // "GIT_EDITOR=true git rebase --continue" keeps rebase from opening an editor.
  if (/^GIT_EDITOR=(true|:)$/.test(w[0]) && w[1] === "git") w = w.slice(1);
  const [cmd, sub, ...rest] = w;
  const args = w.slice(1);
  if (cmd === "cd") {
    if (args.length !== 1 || args[0].startsWith("-")) return null;
    const to = path.resolve(cwd, args[0]);
    return within(to, ctx.root) ? to : null;
  }
  if (READ_ONLY.has(cmd)) return cwd;
  // Every reviewer titles its thread first.
  if (cmd === "nebula" && sub === "rename") return cwd;
  if (cmd === "git") {
    if (GIT_READ.has(sub)) return rest.some((a) => a.startsWith("--output") || a === "--ext-diff") ? null : cwd;
    if (sub === "fetch") {
      const flags = new Set(["-q", "--quiet", "--prune", "-p", "--all", "--tags"]);
      return rest.every((a) => flags.has(a) || isRef(a)) ? cwd : null;
    }
    if (sub === "branch") {
      const flags = new Set(["--show-current", "-a", "-r", "-v", "-vv", "--list"]);
      return rest.every((a) => flags.has(a)) ? cwd : null;
    }
    if (sub === "rebase" || sub === "merge") {
      const steps = sub === "rebase" ? ["--continue", "--abort", "--skip"] : ["--continue", "--abort"];
      if (rest.length === 1 && steps.includes(rest[0])) return cwd;
      if (sub === "merge" && rest.includes("--no-edit")) rest.splice(rest.indexOf("--no-edit"), 1);
      const target = rest.filter((a) => a !== "-q" && a !== "--quiet");
      const base = ctx.defaultBranch;
      return target.length === 1 && (target[0] === `origin/${base}` || target[0] === base) ? cwd : null;
    }
    if (sub === "add") {
      return rest.length && rest.every((a) => a === "-u" || a === "-A" || (!a.startsWith("-") && within(path.resolve(cwd, a), ctx.root)))
        ? cwd
        : null;
    }
    if (sub === "push") {
      // Only this branch, never the default one, and never a plain --force.
      const { branch, defaultBranch } = ctx;
      if (!branch || branch === "HEAD" || branch === defaultBranch) return null;
      const flags = new Set(["-q", "--quiet", "--force-with-lease", "-u", "--set-upstream"]);
      const pos = rest.filter((a) => !flags.has(a));
      if (pos.some((a) => a.startsWith("-"))) return null;
      if (pos.length > 2 || (pos.length >= 1 && pos[0] !== "origin")) return null;
      const ref = pos[1];
      return !ref || ref === "HEAD" || ref === branch || ref === `HEAD:${branch}` || ref === `${branch}:${branch}` ? cwd : null;
    }
    return null;
  }
  if (cmd === "gh") {
    if (sub === "pr") {
      const [verb, ...more] = rest;
      if (GH_PR_READ.has(verb)) return cwd;
      if (more.some((a) => a === "-R" || a.startsWith("--repo"))) return null;
      if (verb === "merge") {
        const flags = new Set(["--squash", "-s", "--merge", "-m", "--rebase", "-r", "--delete-branch", "-d", "--auto"]);
        const pos = more.filter((a) => !flags.has(a));
        return pos.length <= 1 && pos.every(isPr) ? cwd : null;
      }
      if (verb === "comment" || verb === "review") {
        const kinds = new Set(verb === "review" ? ["--comment", "-c", "--approve", "-a", "--request-changes", "-r"] : []);
        let pr = 0;
        for (let i = 0; i < more.length; i++) {
          const a = more[i];
          if (kinds.has(a)) continue;
          if (a === "--body" || a === "-b") i++;
          else if (a === "--body-file" || a === "-F") {
            const f = more[++i];
            if (f === undefined) return null;
            const file = path.resolve(cwd, f);
            if (f !== "-" && !within(file, ctx.root) && !within(file, "/tmp") && !within(file, "/private/tmp")) return null;
          } else if (isPr(a) && !pr++) continue;
          else return null;
        }
        return cwd;
      }
      return null;
    }
    if (sub === "run") return ["view", "list", "watch"].includes(rest[0]) ? cwd : null;
    return null;
  }
  if (!ctx.checksSafe) return null;
  if (cmd === "npm") {
    const a = args.filter((x) => x !== "-s" && x !== "--silent").join(" ");
    return ["test", "run test", "run build", "ci"].includes(a) ? cwd : null;
  }
  if (cmd === "cargo") {
    if (!["fmt", "clippy", "test", "check", "build"].includes(sub)) return null;
    return rest.some((a) => a.startsWith("--config") || a.startsWith("-Z") || a.startsWith("--manifest-path")) ? null : cwd;
  }
  return null;
}

/** Whether the whole `command`, run in `cwd`, is on the reviewer's list. */
export function allowCommand(command, cwd, ctx) {
  const parts = parse(command);
  if (!parts || !parts.length) return false;
  const stack = [];
  for (const words of parts) {
    if (words[0] === "(") stack.push(cwd);
    else if (words[0] === ")") {
      if (!stack.length) return false;
      cwd = stack.pop();
    } else {
      cwd = allowed(words, cwd, ctx);
      if (cwd === null) return false;
    }
  }
  return stack.length === 0;
}

/** The text of the first prompt in a Claude Code transcript. */
export function firstPrompt(transcript) {
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "user" || e.isMeta || !e.message) continue;
    const c = e.message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const text = c.find((x) => x && x.type === "text");
      if (text) return text.text;
      if (c.some((x) => x && x.type === "tool_result")) return null;
    }
  }
  return null;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function repoContext(cwd) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  let defaultBranch = "main";
  try {
    defaultBranch = git(cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").replace(/^origin\//, "");
  } catch {
    // No origin/HEAD recorded: main.
  }
  const changed = [
    ...git(root, "diff", "--name-only", `origin/${defaultBranch}...HEAD`).split("\n"),
    ...git(root, "status", "--porcelain", "--untracked-files=all")
      .split("\n")
      .flatMap((l) => l.slice(3).split(" -> ")),
  ].filter(Boolean);
  return { root, branch, defaultBranch, checksSafe: checksSafe(changed) };
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
    if (input.tool_name !== "Bash" || typeof input.tool_input?.command !== "string") return;
    const head = readFileSync(input.transcript_path, "utf8").slice(0, 1 << 20);
    if (!isReviewer(firstPrompt(head))) return;
    const cwd = input.cwd;
    if (!allowCommand(input.tool_input.command, cwd, repoContext(cwd))) return;
  } catch {
    return; // Anything unexpected: say nothing, so it asks as usual.
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "On the moment reviewer's list (.claude/hooks/reviewer-allow.mjs)",
      },
    }),
  );
}

function runDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runDirectly()) main();
