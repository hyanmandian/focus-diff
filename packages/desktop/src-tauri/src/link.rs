//! A pull request opened from its link from outside the panel: a `focusdiff://open?url=…` link
//! (from a browser, Raycast, a script) and `focus-diff open <link>` on the command line, which sends
//! one. The link is read as strictly as the panel reads it (src/utils/pull-link/pull-link.ts): only
//! a pull request's on github.com. One GitHub can't find, or that isn't one, opens the panel's
//! Open Pull Request… with it and why.

use std::sync::Mutex;

use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, Url};
use crate::sync::Locked;

/// The scheme registered for the app (Info.plist).
pub const SCHEME: &str = "focusdiff";

#[derive(Debug, PartialEq, Eq)]
pub struct PullLink {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

impl PullLink {
    /// The link as GitHub writes it.
    pub fn url(&self) -> String {
        format!("https://github.com/{}/{}/pull/{}", self.owner, self.repo, self.number)
    }

    /// The app's own link to it: `focusdiff://open?url=…`.
    pub fn app_link(&self) -> String {
        let mut link = Url::parse(&format!("{SCHEME}://open")).expect("a valid link");
        link.query_pairs_mut().append_pair("url", &self.url());
        link.into()
    }
}

/// A GitHub owner: letters, digits and single hyphens between them, 39 at most.
fn owner_ok(owner: &str) -> bool {
    !owner.is_empty() && owner.len() <= 39 && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !owner.starts_with('-') && !owner.ends_with('-') && !owner.contains("--")
}

/// The pull request a link is to, or None when it isn't a pull request's link on github.com.
pub fn parse(text: &str) -> Option<PullLink> {
    static LINK: OnceLock<Regex> = OnceLock::new();
    let link = LINK.get_or_init(|| Regex::new(r"^(?:https://)?(?:www\.)?github\.com/([A-Za-z0-9-]{1,39})/([\w.-]{1,100})/pull/([1-9][0-9]{0,9})(?:/[\w./-]*)?(?:\?[^\s#]*)?(?:#\S*)?$").unwrap());
    let found = link.captures(text.trim())?;
    let (owner, repo) = (&found[1], &found[2]);
    if !owner_ok(owner) || repo == "." || repo == ".." {
        return None;
    }
    Some(PullLink { owner: owner.into(), repo: repo.into(), number: found[3].parse().ok()? })
}

/// The pull request link a `focusdiff://open?url=…` link carries, as it came.
pub fn carried(app_link: &str) -> Option<String> {
    let link = Url::parse(app_link).ok()?;
    if link.scheme() != SCHEME || link.host_str() != Some("open") {
        return None;
    }
    link.query_pairs().find(|(key, _)| key == "url").map(|(_, value)| value.into_owned())
}

/// A link that couldn't be opened from outside, kept for the panel to show when it opens.
#[derive(Default)]
pub struct Waiting(pub Mutex<Option<String>>);

/// Opens the review window of the pull request a focusdiff:// link is to, asking GitHub for it
/// first; anything else goes to the panel's Open Pull Request…, which says why.
pub fn open(app: &AppHandle, app_link: &str) {
    let Some(text) = carried(app_link) else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(link) = parse(&text)
            && let Some(found) = find(&app, &link)
        {
            let _ = crate::open_review(app.clone(), found.id, format!("{}/{}", link.owner, link.repo), link.number, found.title, vec![], None, None);
            return;
        }
        // In the panel, which reads it again and says what's wrong: told now if it's there, or
        // finding it waiting when it starts.
        if app.get_webview_window(crate::PANEL).is_some() {
            let _ = app.emit_to(crate::PANEL, "open-link", text);
        } else {
            *app.state::<Waiting>().0.held() = Some(text);
        }
        crate::show_panel(&app);
    });
}

struct Found {
    id: String,
    title: String,
}

/// The pull request's id and window title, as the panel would make them; None when GitHub has none
/// you can see, or can't be reached.
fn find(app: &AppHandle, link: &PullLink) -> Option<Found> {
    let query = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { id number title author { login ... on User { name } } } } }";
    let body = json!({ "query": query, "variables": { "owner": link.owner, "name": link.repo, "number": link.number } }).to_string();
    let (status, reply) = app.state::<crate::github::Auth>().request("POST", "/graphql", Some(&body), None).ok()?;
    if status != 200 {
        return None;
    }
    let reply: Value = serde_json::from_str(&reply).ok()?;
    let pull = &reply["data"]["repository"]["pullRequest"];
    let id = pull["id"].as_str()?.to_string();
    let title = pull["title"].as_str().unwrap_or_default();
    let author = &pull["author"];
    // Their first name, else their login (src/utils/bridge/bridge.ts, byline).
    let by = author["name"].as_str().and_then(|n| n.split_whitespace().next()).or_else(|| author["login"].as_str()).unwrap_or("someone");
    Some(Found { id, title: format!("#{} · {title} · {by}", link.number) })
}

// MARK: Command line

const USAGE: &str = "Focus Diff: your pull request reviews, from the menu bar.

Usage:
  focus-diff open <link>   Opens a pull request's review, from its link on GitHub
                           (https://github.com/owner/repo/pull/123, /files and the like too).
  focus-diff help          Shows this.

Without a command, it starts the app.";

/// What the command line asks for: Some(exit code) when it was a command, handled here; None to
/// start the app (no arguments, or the ones macOS passes an app it starts).
pub fn command_line(args: &[String]) -> Option<i32> {
    let first = args.first()?;
    if first.starts_with("-psn") {
        return None;
    }
    Some(match first.as_str() {
        "open" => match args.get(1).and_then(|text| parse(text)) {
            Some(link) => send(&link),
            None => {
                eprintln!("That isn't a pull request's link on GitHub: {}\n\n{USAGE}", args.get(1).map_or("(none)", String::as_str));
                2
            }
        },
        "help" | "--help" | "-h" => {
            println!("{USAGE}");
            0
        }
        other => {
            eprintln!("Unknown command: {other}\n\n{USAGE}");
            2
        }
    })
}

/// Hands the link to the app (starting it if it isn't running) the way a click on it would.
fn send(link: &PullLink) -> i32 {
    #[cfg(target_os = "macos")]
    {
        match std::process::Command::new("/usr/bin/open").arg(link.app_link()).status() {
            Ok(status) if status.success() => {
                println!("Opening {}", link.url());
                0
            }
            _ => {
                eprintln!("Couldn't reach Focus Diff. Is it installed in Applications?");
                1
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("Opening from the command line works on macOS for now: paste {} in the panel instead.", link.url());
        1
    }
}

/// Where `focus-diff` goes on the command line: the first of these the person can write to. All
/// are on a Mac's usual PATH but the last, which shells add when it exists.
#[cfg(unix)]
fn bins() -> Vec<std::path::PathBuf> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_default();
    vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into(), home.join(".local/bin")]
}

/// Links `focus-diff` in the first of `dirs` that takes it to `program`: an earlier link of its own
/// is replaced, anything else by that name is left alone. The last folder is made if it's missing.
#[cfg(unix)]
pub fn install_into(program: &std::path::Path, dirs: &[std::path::PathBuf]) -> Result<std::path::PathBuf, String> {
    for (at, dir) in dirs.iter().enumerate() {
        if at == dirs.len() - 1 {
            let _ = std::fs::create_dir_all(dir);
        }
        let target = dir.join("focus-diff");
        match std::fs::symlink_metadata(&target) {
            // An earlier link of ours (to a focus-diff program, from any copy of the app) is
            // replaced; one to something else is left alone.
            Ok(meta) if meta.file_type().is_symlink() => {
                let ours = std::fs::read_link(&target).is_ok_and(|to| to.file_name().is_some_and(|name| name == "focus-diff"));
                if !ours || std::fs::remove_file(&target).is_err() {
                    continue;
                }
            }
            Ok(_) => continue,
            Err(_) => {}
        }
        if std::os::unix::fs::symlink(program, &target).is_ok() {
            return Ok(target);
        }
    }
    Err("Couldn't add focus-diff to any folder on the PATH".into())
}

/// Settings' Install: `focus-diff` on the command line, a link to this app's own program.
pub fn install() -> Result<String, String> {
    #[cfg(unix)]
    {
        let program = std::env::current_exe().map_err(|e| e.to_string())?;
        install_into(&program, &bins()).map(|path| path.display().to_string())
    }
    #[cfg(not(unix))]
    Err(crate::i18n::tr!("The command line can't be installed on Windows yet", "A linha de comando ainda não pode ser instalada no Windows"))
}

/// Where `focus-diff` is linked to this app, if it is.
pub fn installed() -> Option<String> {
    #[cfg(unix)]
    {
        let program = std::env::current_exe().ok()?;
        bins().into_iter().map(|dir| dir.join("focus-diff")).find(|target| std::fs::read_link(target).is_ok_and(|to| to == program)).map(|target| target.display().to_string())
    }
    #[cfg(not(unix))]
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn installs_where_it_can_without_touching_other_files() {
        let root = std::env::temp_dir().join(format!("focus-diff-install-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (taken, ours, made) = (root.join("taken"), root.join("ours"), root.join("made/bin"));
        std::fs::create_dir_all(&taken).unwrap();
        std::fs::create_dir_all(&ours).unwrap();
        std::fs::write(taken.join("focus-diff"), "someone else's").unwrap();
        std::fs::create_dir_all(root.join("app")).unwrap();
        let program = root.join("app/focus-diff");
        std::fs::write(&program, "").unwrap();
        // A real file is left alone; the next folder takes it.
        assert_eq!(install_into(&program, &[taken.clone(), ours.clone()]).unwrap(), ours.join("focus-diff"));
        assert_eq!(std::fs::read_to_string(taken.join("focus-diff")).unwrap(), "someone else's");
        // An earlier link is replaced.
        assert_eq!(install_into(&program, std::slice::from_ref(&ours)).unwrap(), ours.join("focus-diff"));
        assert_eq!(std::fs::read_link(ours.join("focus-diff")).unwrap(), program);
        // A link by that name to another program is left alone, as a file is.
        let other = root.join("other");
        std::fs::create_dir_all(&other).unwrap();
        std::os::unix::fs::symlink(root.join("app/elsewhere"), other.join("focus-diff")).unwrap();
        assert!(install_into(&program, std::slice::from_ref(&other)).is_err());
        assert_eq!(std::fs::read_link(other.join("focus-diff")).unwrap(), root.join("app/elsewhere"));
        // The last folder is made when missing; none taking it is an error.
        assert_eq!(install_into(&program, &[taken.clone(), made.clone()]).unwrap(), made.join("focus-diff"));
        assert!(install_into(&program, std::slice::from_ref(&taken)).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_pull_request_links() {
        let pull = PullLink { owner: "acme".into(), repo: "web".into(), number: 1807 };
        for text in ["https://github.com/acme/web/pull/1807", " github.com/acme/web/pull/1807/files ", "https://www.github.com/acme/web/pull/1807?w=1#diff-1", "https://github.com/acme/web/pull/1807/commits/abc"] {
            assert_eq!(parse(text).as_ref(), Some(&pull), "{text}");
        }
        for text in ["", "http://github.com/acme/web/pull/1", "https://github.com/acme/web/issues/1", "https://github.com/acme/web/pull/0", "https://github.com.evil.io/acme/web/pull/1", "https://github.com/-acme/web/pull/1", "https://github.com/ac--me/web/pull/1", "https://github.com/acme-/web/pull/1", "https://github.com/acme/../pull/1", "https://github.com/acme/web/pull/1 more"] {
            assert_eq!(parse(text), None, "{text}");
        }
    }

    #[test]
    fn app_links_carry_the_pull_request_link() {
        let link = parse("https://github.com/acme/web/pull/7").unwrap();
        assert_eq!(link.app_link(), "focusdiff://open?url=https%3A%2F%2Fgithub.com%2Facme%2Fweb%2Fpull%2F7");
        assert_eq!(carried(&link.app_link()).as_deref(), Some("https://github.com/acme/web/pull/7"));
        assert_eq!(carried("focusdiff://other?url=x"), None);
        assert_eq!(carried("https://open?url=x"), None);
        assert_eq!(carried("focusdiff://open"), None);
    }

    #[test]
    fn command_line() {
        let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(super::command_line(&args(&[])), None);
        assert_eq!(super::command_line(&args(&["-psn_0_123"])), None);
        assert_eq!(super::command_line(&args(&["help"])), Some(0));
        assert_eq!(super::command_line(&args(&["open"])), Some(2));
        assert_eq!(super::command_line(&args(&["open", "https://github.com/acme/web/issues/1"])), Some(2));
        assert_eq!(super::command_line(&args(&["frobnicate"])), Some(2));
    }
}
