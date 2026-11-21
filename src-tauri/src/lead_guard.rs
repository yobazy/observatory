//! A project lead's guard: keeps it to its own project. The lead's main
//! checkout gets a `PreToolUse` hook in `.claude/settings.local.json`, the
//! file nebula keeps its own hooks in, which runs only in the lead's session
//! (it checks `NEBULA_AGENT_ID`, the way nebula's hooks do, so the user's own
//! threads in that checkout never see it). The hook runs this binary with
//! `--lead-guard`, which reads the tool call on stdin and allows it, asks the
//! user about it, or refuses it:
//!
//! - Reading inside the project (its checkout and worktrees) or the lead's
//!   notes folder is fine; anywhere else asks, and `~/Library` is refused.
//! - Writing is only for its notes. A lead never edits the project's files:
//!   it starts a task for that.
//! - Shell commands that start, send, move or merge (`nebula spawn`, `git
//!   push`, `gh pr merge`, …) are refused, since Observatory does those for
//!   it within its level; paths under your home outside the project ask.
//! - `observatory://` links are refused at Watch, and need `from=` above it,
//!   so the app knows which lead sent them.

use serde_json::{json, Map, Value};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// The flag that runs the guard instead of the app.
pub const FLAG: &str = "--lead-guard";

/// What the guard says about one tool call.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Ask(String),
    Deny(String),
}

/// A lead's limits: where its project is, where its notes are, its level.
pub struct Guard {
    pub roots: Vec<PathBuf>,
    /// The folder its notes file is in (and the answers log beside it).
    pub notes: PathBuf,
    pub level: u8,
    pub home: PathBuf,
    pub cwd: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
enum Place {
    Notes,
    Project,
    Library,
    /// Under your home, outside the project: another repo, your documents.
    Home,
    /// Outside your home: `/usr`, `/tmp`, `/dev/null`.
    System,
}

/// `p` without `.` and `..`, without touching the disk.
fn lexical(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// Nebula's subcommands a lead may run: they only read, title or show.
const NEBULA_OK: &[&str] = &[
    "ask", "read", "sessions", "rename", "open", "help", "--help", "-h",
];
/// git subcommands that change the checkout or the remote.
const GIT_NO: &[&str] = &[
    "push",
    "merge",
    "commit",
    "reset",
    "checkout",
    "switch",
    "rebase",
    "worktree",
    "branch",
    "tag",
    "cherry-pick",
    "revert",
    "stash",
    "clean",
];

impl Guard {
    fn resolve(&self, raw: &str) -> PathBuf {
        let raw = raw.trim();
        let expanded = if raw == "~" || raw == "$HOME" || raw == "${HOME}" {
            self.home.clone()
        } else if let Some(rest) = raw
            .strip_prefix("~/")
            .or_else(|| raw.strip_prefix("$HOME/"))
            .or_else(|| raw.strip_prefix("${HOME}/"))
        {
            self.home.join(rest)
        } else {
            self.cwd.join(raw)
        };
        lexical(&expanded)
    }

    fn place(&self, p: &Path) -> Place {
        if p.starts_with(&self.notes) {
            Place::Notes
        } else if self.roots.iter().any(|r| p.starts_with(r)) {
            Place::Project
        } else if p.starts_with(self.home.join("Library")) {
            Place::Library
        } else if p.starts_with(&self.home) {
            Place::Home
        } else {
            Place::System
        }
    }

    fn reading(&self, raw: Option<&str>) -> Verdict {
        let Some(raw) = raw.filter(|r| !r.trim().is_empty()) else {
            return Verdict::Allow;
        };
        let p = self.resolve(raw);
        match self.place(&p) {
            Place::Notes | Place::Project => Verdict::Allow,
            Place::Library => Verdict::Deny(format!(
                "{} is in ~/Library, which a lead never reads.",
                p.display()
            )),
            Place::Home | Place::System => {
                Verdict::Ask(format!("{} is outside this lead's project.", p.display()))
            }
        }
    }

    fn writing(&self, raw: Option<&str>) -> Verdict {
        let p = self.resolve(raw.unwrap_or(""));
        match self.place(&p) {
            Place::Notes => Verdict::Allow,
            Place::Project => Verdict::Deny(
                "A lead doesn't edit the project's files. Start a task for it instead (START <branch>: <brief>, or a new-task link).".into(),
            ),
            _ => Verdict::Deny(format!("{} is outside this lead's project; a lead only writes its notes.", p.display())),
        }
    }

    fn shell(&self, command: &str) -> Verdict {
        if command.contains("observatory://") {
            if self.level < 2 {
                return Verdict::Deny("At Watch, a lead only keeps notes and answers questions: it doesn't open observatory:// links.".into());
            }
            if !command.contains("from=") {
                return Verdict::Deny("An observatory:// link from a lead has to say who it's from: add &from=$NEBULA_AGENT_ID.".into());
            }
        }
        let words = words(command);
        for (i, w) in words.iter().enumerate() {
            let next = subcommand(&words[i + 1..]);
            let name = w.rsplit('/').next().unwrap_or(w);
            if name == "nebula" {
                if let Some(sub) = next {
                    if !NEBULA_OK.contains(&sub) {
                        return Verdict::Deny(format!(
                            "A lead doesn't run `nebula {sub}`: Observatory starts and sends for it, within its level. Write an action line instead."
                        ));
                    }
                }
            }
            if name == "git" {
                if let Some(sub) = next.filter(|s| GIT_NO.contains(s)) {
                    return Verdict::Deny(format!("A lead doesn't run `git {sub}`: tasks change the project, in their own worktrees."));
                }
            }
            if name == "gh"
                && words.get(i + 1).map(String::as_str) == Some("pr")
                && words.get(i + 2).map(String::as_str) == Some("merge")
            {
                return Verdict::Deny("A lead doesn't merge PRs itself: at Merge and release, write MERGE #<number>: <why> and Observatory merges it.".into());
            }
            if name == "gh" && words.get(i + 1).map(String::as_str) == Some("release") {
                return Verdict::Deny("A lead doesn't cut releases itself: at Merge and release, write RELEASE <branch>: <brief>.".into());
            }
        }
        for w in &words {
            // `--file=/x` names a path too.
            let w = w.rsplit_once('=').map_or(w.as_str(), |(_, v)| v);
            let pathy = w.starts_with('/')
                || w.starts_with('~')
                || w.starts_with("$HOME")
                || w.starts_with("${HOME}");
            if !pathy || w.contains("://") {
                continue;
            }
            let p = self.resolve(w);
            match self.place(&p) {
                Place::Library => {
                    return Verdict::Deny(format!(
                        "{} is in ~/Library, which a lead never touches.",
                        p.display()
                    ))
                }
                Place::Home => {
                    return Verdict::Ask(format!("{} is outside this lead's project.", p.display()))
                }
                _ => {}
            }
        }
        Verdict::Allow
    }

    pub fn judge(&self, tool: &str, input: &Value) -> Verdict {
        let s = |k: &str| input.get(k).and_then(Value::as_str);
        match tool {
            "Read" => self.reading(s("file_path")),
            "Glob" | "Grep" | "LS" => self.reading(s("path")),
            "NotebookRead" => self.reading(s("notebook_path")),
            "Edit" | "Write" | "MultiEdit" => self.writing(s("file_path")),
            "NotebookEdit" => self.writing(s("notebook_path")),
            "Bash" => self.shell(s("command").unwrap_or("")),
            _ => Verdict::Allow,
        }
    }
}

/// A command's words, near enough: split on spaces and shell operators,
/// quotes dropped.
fn words(command: &str) -> Vec<String> {
    command
        .split(|c: char| {
            c.is_whitespace() || matches!(c, ';' | '|' | '&' | '(' | ')' | '<' | '>' | '`')
        })
        .map(|w| w.trim_matches(|c| c == '"' || c == '\''))
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

/// The subcommand in a program's arguments: the first word that isn't a
/// flag, skipping `-C <dir>` and `-c <key=value>` as git takes them.
fn subcommand(args: &[String]) -> Option<&str> {
    let mut i = 0;
    while let Some(a) = args.get(i) {
        if a == "-C" || a == "-c" {
            i += 2;
        } else if a.starts_with('-') {
            i += 1;
        } else {
            return Some(a);
        }
    }
    None
}

/// What the hook prints for a verdict: nothing for Allow, so Claude Code's
/// own permissions carry on as usual.
pub fn hook_output(v: &Verdict) -> Option<Value> {
    let (decision, reason) = match v {
        Verdict::Allow => return None,
        Verdict::Ask(r) => ("ask", r),
        Verdict::Deny(r) => ("deny", r),
    };
    Some(json!({ "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": format!("Observatory: {reason}"),
    }}))
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn expand(home: &Path, raw: &str) -> PathBuf {
    raw.strip_prefix("~/")
        .map_or_else(|| PathBuf::from(raw), |rest| home.join(rest))
}

/// `--lead-guard --level N --notes <file> --root <dir>…`, with the tool call
/// on stdin. Returns the process's exit code.
pub fn run_cli(args: &[String]) -> i32 {
    let home = home();
    let mut roots = Vec::new();
    let mut notes = None;
    let mut level = 2u8;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => roots.extend(it.next().map(|r| lexical(&expand(&home, r)))),
            "--notes" => notes = it.next().map(|n| lexical(&expand(&home, n))),
            "--level" => level = it.next().and_then(|l| l.parse().ok()).unwrap_or(2),
            _ => {}
        }
    }
    let mut stdin = String::new();
    let _ = std::io::stdin().read_to_string(&mut stdin);
    let call: Value = serde_json::from_str(&stdin).unwrap_or(Value::Null);
    let cwd = call
        .get("cwd")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| home.clone());
    let notes = notes
        .and_then(|n| n.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| home.join(".config/observatory/leads"));
    let guard = Guard {
        roots,
        notes,
        level,
        home,
        cwd,
    };
    let tool = call.get("tool_name").and_then(Value::as_str).unwrap_or("");
    let input = call.get("tool_input").cloned().unwrap_or(Value::Null);
    if let Some(out) = hook_output(&guard.judge(tool, &input)) {
        println!("{out}");
    }
    0
}

// ---- installing it ----

const SETTINGS: &str = ".claude/settings.local.json";
/// Marks the hook group as this app's, so a reinstall replaces it.
const MARK: &str = "_observatoryLead";

fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The hook's command: inert outside the lead's session, and asking (not
/// allowing) when the guard can't run, e.g. the app was moved.
pub fn hook_command(exe: &str, agent_id: &str, roots: &[String], notes: &str, level: u8) -> String {
    let mut cmd = format!(
        "[ \"$NEBULA_AGENT_ID\" = {} ] || exit 0; {} {FLAG} --level {level} --notes {}",
        quote(agent_id),
        quote(exe),
        quote(notes)
    );
    for r in roots {
        cmd.push_str(&format!(" --root {}", quote(r)));
    }
    let fallback = hook_output(&Verdict::Ask(
        "its lead guard couldn't run, so this asks.".into(),
    ))
    .unwrap();
    cmd.push_str(&format!(" || printf '%s' {}", quote(&fallback.to_string())));
    cmd
}

/// `settings` with this app's hook group taken out, and `command` put in
/// when given. Every other hook is left as it was.
pub fn with_guard(
    mut settings: Map<String, Value>,
    command: Option<&str>,
) -> Result<Map<String, Value>, String> {
    let hooks = settings.entry("hooks").or_insert_with(|| json!({}));
    let Some(hooks) = hooks.as_object_mut() else {
        return Err("its hooks aren't an object".into());
    };
    let pre = hooks.entry("PreToolUse").or_insert_with(|| json!([]));
    let Some(pre) = pre.as_array_mut() else {
        return Err("its PreToolUse hooks aren't a list".into());
    };
    pre.retain(|g| g.get(MARK).is_none());
    if let Some(command) = command {
        pre.push(json!({ MARK: true, "matcher": "*", "hooks": [{ "type": "command", "command": command, "timeout": 10 }] }));
    }
    if pre.is_empty() {
        hooks.remove("PreToolUse");
    }
    if hooks.is_empty() {
        settings.remove("hooks");
    }
    Ok(settings)
}

fn rewrite(checkout: &str, command: Option<&str>) -> Result<(), String> {
    let path = Path::new(checkout).join(SETTINGS);
    let now = match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(m)) => m,
            // Never clobber a file that can't be read: the user's hooks are in it.
            _ => {
                return Err(format!(
                    "{} isn't a JSON object, so it was left alone",
                    path.display()
                ))
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if command.is_none() {
                return Ok(());
            }
            Map::new()
        }
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let next = with_guard(now, command).map_err(|e| format!("{}: {e}", path.display()))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.observatory-tmp");
    let text = serde_json::to_string_pretty(&Value::Object(next)).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text + "\n").map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Put a lead's guard in its main checkout (replacing an earlier lead's).
#[tauri::command]
pub fn lead_guard_install(
    checkout: String,
    agent_id: String,
    roots: Vec<String>,
    notes: String,
    level: u8,
) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let command = hook_command(&exe.to_string_lossy(), &agent_id, &roots, &notes, level);
    rewrite(&checkout, Some(&command))
}

/// Take the guard out of a checkout whose lead was removed.
#[tauri::command]
pub fn lead_guard_remove(checkout: String) -> Result<(), String> {
    rewrite(&checkout, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard(level: u8) -> Guard {
        Guard {
            roots: vec![
                PathBuf::from("/Users/me/code/shop"),
                PathBuf::from("/Users/me/code/shop-worktrees"),
            ],
            notes: PathBuf::from("/Users/me/.config/observatory/leads"),
            level,
            home: PathBuf::from("/Users/me"),
            cwd: PathBuf::from("/Users/me/code/shop"),
        }
    }

    fn bash(g: &Guard, cmd: &str) -> Verdict {
        g.judge("Bash", &json!({ "command": cmd }))
    }

    fn is_ask(v: &Verdict) -> bool {
        matches!(v, Verdict::Ask(_))
    }
    fn is_deny(v: &Verdict) -> bool {
        matches!(v, Verdict::Deny(_))
    }

    #[test]
    fn reads_inside_the_project_and_notes_but_asks_elsewhere() {
        let g = guard(3);
        assert_eq!(
            g.judge(
                "Read",
                &json!({ "file_path": "/Users/me/code/shop/README.md" })
            ),
            Verdict::Allow
        );
        assert_eq!(
            g.judge("Read", &json!({ "file_path": "src/app.ts" })),
            Verdict::Allow
        );
        assert_eq!(
            g.judge(
                "Read",
                &json!({ "file_path": "/Users/me/code/shop-worktrees/fix/a.ts" })
            ),
            Verdict::Allow
        );
        assert_eq!(
            g.judge(
                "Read",
                &json!({ "file_path": "~/.config/observatory/leads/shop.md" })
            ),
            Verdict::Allow
        );
        assert_eq!(g.judge("Grep", &json!({ "pattern": "x" })), Verdict::Allow);
        assert!(is_ask(&g.judge(
            "Read",
            &json!({ "file_path": "/Users/me/code/billing/.env" })
        )));
        assert!(is_ask(
            &g.judge("Read", &json!({ "file_path": "../billing/README.md" }))
        ));
        assert!(is_ask(
            &g.judge("Glob", &json!({ "path": "/Users/me/code" }))
        ));
        assert!(is_deny(&g.judge(
            "Read",
            &json!({ "file_path": "~/Library/Keychains/login.keychain-db" })
        )));
    }

    #[test]
    fn writes_only_its_notes() {
        let g = guard(4);
        assert_eq!(
            g.judge(
                "Write",
                &json!({ "file_path": "/Users/me/.config/observatory/leads/shop.md" })
            ),
            Verdict::Allow
        );
        assert!(is_deny(&g.judge(
            "Edit",
            &json!({ "file_path": "/Users/me/code/shop/src/app.ts" })
        )));
        assert!(is_deny(&g.judge(
            "Write",
            &json!({ "file_path": "/Users/me/code/billing/x" })
        )));
        assert!(is_deny(&g.judge(
            "Write",
            &json!({ "file_path": "/Users/me/.config/observatory/leads/../../../.zshrc" })
        )));
    }

    #[test]
    fn shell_commands_that_act_for_it_are_refused() {
        let g = guard(4);
        for cmd in [
            "nebula spawn \"fix it\"",
            "cd /Users/me/code/shop && nebula send a1 hi",
            "/opt/homebrew/bin/nebula worktree x",
            "git push origin main",
            "git -C . commit -m x",
            "gh pr merge 12 --squash",
            "gh release create v1",
        ] {
            assert!(is_deny(&bash(&g, cmd)), "{cmd}");
        }
        for cmd in [
            "nebula ask lead-billing \"what's the API?\"",
            "nebula sessions --json",
            "git status",
            "git log --oneline -5",
            "gh pr view 12",
            "ls -la",
            "cat README.md > /dev/null",
        ] {
            assert_eq!(bash(&g, cmd), Verdict::Allow, "{cmd}");
        }
    }

    #[test]
    fn shell_paths_outside_the_project_ask_and_library_is_refused() {
        let g = guard(3);
        assert!(is_ask(&bash(&g, "cat /Users/me/code/billing/.env")));
        assert!(is_ask(&bash(&g, "cd ~/Documents && ls")));
        assert!(is_deny(&bash(&g, "ls ~/Library/Application\\ Support")));
        assert!(is_deny(&bash(
            &g,
            "cat \"$HOME/Library/Preferences/x.plist\""
        )));
        assert_eq!(
            bash(&g, "cat ~/.config/observatory/leads/shop.md"),
            Verdict::Allow
        );
        assert_eq!(bash(&g, "ls /Users/me/code/shop-worktrees"), Verdict::Allow);
        assert_eq!(bash(&g, "echo hi > /tmp/x"), Verdict::Allow);
    }

    #[test]
    fn links_are_refused_at_watch_and_need_a_sender_above_it() {
        let link = "open \"observatory://new-task?project=shop&prompt=x&from=$NEBULA_AGENT_ID\"";
        assert!(is_deny(&bash(&guard(1), link)));
        assert_eq!(bash(&guard(2), link), Verdict::Allow);
        assert!(is_deny(&bash(
            &guard(2),
            "open \"observatory://new-task?project=shop&prompt=x\""
        )));
    }

    #[test]
    fn other_tools_pass_and_allow_prints_nothing() {
        let g = guard(1);
        assert_eq!(
            g.judge("WebSearch", &json!({ "query": "x" })),
            Verdict::Allow
        );
        assert_eq!(hook_output(&Verdict::Allow), None);
        let out = hook_output(&Verdict::Deny("no".into())).unwrap();
        assert_eq!(out["hookSpecificOutput"]["permissionDecision"], "deny");
        assert_eq!(out["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    }

    #[test]
    fn the_hook_group_replaces_its_own_and_keeps_everyone_elses() {
        let theirs = json!({ "_nebulaManaged": true, "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "curl x" }] });
        let start = json!({ "permissions": { "allow": ["Bash(ls)"] }, "hooks": { "PreToolUse": [theirs.clone()], "Stop": [] } });
        let once = with_guard(start.as_object().unwrap().clone(), Some("guard 1")).unwrap();
        let twice = with_guard(once, Some("guard 2")).unwrap();
        let pre = twice["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 2);
        assert_eq!(pre[0], theirs);
        assert_eq!(pre[1]["hooks"][0]["command"], "guard 2");
        assert_eq!(twice["permissions"]["allow"][0], "Bash(ls)");
        let gone = with_guard(twice, None).unwrap();
        assert_eq!(
            gone["hooks"]["PreToolUse"].as_array().unwrap(),
            &vec![theirs]
        );
        let empty = with_guard(Map::new(), Some("g")).unwrap();
        assert!(with_guard(empty, None).unwrap().is_empty());
    }

    #[test]
    fn the_hook_command_is_inert_for_other_sessions_and_asks_when_it_cannot_run() {
        let cmd = hook_command(
            "/Apps/Obs.app/Contents/MacOS/observatory",
            "a1",
            &["/r/it's".into()],
            "~/n.md",
            3,
        );
        assert!(cmd.starts_with("[ \"$NEBULA_AGENT_ID\" = 'a1' ] || exit 0;"));
        assert!(cmd.contains("--level 3"));
        assert!(cmd.contains(r"--root '/r/it'\''s'"));
        assert!(cmd.contains("\"permissionDecision\":\"ask\""));
        let out = std::process::Command::new("sh")
            .arg("-c")
            .arg(hook_command(
                "/nonexistent/observatory",
                "a1",
                &[],
                "~/n.md",
                3,
            ))
            .env("NEBULA_AGENT_ID", "someone-else")
            .output()
            .unwrap();
        assert!(out.status.success() && out.stdout.is_empty());
        let out = std::process::Command::new("sh")
            .arg("-c")
            .arg(hook_command(
                "/nonexistent/observatory",
                "a1",
                &[],
                "~/n.md",
                3,
            ))
            .env("NEBULA_AGENT_ID", "a1")
            .output()
            .unwrap();
        let printed: Value = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(printed["hookSpecificOutput"]["permissionDecision"], "ask");
    }
}
