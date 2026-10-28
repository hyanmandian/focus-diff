//! The pull request's code on this machine, for the AI to read around the diff: where the changed
//! code is used, what depends on it, the project's own rules. One shallow checkout per repository
//! in the app's cache folder, moved to each pull request's head commit as it's asked about, and
//! removed after two weeks without use.
//!
//! Git runs with none of the person's own git config (no credential helpers, hooks or URL
//! rewrites), with the token passed as an HTTP header for github.com only. What the AI CLIs would
//! load from a repository and run (project settings with hooks, MCP servers) is deleted after each
//! checkout: those files belong to the pull request's author, not the reviewer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use crate::ai::run_with_limit;

const LIMIT: Duration = Duration::from_secs(300);
const KEEP: Duration = Duration::from_secs(14 * 24 * 3600);

/// Agent configuration that runs things, as opposed to rules that only say things.
const UNTRUSTED: &[&str] = &[".claude/settings.json", ".claude/settings.local.json", ".mcp.json", ".cursor/mcp.json", ".cursor/hooks.json", ".cursor/cli.json", ".cursor/environment.json"];

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn git(dir: &Path, args: &[&str], token: &str) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .current_dir(dir)
        .args(args)
        .env("PATH", crate::ai::search_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", if cfg!(windows) { "NUL" } else { "/dev/null" })
        .env("GIT_CONFIG_COUNT", "3")
        .env("GIT_CONFIG_KEY_0", "http.https://github.com/.extraheader")
        .env("GIT_CONFIG_VALUE_0", format!("AUTHORIZATION: basic {}", base64(format!("x-access-token:{token}").as_bytes())))
        .env("GIT_CONFIG_KEY_1", "credential.helper")
        .env("GIT_CONFIG_VALUE_1", "")
        .env("GIT_CONFIG_KEY_2", "core.hooksPath")
        .env("GIT_CONFIG_VALUE_2", if cfg!(windows) { "NUL" } else { "/dev/null" });
    let output = run_with_limit(&mut command, None, LIMIT).map_err(|e| format!("git: {e}"))?;
    if !output.status_ok {
        let line = output.stderr.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("git failed").to_string();
        return Err(line.chars().take(300).collect());
    }
    Ok(output.stdout.trim().to_string())
}

/// One git operation at a time per repository.
fn lock(key: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(Default::default).lock().unwrap().entry(key.to_string()).or_default().clone()
}

/// The pull request's head commit checked out under `cache/repos/owner/name`. Blocking.
pub fn prepare(cache: &Path, token: &str, repo: &str, number: u64, head: &str) -> Result<PathBuf, String> {
    let (owner, name) = repo.split_once('/').ok_or("Bad repository")?;
    if !crate::github::repo_ok(repo) || head.len() != 40 || !head.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Bad pull request".into());
    }
    let dir = cache.join("repos").join(owner).join(name);
    let guard = lock(repo);
    let _held = guard.lock().unwrap();
    if !dir.join(".git").is_dir() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        git(&dir, &["init", "-q"], token)?;
        git(&dir, &["remote", "add", "origin", &format!("https://github.com/{owner}/{name}.git")], token)?;
    }
    if git(&dir, &["rev-parse", "HEAD"], token).ok().as_deref() != Some(head) {
        // The commit itself; failing that (an old head), the pull request's ref.
        if git(&dir, &["fetch", "-q", "--depth=1", "--no-tags", "origin", head], token).is_err() {
            git(&dir, &["fetch", "-q", "--depth=1", "--no-tags", "origin", &format!("refs/pull/{number}/head")], token)?;
        }
        git(&dir, &["checkout", "-q", "--force", "--detach", head], token).or_else(|_| git(&dir, &["checkout", "-q", "--force", "--detach", "FETCH_HEAD"], token))?;
    }
    git(&dir, &["clean", "-ffdxq"], token)?;
    remove_untrusted(&dir);
    // Used now: kept from the next sweep.
    let _ = std::fs::File::open(&dir).and_then(|f| f.set_modified(SystemTime::now()));
    Ok(dir)
}

fn remove_untrusted(dir: &Path) {
    for file in UNTRUSTED {
        let mut at = dir.to_path_buf();
        for part in Path::new(file).components() {
            at.push(part);
            match std::fs::symlink_metadata(&at) {
                Ok(meta) if meta.is_dir() => {}
                Ok(_) => {
                    let _ = std::fs::remove_file(&at).or_else(|_| std::fs::remove_dir(&at));
                    break;
                }
                Err(_) => break,
            }
        }
    }
}

/// Removes checkouts not used for two weeks.
pub fn sweep(cache: &Path) {
    let Ok(owners) = std::fs::read_dir(cache.join("repos")) else { return };
    for owner in owners.flatten() {
        let Ok(repos) = std::fs::read_dir(owner.path()) else { continue };
        for repo in repos.flatten() {
            if crate::disk::age(&repo.path()).is_some_and(|age| age > KEEP) {
                let guard = lock(&format!("{}/{}", owner.file_name().to_string_lossy(), repo.file_name().to_string_lossy()));
                let _held = guard.lock().unwrap();
                let _ = std::fs::remove_dir_all(repo.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_base64() {
        assert_eq!(base64(b"x-access-token:abc"), "eC1hY2Nlc3MtdG9rZW46YWJj");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(b"a"), "YQ==");
    }

    #[test]
    #[cfg(unix)]
    fn removes_agent_settings_without_following_links() {
        let root = std::env::temp_dir().join(format!("fd-untrusted-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (repo, outside) = (root.join("repo"), root.join("outside"));
        std::fs::create_dir_all(repo.join(".cursor")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("settings.json"), "mine").unwrap();
        std::fs::write(repo.join(".mcp.json"), "{}").unwrap();
        std::fs::write(repo.join(".cursor/mcp.json"), "{}").unwrap();
        std::os::unix::fs::symlink(&outside, repo.join(".claude")).unwrap();
        remove_untrusted(&repo);
        assert_eq!(std::fs::read_to_string(outside.join("settings.json")).unwrap(), "mine");
        assert!(!repo.join(".mcp.json").exists());
        assert!(!repo.join(".cursor/mcp.json").exists());
        assert!(repo.join(".cursor").is_dir());
        assert!(std::fs::symlink_metadata(repo.join(".claude")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_odd_names() {
        let cache = std::env::temp_dir();
        assert!(prepare(&cache, "t", "../etc", 1, &"a".repeat(40)).is_err());
        assert!(prepare(&cache, "t", "acme/web", 1, "HEAD").is_err());
    }
}

#[cfg(test)]
mod live {
    /// Fetches a real pull request: `FD_TOKEN=$(gh auth token) cargo test -- --ignored checkout`.
    #[test]
    #[ignore]
    fn checkout_round_trip() {
        let token = std::env::var("FD_TOKEN").unwrap();
        let (repo, number, head) = (std::env::var("FD_REPO").unwrap(), std::env::var("FD_NUMBER").unwrap().parse().unwrap(), std::env::var("FD_HEAD").unwrap());
        let cache = std::env::temp_dir().join("fd-checkout-test");
        let started = std::time::Instant::now();
        let dir = super::prepare(&cache, &token, &repo, number, &head).unwrap();
        println!("first: {:?} in {:?}", dir, started.elapsed());
        let started = std::time::Instant::now();
        super::prepare(&cache, &token, &repo, number, &head).unwrap();
        println!("again: {:?}", started.elapsed());
        // And the AI reading it, with a structured answer.
        let schema = r#"{"type":"object","properties":{"files":{"type":"array","items":{"type":"string"}}},"required":["files"]}"#;
        let answer = crate::ai::ask(crate::ai::Question {
            provider: crate::ai::Provider::Claude,
            model: Some("haiku"),
            effort: Some("low"),
            prompt: "List up to three source files in your working directory that look most important.",
            input: "(no diff)",
            project: Some(&dir),
            schema: Some(schema),
            cancel: None,
        });
        println!("AI: {answer:?}");
        assert!(answer.unwrap().contains("files"));
    }
}
