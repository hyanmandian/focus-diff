//! Optional AI, on the person's own subscription: it runs the coding agent CLI they already have
//! installed and signed in (Claude Code, Codex or Cursor), never a login or key of ours.
//!
//! How it's run follows each tool's rules for this:
//! - their own, unmodified binary, signed in by them in their terminal; this app never reads or
//!   stores their credentials;
//! - text answers only: no tools, read-only sandbox or "ask" mode, so it can't edit or run
//!   anything;
//! - in an empty temporary folder, so no repository's hooks, MCP servers or rules files load;
//! - the material (a diff, a description) on standard input, with a time limit.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const TIME_LIMIT: Duration = Duration::from_secs(180);
const MAX_INPUT: usize = 400_000; // characters; more is cut, with a note

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
    Cursor,
}

impl Provider {
    const ALL: [Provider; 3] = [Provider::Claude, Provider::Codex, Provider::Cursor];

    fn binaries(self) -> &'static [&'static str] {
        match self {
            Provider::Claude => &["claude"],
            Provider::Codex => &["codex"],
            Provider::Cursor => &["agent", "cursor-agent"],
        }
    }

    fn login_command(self) -> &'static str {
        match self {
            Provider::Claude => "claude auth login",
            Provider::Codex => "codex login",
            Provider::Cursor => "agent login",
        }
    }
}

#[derive(Serialize)]
pub struct Status {
    provider: Provider,
    installed: bool,
    signed_in: bool,
    version: Option<String>,
    login_command: &'static str,
}

/// The PATH of the person's login shell: apps opened from the Finder or a launcher don't get it, and
/// these CLIs usually live in ~/.local/bin, Homebrew or a Node version manager.
fn search_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut path = std::env::var("PATH").unwrap_or_default();
        #[cfg(unix)]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            if let Ok(output) = run_with_limit(Command::new(shell).args(["-l", "-c", "printf %s \"$PATH\""]), None, Duration::from_secs(5)) {
                if output.status_ok && !output.stdout.trim().is_empty() {
                    path = format!("{}:{path}", output.stdout.trim());
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
        path
    })
}

fn find(provider: Provider) -> Option<PathBuf> {
    let separator = if cfg!(windows) { ';' } else { ':' };
    for dir in search_path().split(separator).filter(|d| !d.is_empty()) {
        for name in provider.binaries() {
            for candidate in [Path::new(dir).join(name), Path::new(dir).join(format!("{name}.exe")), Path::new(dir).join(format!("{name}.cmd"))] {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

struct Output {
    status_ok: bool,
    stdout: String,
    stderr: String,
}

/// Runs a command with its own environment's PATH, optional input on stdin, and a time limit after
/// which it's killed.
fn run_with_limit(command: &mut Command, input: Option<&str>, limit: Duration) -> Result<Output, String> {
    command.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        let input = input.to_string();
        // Written from a thread so a full pipe can't block us while the child waits to be read.
        std::thread::spawn(move || {
            let _ = stdin.write_all(input.as_bytes());
        });
    }
    let mut stdout = child.stdout.take().ok_or("No output")?;
    let mut stderr = child.stderr.take().ok_or("No output")?;
    let out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err("It took too long and was stopped".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    Ok(Output { status_ok: status.success(), stdout: out.join().unwrap_or_default(), stderr: err.join().unwrap_or_default() })
}

fn command(binary: &Path) -> Command {
    let mut command = Command::new(binary);
    command.env("PATH", search_path());
    command
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
        Provider::Codex => &["login", "status"],
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
    Provider::ALL.into_iter().map(status).collect()
}

/// Asks the person's agent CLI and returns its answer. Blocking: run it off the main thread.
pub fn ask(provider: Provider, model: Option<&str>, prompt: &str, input: &str) -> Result<String, String> {
    let binary = find(provider).ok_or("It isn't installed")?;
    static RUNS: AtomicU64 = AtomicU64::new(0);
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    let workspace = std::env::temp_dir().join(format!("focus-diff-pro-{}-{stamp}-{}", std::process::id(), RUNS.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    let result = ask_in(provider, &binary, &workspace, model, prompt, input);
    let _ = std::fs::remove_dir_all(&workspace);
    result
}

fn ask_in(provider: Provider, binary: &Path, workspace: &Path, model: Option<&str>, prompt: &str, input: &str) -> Result<String, String> {
    let mut material: String = input.chars().take(MAX_INPUT).collect();
    if material.len() < input.len() {
        material.push_str("\n\n[The rest was cut to fit.]");
    }
    let message = format!("{prompt}\n\n---\n\n{material}");
    let model = model.map(str::trim).filter(|m| !m.is_empty());
    let mut cmd = command(binary);
    cmd.current_dir(workspace);
    let output = match provider {
        Provider::Claude => {
            cmd.args(["-p", "--output-format", "json", "--tools", "", "--permission-mode", "dontAsk", "--no-session-persistence", "--strict-mcp-config"]);
            if let Some(model) = model {
                cmd.args(["--model", model]);
            }
            let output = run_with_limit(&mut cmd, Some(&message), TIME_LIMIT)?;
            let reply: serde_json::Value = serde_json::from_str(output.stdout.trim()).map_err(|_| failure(&output))?;
            if reply["is_error"].as_bool() == Some(true) {
                return Err(reply["result"].as_str().unwrap_or("Claude Code returned an error").to_string());
            }
            reply["result"].as_str().map(str::to_string).ok_or_else(|| failure(&output))?
        }
        Provider::Codex => {
            let answer = workspace.join("answer.md");
            cmd.args(["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--color", "never", "-o"]).arg(&answer);
            if let Some(model) = model {
                cmd.args(["-m", model]);
            }
            cmd.arg("-");
            let output = run_with_limit(&mut cmd, Some(&message), TIME_LIMIT)?;
            match std::fs::read_to_string(&answer) {
                Ok(text) if output.status_ok && !text.trim().is_empty() => text,
                _ => return Err(failure(&output)),
            }
        }
        Provider::Cursor => {
            cmd.args(["-p", "--output-format", "json", "--mode", "ask", "--trust", "--workspace"]).arg(workspace);
            if let Some(model) = model {
                cmd.args(["--model", model]);
            }
            // Cursor's CLI takes the whole prompt as an argument.
            cmd.arg(&message);
            let output = run_with_limit(&mut cmd, None, TIME_LIMIT)?;
            let reply: serde_json::Value = serde_json::from_str(output.stdout.trim()).map_err(|_| failure(&output))?;
            reply["result"].as_str().map(str::to_string).ok_or_else(|| failure(&output))?
        }
    };
    Ok(output.trim().to_string())
}

/// The most useful line of what a CLI said when it failed: its last error line, or the start of
/// what it printed.
fn failure(output: &Output) -> String {
    let text = format!("{}\n{}", output.stderr, output.stdout);
    let line = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("It didn't answer")
        .to_string();
    // Codex prints JSON errors; their message is what matters.
    if let Some(json) = line.strip_prefix("ERROR: ") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(json) {
            if let Some(message) = v["error"]["message"].as_str() {
                return message.to_string();
            }
        }
    }
    line.chars().take(400).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Talks to the CLIs installed on this machine, so it's opt-in: `cargo test -- --ignored ai`.
    #[test]
    #[ignore]
    fn ai_round_trip() {
        for status in statuses() {
            println!("{:?}: installed {}, signed in {}, {:?}", status.provider, status.installed, status.signed_in, status.version);
        }
        let answer = ask(Provider::Claude, None, "Reply with exactly the word in the material.", "PONG");
        println!("Claude: {answer:?}");
        assert_eq!(answer.as_deref(), Ok("PONG"));
        println!("Codex: {:?}", ask(Provider::Codex, None, "Reply with exactly: OK", ""));
        println!("Cursor: {:?}", ask(Provider::Cursor, None, "Reply with exactly: OK", ""));
    }
}
