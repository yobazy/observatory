//! Run free: a project whose card says so runs its threads without
//! permission prompts. One `PreToolUse` hook in your Claude settings
//! (`~/.claude/settings.json`) runs this binary with `--permissions` before
//! each tool call in a nebula thread. It works out the thread's project from
//! the folder it runs in (a worktree counts as its repo's), so a worktree made
//! a moment ago is covered too, and reads the app's list of Run free projects:
//!
//! - Outside a Run free project it says nothing, and Claude Code asks as usual.
//! - Inside one it allows the call, except:
//!   - it refuses `~/Library`, your keys and sign-ins (`~/.ssh`, `~/.aws`, …),
//!     deleting a folder outside the checkout (or the checkout itself),
//!     force-pushing main, and wiping disks;
//!   - it says nothing (so the usual rules decide) for writes and paths
//!     elsewhere in your home, `sudo`, keychain and system changes, force
//!     pushes to other branches, and tools it doesn't know, MCP tools among
//!     them.
//!
//! The hook is in your settings only while some project is on Run free, and
//! it's inert outside nebula threads (it checks `NEBULA_AGENT_ID`) and for
//! leads, which keep their own guard (lead_guard.rs).

use crate::lead_guard::{home, lexical, quote, subcommand, words};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// The flag that runs the check instead of the app.
pub const FLAG: &str = "--permissions";
/// Marks the hook group as this app's; its value is the build, so the
/// installed app and a dev build each keep their own.
const MARK: &str = "_observatoryPermissions";
const LEVEL_FREE: &str = "free";

/// A project's rule, as the app hands it over: its main checkout and level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectRule {
    pub root: String,
    pub level: String,
}

/// What the check reads: the projects with a rule, and threads to leave alone.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Config {
    #[serde(default)]
    pub projects: Vec<ProjectRule>,
    /// Leads' agent ids: their guard decides for them.
    #[serde(default)]
    pub skip: Vec<String>,
}

/// What the check says about one tool call.
#[derive(Debug, PartialEq, Eq)]
pub enum Call {
    Allow,
    Deny(String),
    /// Nothing: Claude Code's own rules decide, as without the hook.
    Pass,
}

/// The checkout a folder is in: its top, and the repo's main checkout (the
/// same folder unless it's a worktree). None outside git.
fn checkout_of(dir: &Path) -> Option<(PathBuf, PathBuf)> {
    for top in dir.ancestors() {
        let git = top.join(".git");
        if git.is_dir() {
            return Some((top.to_path_buf(), top.to_path_buf()));
        }
        if let Ok(text) = std::fs::read_to_string(&git) {
            let gitdir = text.trim().strip_prefix("gitdir:")?.trim();
            let gitdir = lexical(&top.join(gitdir));
            // `<main>/.git/worktrees/<name>`
            let mut main = PathBuf::new();
            for c in gitdir.components() {
                if c.as_os_str() == ".git" {
                    return Some((top.to_path_buf(), main));
                }
                main.push(c);
            }
            return Some((top.to_path_buf(), top.to_path_buf()));
        }
    }
    None
}

/// `p` as the disk has it (`/var` is `/private/var` on macOS), or as written.
fn real(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| lexical(p))
}

impl Config {
    /// The folders a thread in `cwd` may use freely, when it's in a Run free
    /// project: its own checkout and the project's main one.
    pub fn free_roots(&self, cwd: &Path) -> Option<Vec<PathBuf>> {
        let cwd = real(cwd);
        let checkout = checkout_of(&cwd).map(|(top, main)| (real(&top), real(&main)));
        self.projects
            .iter()
            .filter(|r| r.level == LEVEL_FREE)
            .find_map(|r| {
                let root = real(Path::new(&r.root));
                match &checkout {
                    Some((top, main)) if *main == root => Some(vec![top.clone(), root]),
                    _ if cwd.starts_with(&root) => Some(vec![root]),
                    _ => None,
                }
            })
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Place {
    Project,
    Temp,
    Library,
    Secrets,
    /// Under your home, outside the project.
    Home,
    /// Outside your home: `/usr`, `/dev/null`.
    System,
}

/// Where keys and sign-ins live, under your home.
const SECRETS: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".netrc",
    ".kube",
    ".docker/config.json",
    ".config/gh",
    ".config/gcloud",
];

/// Programs that wipe or repartition disks.
const WIPES: &[&str] = &["diskutil", "dd", "mkfs", "fdisk", "newfs_apfs"];
/// Programs that change the system or your keychain: the usual rules decide.
const SYSTEM: &[&str] = &[
    "sudo",
    "su",
    "security",
    "launchctl",
    "crontab",
    "osascript",
    "defaults",
    "chown",
    "shutdown",
    "reboot",
];
/// Tools that only work in the session or on the web, allowed outright.
const SESSION_TOOLS: &[&str] = &[
    "WebFetch",
    "WebSearch",
    "TodoWrite",
    "Task",
    "Agent",
    "BashOutput",
    "KillShell",
];

pub struct Check {
    pub roots: Vec<PathBuf>,
    pub home: PathBuf,
    pub cwd: PathBuf,
    pub temp: Vec<PathBuf>,
}

impl Check {
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
        if self.roots.iter().any(|r| p.starts_with(r)) {
            Place::Project
        } else if self.temp.iter().any(|t| p.starts_with(t)) {
            Place::Temp
        } else if p.starts_with(self.home.join("Library")) {
            Place::Library
        } else if SECRETS.iter().any(|s| p.starts_with(self.home.join(s))) {
            Place::Secrets
        } else if p.starts_with(&self.home) {
            Place::Home
        } else {
            Place::System
        }
    }

    fn refused(&self, p: &Path, place: &Place) -> Option<Call> {
        match place {
            Place::Library => Some(Call::Deny(format!(
                "{} is in ~/Library, which Run free never touches.",
                p.display()
            ))),
            Place::Secrets => Some(Call::Deny(format!(
                "{} holds keys or sign-ins, which Run free never touches.",
                p.display()
            ))),
            _ => None,
        }
    }

    fn file(&self, raw: Option<&str>, writes: bool) -> Call {
        let Some(raw) = raw.filter(|r| !r.trim().is_empty()) else {
            return Call::Allow;
        };
        let p = self.resolve(raw);
        let place = self.place(&p);
        if let Some(no) = self.refused(&p, &place) {
            return no;
        }
        match place {
            Place::Project | Place::Temp => Call::Allow,
            Place::System if !writes => Call::Allow,
            _ => Call::Pass,
        }
    }

    fn removes(&self, args: &[String]) -> Option<Call> {
        let recursive = args.iter().any(|a| {
            a == "--recursive"
                || (a.starts_with('-') && !a.starts_with("--") && a.contains(['r', 'R']))
        });
        if !recursive {
            return None;
        }
        for a in args.iter().filter(|a| !a.starts_with('-')) {
            let p = self.resolve(a);
            let inside = matches!(self.place(&p), Place::Project | Place::Temp);
            if !inside || self.roots.contains(&p) || self.temp.contains(&p) {
                return Some(Call::Deny(format!(
                    "Run free doesn't delete {}: only folders inside the checkout.",
                    p.display()
                )));
            }
        }
        None
    }

    fn pushes(&self, args: &[String]) -> Option<Call> {
        let force = args.iter().any(|a| {
            a == "-f"
                || a.starts_with("--force")
                || (a.starts_with('-') && !a.starts_with("--") && a.contains('f'))
        }) || args.iter().any(|a| a.starts_with('+'));
        if !force {
            return None;
        }
        let main = args.iter().any(|a| {
            let dest = a.trim_start_matches('+');
            let dest = dest.rsplit(':').next().unwrap_or(dest);
            let dest = dest.strip_prefix("refs/heads/").unwrap_or(dest);
            dest == "main" || dest == "master"
        });
        Some(if main {
            Call::Deny("Run free never force-pushes main.".into())
        } else {
            Call::Pass
        })
    }

    fn shell(&self, command: &str) -> Call {
        let words = words(command);
        // Each program and its arguments, up to the next operator.
        let mut pass = false;
        for (i, w) in words.iter().enumerate() {
            let name = w.rsplit('/').next().unwrap_or(w);
            let rest = &words[i + 1..];
            if WIPES.contains(&name) {
                return Call::Deny(format!("Run free never runs `{name}`."));
            }
            if SYSTEM.contains(&name) {
                pass = true;
            }
            if name == "rm" {
                if let Some(no) = self.removes(rest) {
                    return no;
                }
            }
            if name == "git" && subcommand(rest) == Some("push") {
                match self.pushes(rest) {
                    Some(Call::Pass) => pass = true,
                    Some(no) => return no,
                    None => {}
                }
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
            let place = self.place(&p);
            if let Some(no) = self.refused(&p, &place) {
                return no;
            }
            if place == Place::Home {
                pass = true;
            }
        }
        if pass {
            Call::Pass
        } else {
            Call::Allow
        }
    }

    pub fn judge(&self, tool: &str, input: &Value) -> Call {
        let s = |k: &str| input.get(k).and_then(Value::as_str);
        match tool {
            "Read" => self.file(s("file_path"), false),
            "Glob" | "Grep" | "LS" => self.file(s("path"), false),
            "NotebookRead" => self.file(s("notebook_path"), false),
            "Edit" | "Write" | "MultiEdit" => self.file(s("file_path"), true),
            "NotebookEdit" => self.file(s("notebook_path"), true),
            "Bash" => self.shell(s("command").unwrap_or("")),
            t if SESSION_TOOLS.contains(&t) => Call::Allow,
            _ => Call::Pass,
        }
    }
}

/// What the hook prints: nothing for Pass, so Claude Code's own rules decide.
pub fn hook_output(c: &Call) -> Option<Value> {
    let (decision, reason) = match c {
        Call::Pass => return None,
        Call::Allow => ("allow", "this project runs free."),
        Call::Deny(r) => ("deny", r.as_str()),
    };
    Some(json!({ "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": format!("Observatory: {reason}"),
    }}))
}

fn temp_dirs() -> Vec<PathBuf> {
    let mut out = vec![
        PathBuf::from("/tmp"),
        PathBuf::from("/private/tmp"),
        PathBuf::from("/var/folders"),
        PathBuf::from("/private/var/folders"),
    ];
    if let Some(t) = std::env::var_os("TMPDIR") {
        out.push(lexical(Path::new(&t)));
    }
    out
}

/// The verdict for one hook call: the app's config, the tool call as Claude
/// Code sends it on stdin, and the thread's agent id.
pub fn decide(config: &Config, call: &Value, agent: &str, home: PathBuf) -> Call {
    if agent.is_empty() || config.skip.iter().any(|s| s == agent) {
        return Call::Pass;
    }
    let Some(cwd) = call.get("cwd").and_then(Value::as_str).map(PathBuf::from) else {
        return Call::Pass;
    };
    let Some(roots) = config.free_roots(&cwd) else {
        return Call::Pass;
    };
    let check = Check {
        roots,
        home: real(&home),
        cwd: real(&cwd),
        temp: temp_dirs(),
    };
    let tool = call.get("tool_name").and_then(Value::as_str).unwrap_or("");
    let input = call.get("tool_input").cloned().unwrap_or(Value::Null);
    check.judge(tool, &input)
}

/// `--permissions --config <file>`, with the tool call on stdin. Any trouble
/// reading either says nothing, so the usual prompt shows.
pub fn run_cli(args: &[String]) -> i32 {
    let mut config_path = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--config" {
            config_path = it.next().map(PathBuf::from);
        }
    }
    let config: Config = config_path
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let mut stdin = String::new();
    let _ = std::io::stdin().read_to_string(&mut stdin);
    let call: Value = serde_json::from_str(&stdin).unwrap_or(Value::Null);
    let agent = std::env::var("NEBULA_AGENT_ID").unwrap_or_default();
    if let Some(out) = hook_output(&decide(&config, &call, &agent, home())) {
        println!("{out}");
    }
    0
}

// ---- installing it ----

fn build() -> &'static str {
    if cfg!(debug_assertions) {
        "dev"
    } else {
        "app"
    }
}

/// The hook's command: inert outside nebula threads, and silent when the app
/// can't run (moved, deleted), so the usual prompt shows.
pub fn hook_command(exe: &str, config: &str) -> String {
    format!(
        "[ -n \"$NEBULA_AGENT_ID\" ] || exit 0; {} {FLAG} --config {} || exit 0",
        quote(exe),
        quote(config)
    )
}

/// `settings` with this build's hook group taken out, and `command` put in
/// when given. Every other setting and hook is left as it was.
pub fn with_hook(
    mut settings: Map<String, Value>,
    build: &str,
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
    pre.retain(|g| g.get(MARK).and_then(Value::as_str) != Some(build));
    if let Some(command) = command {
        pre.push(json!({ MARK: build, "matcher": "*", "hooks": [{ "type": "command", "command": command, "timeout": 10 }] }));
    }
    if pre.is_empty() {
        hooks.remove("PreToolUse");
    }
    if hooks.is_empty() {
        settings.remove("hooks");
    }
    Ok(settings)
}

/// Your Claude settings file: `$CLAUDE_CONFIG_DIR/settings.json` when set.
fn claude_settings() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".claude"))
        .join("settings.json")
}

/// Write `path` through a temporary file, so a crash never leaves half of it.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.observatory-tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Put the hook in `path` or take it out, leaving the file alone when that
/// changes nothing (or it can't be read: your own settings are in it).
fn rewrite(path: &Path, build: &str, command: Option<&str>) -> Result<(), String> {
    let now = match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(m)) => m,
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
    let next =
        with_hook(now.clone(), build, command).map_err(|e| format!("{}: {e}", path.display()))?;
    if next == now {
        return Ok(());
    }
    let text = serde_json::to_string_pretty(&Value::Object(next)).map_err(|e| e.to_string())?;
    write_atomic(path, &(text + "\n"))
}

/// Hand over the Run free projects (and the leads to leave alone): saved for
/// the hook to read, and the hook put in your Claude settings while there's
/// at least one, taken out when there are none.
#[tauri::command]
pub fn permissions_sync(
    app: AppHandle,
    projects: Vec<ProjectRule>,
    skip: Vec<String>,
) -> Result<(), String> {
    let config_path = crate::app_dirs::config_dir(&app)?.join("permissions.json");
    let config = Config { projects, skip };
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    if std::fs::read_to_string(&config_path).ok().as_deref() != Some(text.as_str()) {
        write_atomic(&config_path, &text)?;
    }
    let command = if config.projects.iter().any(|p| p.level == LEVEL_FREE) {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        Some(hook_command(
            &exe.to_string_lossy(),
            &config_path.to_string_lossy(),
        ))
    } else {
        None
    };
    rewrite(&claude_settings(), build(), command.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check() -> Check {
        Check {
            roots: vec![
                PathBuf::from("/Users/me/code/shop-worktrees/fix"),
                PathBuf::from("/Users/me/code/shop"),
            ],
            home: PathBuf::from("/Users/me"),
            cwd: PathBuf::from("/Users/me/code/shop-worktrees/fix"),
            temp: vec![PathBuf::from("/tmp"), PathBuf::from("/private/tmp")],
        }
    }

    fn bash(cmd: &str) -> Call {
        check().judge("Bash", &json!({ "command": cmd }))
    }

    fn is_deny(c: &Call) -> bool {
        matches!(c, Call::Deny(_))
    }

    #[test]
    fn everyday_commands_run_without_asking() {
        for cmd in [
            "npm install && npm test",
            "cargo clippy --all-targets -- -D warnings",
            "git commit -am 'x' && git push -u origin fix",
            "rm -rf node_modules dist",
            "curl -s https://example.com | head",
            "gh pr create --draft --fill",
            "cat /usr/share/dict/words > /dev/null",
            "rm -rf /tmp/scratch",
        ] {
            assert_eq!(bash(cmd), Call::Allow, "{cmd}");
        }
    }

    #[test]
    fn files_in_the_checkout_are_allowed_and_elsewhere_ask_as_usual() {
        let c = check();
        let edit = |p: &str| c.judge("Edit", &json!({ "file_path": p }));
        assert_eq!(edit("src/app.ts"), Call::Allow);
        assert_eq!(edit("/Users/me/code/shop/README.md"), Call::Allow);
        assert_eq!(edit("/tmp/notes.txt"), Call::Allow);
        assert_eq!(edit("/Users/me/Documents/notes.md"), Call::Pass);
        assert_eq!(edit("/etc/hosts"), Call::Pass);
        assert_eq!(
            c.judge("Read", &json!({ "file_path": "/usr/include/stdio.h" })),
            Call::Allow
        );
        assert_eq!(
            c.judge("Read", &json!({ "file_path": "../../other/x.md" })),
            Call::Pass
        );
    }

    #[test]
    fn library_and_secrets_are_refused() {
        let c = check();
        assert!(is_deny(
            &c.judge("Read", &json!({ "file_path": "~/.ssh/id_ed25519" }))
        ));
        assert!(is_deny(&c.judge(
            "Write",
            &json!({ "file_path": "/Users/me/Library/LaunchAgents/x.plist" })
        )));
        assert!(is_deny(&bash("cat ~/.aws/credentials")));
        assert!(is_deny(&bash("ls $HOME/Library/Keychains")));
        assert!(is_deny(&bash("cp x ~/.config/gh/hosts.yml")));
    }

    #[test]
    fn deleting_outside_the_checkout_or_the_checkout_itself_is_refused() {
        assert!(is_deny(&bash("rm -rf ~")));
        assert!(is_deny(&bash("rm -rf /")));
        assert!(is_deny(&bash("rm -fr ../../shop")));
        assert!(is_deny(&bash("rm -r .")));
        assert!(is_deny(&bash("rm --recursive ~/Documents")));
        // Not recursive: an ordinary file delete, with the usual rules for
        // places outside the project.
        assert_eq!(bash("rm build.log"), Call::Allow);
        assert_eq!(bash("rm ~/Documents/old.txt"), Call::Pass);
    }

    #[test]
    fn force_pushing_main_is_refused_and_other_force_pushes_ask_as_usual() {
        assert!(is_deny(&bash("git push --force origin main")));
        assert!(is_deny(&bash("git push -f origin HEAD:main")));
        assert!(is_deny(&bash("git push origin +master")));
        assert_eq!(bash("git push --force-with-lease origin fix"), Call::Pass);
        assert_eq!(bash("git push origin main"), Call::Allow);
    }

    #[test]
    fn system_and_disk_commands_are_left_to_the_usual_rules_or_refused() {
        assert_eq!(bash("sudo rm /etc/x"), Call::Pass);
        assert_eq!(bash("security find-generic-password -s x"), Call::Pass);
        assert_eq!(bash("echo hi >> ~/.zshrc"), Call::Pass);
        assert!(is_deny(&bash("diskutil eraseDisk APFS x disk2")));
        assert!(is_deny(&bash("sudo dd if=/dev/zero of=/dev/disk2")));
    }

    #[test]
    fn unknown_and_mcp_tools_are_left_to_the_usual_rules() {
        let c = check();
        assert_eq!(c.judge("mcp__gmail__send_message", &json!({})), Call::Pass);
        assert_eq!(
            c.judge("WebFetch", &json!({ "url": "https://x" })),
            Call::Allow
        );
    }

    fn scratch(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("observatory-perm-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        real(&d)
    }

    #[test]
    fn a_worktree_counts_as_its_repos_project() {
        let d = scratch("wt");
        let main = d.join("shop");
        let wt = d.join("shop-worktrees/fix");
        std::fs::create_dir_all(main.join(".git/worktrees/fix")).unwrap();
        std::fs::create_dir_all(wt.join("src")).unwrap();
        std::fs::write(
            wt.join(".git"),
            format!("gitdir: {}\n", main.join(".git/worktrees/fix").display()),
        )
        .unwrap();
        let other = d.join("blog");
        std::fs::create_dir_all(other.join(".git")).unwrap();

        let config = Config {
            projects: vec![ProjectRule {
                root: main.to_string_lossy().into(),
                level: "free".into(),
            }],
            skip: vec!["lead-1".into()],
        };
        assert_eq!(
            config.free_roots(&wt.join("src")),
            Some(vec![wt.clone(), main.clone()])
        );
        assert_eq!(
            config.free_roots(&main),
            Some(vec![main.clone(), main.clone()])
        );
        assert_eq!(config.free_roots(&other), None);

        let call = |cwd: &Path| json!({ "cwd": cwd, "tool_name": "Bash", "tool_input": { "command": "npm test" } });
        let home = d.clone();
        assert_eq!(decide(&config, &call(&wt), "a1", home.clone()), Call::Allow);
        assert_eq!(
            decide(&config, &call(&other), "a1", home.clone()),
            Call::Pass
        );
        assert_eq!(
            decide(&config, &call(&wt), "lead-1", home.clone()),
            Call::Pass
        );
        assert_eq!(decide(&config, &call(&wt), "", home.clone()), Call::Pass);
        let ask = Config {
            projects: vec![ProjectRule {
                root: main.to_string_lossy().into(),
                level: "ask".into(),
            }],
            skip: vec![],
        };
        assert_eq!(decide(&ask, &call(&wt), "a1", home), Call::Pass);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_folder_outside_git_matches_by_path() {
        let d = scratch("plain");
        let config = Config {
            projects: vec![ProjectRule {
                root: d.to_string_lossy().into(),
                level: "free".into(),
            }],
            skip: vec![],
        };
        // The scratch folder is under the system temp dir, which has no .git above it.
        assert_eq!(config.free_roots(&d.join("sub")), Some(vec![d.clone()]));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_hook_goes_in_and_out_leaving_the_rest() {
        let settings: Map<String, Value> = serde_json::from_value(json!({
            "model": "opus",
            "permissions": { "defaultMode": "auto" },
            "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "mine" }] }] }
        }))
        .unwrap();
        let cmd = hook_command(
            "/Applications/Observatory.app/Contents/MacOS/observatory",
            "/Users/me/x y/permissions.json",
        );
        assert!(cmd.contains("'/Users/me/x y/permissions.json'"));
        let with = with_hook(settings.clone(), "app", Some(&cmd)).unwrap();
        assert_eq!(with["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
        // Installing again replaces it; a dev build's sits beside it.
        let again = with_hook(with.clone(), "app", Some(&cmd)).unwrap();
        assert_eq!(again, with);
        let dev = with_hook(with.clone(), "dev", Some("dev")).unwrap();
        assert_eq!(dev["hooks"]["PreToolUse"].as_array().unwrap().len(), 3);
        assert_eq!(with_hook(with, "app", None).unwrap(), settings);
        let bare = with_hook(Map::new(), "app", Some(&cmd)).unwrap();
        assert_eq!(with_hook(bare, "app", None).unwrap(), Map::new());
    }

    #[test]
    fn allow_and_deny_print_hook_json_and_pass_prints_nothing() {
        assert_eq!(hook_output(&Call::Pass), None);
        let out = hook_output(&Call::Allow).unwrap();
        assert_eq!(out["hookSpecificOutput"]["permissionDecision"], "allow");
        let out = hook_output(&Call::Deny("no".into())).unwrap();
        assert_eq!(out["hookSpecificOutput"]["permissionDecision"], "deny");
    }
}
