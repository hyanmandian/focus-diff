//! Optional AI, on the person's own subscription: it runs the coding agent CLI they already have
//! installed and signed in (Claude Code or Cursor), never a login or key of ours.
//!
//! How it's run follows each tool's rules for this:
//! - their own, unmodified binary, signed in by them in their terminal; this app never reads or
//!   stores their credentials;
//! - read-only: Claude Code gets only its Read, Grep and Glob tools, Cursor runs in "ask" mode, so
//!   neither can edit files or run commands;
//! - in the pull request's own code (checkout.rs), so it can look at where the changed code is used
//!   and what it affects, with the repository's rules (CLAUDE.md, AGENTS.md, .cursor/rules); but
//!   with no project settings, hooks or MCP servers, which a pull request's author controls. Without
//!   that checkout, in an empty folder with no tools at all;
//! - the material (the diff, the description) on standard input, with a time limit.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use crate::i18n::tr;

const TIME_LIMIT: Duration = Duration::from_secs(180);
/// Reading around a project takes longer than reading a diff.
const PROJECT_TIME_LIMIT: Duration = Duration::from_secs(600);
const MAX_INPUT: usize = 400_000; // characters; more is cut, with a note
const READ_ONLY_TOOLS: &str = "Read,Grep,Glob";

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Cursor,
}

impl Provider {
    const ALL: [Provider; 2] = [Provider::Claude, Provider::Cursor];

    fn binaries(self) -> &'static [&'static str] {
        match self {
            Provider::Claude => &["claude"],
            Provider::Cursor => &["agent", "cursor-agent"],
        }
    }

    /// What to run in Terminal to sign in, for the account this app uses: Claude Code's default
    /// one (~/.claude), named outright when the person's terminal is set to another.
    fn login_command(self) -> String {
        match self {
            Provider::Claude if login_env().claude_config_dir.is_some() => "CLAUDE_CONFIG_DIR=~/.claude claude auth login".into(),
            Provider::Claude => "claude auth login".into(),
            Provider::Cursor => "agent login".into(),
        }
    }

    /// How hard it thinks, in the CLI's own words; anything else is left to its default.
    fn effort(self, effort: Option<&str>) -> Option<&'static str> {
        let allowed: &[&'static str] = match self {
            Provider::Claude => &["low", "medium", "high", "xhigh", "max"],
            // Cursor's effort is part of the model's name.
            Provider::Cursor => &[],
        };
        let effort = effort?.trim();
        allowed.iter().copied().find(|a| *a == effort)
    }
}

#[derive(Serialize)]
pub struct Status {
    provider: Provider,
    installed: bool,
    signed_in: bool,
    version: Option<String>,
    login_command: String,
}

/// What the person's login shell has that apps opened from the Finder or a launcher don't: its
/// PATH (these CLIs usually live in ~/.local/bin, Homebrew or a Node version manager), and whether
/// the terminal uses another Claude Code account than the default (CLAUDE_CONFIG_DIR), to say how
/// to sign in to the one the app uses.
struct LoginEnv {
    path: String,
    claude_config_dir: Option<String>,
}

fn login_env() -> &'static LoginEnv {
    static ENV: OnceLock<LoginEnv> = OnceLock::new();
    ENV.get_or_init(|| {
        // Filled in from the login shell on Mac and Linux (below); as they are on Windows.
        #[cfg_attr(windows, allow(unused_mut))]
        let mut path = std::env::var("PATH").unwrap_or_default();
        #[cfg_attr(windows, allow(unused_mut))]
        let mut claude_config_dir = std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|d| !d.is_empty());
        #[cfg(unix)]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            if let Ok(output) = run_with_limit(Command::new(shell).args(["-l", "-c", "printf '%s\\n%s' \"$PATH\" \"${CLAUDE_CONFIG_DIR-}\""]), None, Duration::from_secs(5))
                && output.status_ok {
                    let mut lines = output.stdout.lines();
                    if let Some(shell_path) = lines.next().map(str::trim).filter(|p| !p.is_empty()) {
                        path = format!("{shell_path}:{path}");
                    }
                    if let Some(dir) = lines.next().map(str::trim).filter(|d| !d.is_empty() && Path::new(d).is_dir()) {
                        claude_config_dir = Some(dir.to_string());
                    }
                }
            if let Some(home) = std::env::var_os("HOME") {
                let home = PathBuf::from(home);
                for dir in [".local/bin", ".claude/local", ".npm-global/bin", ".bun/bin", ".cargo/bin"] {
                    path.push(':');
                    path.push_str(&home.join(dir).to_string_lossy());
                }
            }
            path.push_str(":/opt/homebrew/bin:/usr/local/bin");
        }
        // The default account isn't another one.
        let default = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude"));
        let claude_config_dir = claude_config_dir.filter(|d| default.as_deref() != Some(Path::new(d.trim_end_matches('/'))));
        LoginEnv { path, claude_config_dir }
    })
}

pub(crate) fn search_path() -> &'static str {
    &login_env().path
}

fn find(provider: Provider) -> Option<PathBuf> {
    find_in(search_path(), provider.binaries())
}

fn find_in(path: &str, names: &[&str]) -> Option<PathBuf> {
    let extensions: &[&str] = if cfg!(windows) { &[".exe", ".cmd"] } else { &[""] };
    for dir in std::env::split_paths(path).filter(|dir| !dir.as_os_str().is_empty()) {
        for name in names {
            for extension in extensions {
                let candidate = dir.join(format!("{name}{extension}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

pub(crate) struct Output {
    pub status_ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a command with its own environment's PATH, optional input on stdin, and a time limit after
/// which it's killed.
pub(crate) fn run_with_limit(command: &mut Command, input: Option<&str>, limit: Duration) -> Result<Output, String> {
    run_until(command, input, limit, None)
}

/// `run_with_limit`, also stopped when `cancel` is set. What it started goes with it: it runs in a
/// process group of its own, ended whole, and its output is waited for only briefly once it's done,
/// so something it left behind holding the output can't keep us waiting.
pub(crate) fn run_until(command: &mut Command, input: Option<&str>, limit: Duration, cancel: Option<&AtomicBool>) -> Result<Output, String> {
    command.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(command, 0);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stop = |child: &mut std::process::Child| {
        #[cfg(unix)]
        let _ = Command::new("/bin/kill").args(["-TERM", &format!("-{}", child.id())]).stdout(Stdio::null()).stderr(Stdio::null()).status();
        let _ = child.kill();
        let _ = child.wait();
    };
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        let input = input.to_string();
        // Written from a thread so a full pipe can't block us while the child waits to be read.
        std::thread::spawn(move || {
            let _ = stdin.write_all(input.as_bytes());
        });
    }
    let stdout = child.stdout.take().ok_or("No output")?;
    let stderr = child.stderr.take().ok_or("No output")?;
    let read = |mut pipe: Box<dyn Read + Send>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = pipe.read_to_string(&mut s);
            let _ = tx.send(s);
        });
        rx
    };
    let out = read(Box::new(stdout));
    let err = read(Box::new(stderr));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            stop(&mut child);
            return Err(tr!("Stopped", "Interrompido"));
        }
        if started.elapsed() > limit {
            stop(&mut child);
            return Err(tr!("It took too long and was stopped", "Demorou demais e foi interrompido"));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    #[cfg(unix)]
    let _ = Command::new("/bin/kill").args(["-TERM", &format!("-{}", child.id())]).stdout(Stdio::null()).stderr(Stdio::null()).status();
    let grace = Duration::from_secs(2);
    Ok(Output { status_ok: status.success(), stdout: out.recv_timeout(grace).unwrap_or_default(), stderr: err.recv_timeout(grace).unwrap_or_default() })
}

fn command(binary: &Path) -> Command {
    let mut command = Command::new(binary);
    command.env("PATH", search_path());
    // Claude Code's default account (~/.claude), however the app was opened. When the terminal is
    // set to another account, it's named outright, as the sign-in command we show names it: Claude
    // Code keeps an account named that way apart from the unnamed default.
    command.env_remove("CLAUDE_CONFIG_DIR");
    if login_env().claude_config_dir.is_some()
        && let Some(home) = std::env::var_os("HOME") {
            command.env("CLAUDE_CONFIG_DIR", PathBuf::from(home).join(".claude"));
        }
    command
}

/// Questions being answered, by the id the window gave them, so they can be stopped.
fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

/// A question's stop flag, kept while it's answered.
pub fn start_run(id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    running().lock().unwrap().insert(id.to_string(), flag.clone());
    flag
}

pub fn end_run(id: &str) {
    running().lock().unwrap().remove(id);
}

/// Stops a question being answered (the window's Stop).
pub fn cancel(id: &str) {
    if let Some(flag) = running().lock().unwrap().get(id) {
        flag.store(true, Ordering::Relaxed);
    }
}

pub fn status(provider: Provider) -> Status {
    let Some(binary) = find(provider) else {
        return Status { provider, installed: false, signed_in: false, version: None, login_command: provider.login_command() };
    };
    let version = run_with_limit(command(&binary).arg("--version"), None, Duration::from_secs(10))
        .ok()
        .filter(|o| o.status_ok)
        .map(|o| o.stdout.lines().next().unwrap_or_default().trim().to_string());
    let args: &[&str] = match provider {
        Provider::Claude => &["auth", "status"],
        Provider::Cursor => &["status"],
    };
    let signed_in = run_with_limit(command(&binary).args(args), None, Duration::from_secs(15))
        .map(|o| {
            let text = format!("{}{}", o.stdout, o.stderr).to_lowercase();
            // Cursor's CLI says it's logged in even when its token no longer works, but then can't
            // fetch the account: that's not signed in for our purposes.
            o.status_ok
                && !text.contains("not logged in")
                && !text.contains("not authenticated")
                && !text.contains("authentication required")
                && !text.contains("unable to fetch user details")
        })
        .unwrap_or(false);
    Status { provider, installed: true, signed_in, version, login_command: provider.login_command() }
}

pub fn statuses() -> Vec<Status> {
    std::thread::scope(|s| {
        let checks: Vec<_> = Provider::ALL.into_iter().map(|p| s.spawn(move || status(p))).collect();
        checks.into_iter().filter_map(|c| c.join().ok()).collect()
    })
}

/// The models the CLI offers on this account, to suggest; empty when it can't list them.
pub fn models(provider: Provider) -> Vec<String> {
    match provider {
        // Aliases for the latest of each, as Claude Code takes them.
        Provider::Claude => ["fable", "opus", "sonnet", "haiku"].map(String::from).to_vec(),
        Provider::Cursor => {
            let Some(binary) = find(provider) else { return vec![] };
            let Ok(output) = run_with_limit(command(&binary).arg("--list-models"), None, Duration::from_secs(20)) else { return vec![] };
            if !output.status_ok {
                return vec![];
            }
            let id = |s: &str| !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:[]=,".contains(c)) && s.chars().any(|c| c.is_ascii_digit() || c == '-');
            let mut found: Vec<String> = output.stdout.lines().filter_map(|l| l.split_whitespace().next()).filter(|t| id(t)).map(String::from).collect();
            found.dedup();
            found.truncate(200);
            found
        }
    }
}

/// A question for the person's AI.
pub struct Question<'a> {
    pub provider: Provider,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
    pub prompt: &'a str,
    /// The material: description and diff.
    pub input: &'a str,
    /// The pull request's code, to read around in; None for the diff alone.
    pub project: Option<&'a Path>,
    /// A JSON Schema the answer must follow; the answer is then that JSON.
    pub schema: Option<&'a str>,
    /// Set to stop it.
    pub cancel: Option<&'a AtomicBool>,
}

/// Asks the person's agent CLI and returns its answer. Blocking: run it off the main thread.
pub fn ask(q: Question) -> Result<String, String> {
    let binary = find(q.provider).ok_or_else(|| tr!("It isn't installed", "Não está instalado"))?;
    if let Some(project) = q.project {
        return ask_in(&q, &binary, project);
    }
    static RUNS: AtomicU64 = AtomicU64::new(0);
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    let workspace = std::env::temp_dir().join(format!("focus-diff-{}-{stamp}-{}", std::process::id(), RUNS.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    let result = ask_in(&q, &binary, &workspace);
    let _ = std::fs::remove_dir_all(&workspace);
    result
}

fn ask_in(q: &Question, binary: &Path, workspace: &Path) -> Result<String, String> {
    let mut material: String = q.input.chars().take(MAX_INPUT).collect();
    if material.len() < q.input.len() {
        material.push_str("\n\n[The rest was cut to fit.]");
    }
    let mut prompt = q.prompt.to_string();
    if let (Provider::Cursor, Some(schema)) = (q.provider, q.schema) {
        prompt.push_str(&format!("\n\nReply with only a JSON object, no other text, following this JSON Schema:\n{schema}"));
    }
    let message = format!("{prompt}\n\n---\n\n{material}");
    let model = q.model.map(str::trim).filter(|m| !m.is_empty());
    let limit = if q.project.is_some() { PROJECT_TIME_LIMIT } else { TIME_LIMIT };
    let mut cmd = command(binary);
    cmd.current_dir(workspace);
    let answer = match q.provider {
        Provider::Claude => {
            let tools = if q.project.is_some() { READ_ONLY_TOOLS } else { "" };
            cmd.args(["-p", "--output-format", "json", "--tools", tools, "--allowedTools", tools, "--permission-mode", "dontAsk", "--no-session-persistence", "--strict-mcp-config"]);
            // The user's own settings only: a repository's .claude/settings.json (hooks,
            // permissions) is its author's, not the reviewer's. And none of their hooks: those are
            // for their own sessions, and would be handed the pull request (or hold the answer up).
            cmd.args(["--setting-sources", "user", "--settings", r#"{"disableAllHooks":true}"#]);
            if let Some(model) = model {
                cmd.args(["--model", model]);
            }
            if let Some(effort) = q.provider.effort(q.effort) {
                cmd.args(["--effort", effort]);
            }
            if let Some(schema) = q.schema {
                cmd.args(["--json-schema", schema]);
            }
            let output = run_until(&mut cmd, Some(&message), limit, q.cancel)?;
            let reply: serde_json::Value = serde_json::from_str(output.stdout.trim()).map_err(|_| failure(&output))?;
            if reply["is_error"].as_bool() == Some(true) {
                return Err(reply["result"].as_str().map(String::from).unwrap_or_else(|| tr!("Claude Code returned an error", "O Claude Code respondeu com um erro")));
            }
            if q.schema.is_some() && reply["structured_output"].is_object() {
                reply["structured_output"].to_string()
            } else {
                reply["result"].as_str().map(str::to_string).ok_or_else(|| failure(&output))?
            }
        }
        Provider::Cursor => {
            // "ask" mode reads and answers, nothing else; MCP servers stay off without --approve-mcps.
            cmd.args(["-p", "--output-format", "json", "--mode", "ask", "--sandbox", "enabled", "--trust", "--workspace"]).arg(workspace);
            if let Some(model) = model {
                cmd.args(["--model", model]);
            }
            // Cursor's CLI takes the whole prompt as an argument.
            cmd.arg(&message);
            let output = run_until(&mut cmd, None, limit, q.cancel)?;
            let reply: serde_json::Value = serde_json::from_str(output.stdout.trim()).map_err(|_| failure(&output))?;
            let text = reply["result"].as_str().map(str::to_string).ok_or_else(|| failure(&output))?;
            if q.schema.is_some() { json_object(&text).ok_or_else(|| tr!("The answer wasn't in the expected form", "A resposta não veio no formato esperado"))? } else { text }
        }
    };
    Ok(answer.trim().to_string())
}

/// The JSON object in a reply that may wrap it in prose or a code fence.
fn json_object(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    let candidate = text.get(start..=end)?;
    serde_json::from_str::<serde_json::Value>(candidate).ok().filter(|v| v.is_object()).map(|v| v.to_string())
}

/// The most useful line of what a CLI said when it failed: its last error line, or the start of
/// what it printed.
fn failure(output: &Output) -> String {
    let text = format!("{}\n{}", output.stderr, output.stdout);
    let line = text.lines().rev().map(str::trim).find(|l| !l.is_empty()).map(String::from).unwrap_or_else(|| tr!("It didn't answer", "Não houve resposta"));
    line.chars().take(400).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_json_in_prose() {
        assert_eq!(json_object("Sure:\n```json\n{\"findings\": []}\n```").as_deref(), Some("{\"findings\":[]}"));
        assert_eq!(json_object("no json here"), None);
    }

    #[test]
    fn finds_what_the_system_can_run() {
        let dir = std::env::temp_dir().join(format!("fd-find-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("claude"), "#!/bin/sh").unwrap();
        std::fs::write(dir.join("claude.cmd"), "@echo off").unwrap();
        let path = std::env::join_paths([dir.join("missing"), dir.clone()]).unwrap();
        let found = find_in(path.to_str().unwrap(), &["agent", "claude"]);
        assert_eq!(found, Some(dir.join(if cfg!(windows) { "claude.cmd" } else { "claude" })));
        assert_eq!(find_in(path.to_str().unwrap(), &["agent"]), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Talks to the CLIs installed on this machine, so it's opt-in: `cargo test -- --ignored ai`.
    #[test]
    #[ignore]
    fn ai_round_trip() {
        for status in statuses() {
            println!("{:?}: installed {}, signed in {}, {:?}", status.provider, status.installed, status.signed_in, status.version);
        }
        let ask_claude = |project| ask(Question { provider: Provider::Claude, model: Some("haiku"), effort: Some("low"), prompt: "Reply with exactly the word in the material.", input: "PONG", project, schema: None, cancel: None });
        assert_eq!(ask_claude(None).as_deref(), Ok("PONG"));
        println!("Cursor: {:?}", ask(Question { provider: Provider::Cursor, model: None, effort: None, prompt: "Reply with exactly: OK", input: "", project: None, schema: None, cancel: None }));
    }
}
