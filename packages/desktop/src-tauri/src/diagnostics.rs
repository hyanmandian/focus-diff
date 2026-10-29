use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use tauri::{AppHandle, Manager};

use crate::sync::Locked;

const FILE: &str = "focus-diff.log";
const OLD: &str = "focus-diff.old.log";
const LARGEST: u64 = 512 * 1024;
const LONGEST: usize = 4000;
const ISSUES: &str = "https://github.com/hyanmandian/focus-diff/issues/new";

static PATH: OnceLock<PathBuf> = OnceLock::new();
static WRITING: Mutex<()> = Mutex::new(());

pub fn start(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(FILE);
    if fs::metadata(&path).is_ok_and(|m| m.len() > LARGEST) {
        let _ = fs::rename(&path, dir.join(OLD));
    }
    let _ = PATH.set(path);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let said = info.payload().downcast_ref::<&str>().map(|s| (*s).to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_default();
        write("panic", &format!("at {at}: {said}"));
        previous(info);
    }));
    write("start", &about(app));
}

fn about(app: &AppHandle) -> String {
    format!("Focus Diff {} on {} {}", app.package_info().version, std::env::consts::OS, std::env::consts::ARCH)
}

pub fn write(source: &str, message: &str) {
    if cfg!(any(debug_assertions, feature = "devctl")) {
        eprintln!("[{source}] {message}");
    }
    let Some(path) = PATH.get() else { return };
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let line = format!("{} [{source}] {}\n", stamp(seconds), clean(message, home().as_deref()));
    let _writing = WRITING.held();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

pub fn noted<T>(source: &str, result: Result<T, String>) -> Result<T, String> {
    if let Err(e) = &result {
        write(source, e);
    }
    result
}

fn home() -> Option<String> {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok().filter(|h| h.len() > 1)
}

fn pattern(cell: &'static OnceLock<Regex>, source: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(source).expect("a valid pattern"))
}

const KEPT_HOSTS: [&str; 4] = ["github.com", "githubusercontent.com", "githubassets.com", "localhost"];

fn link(url: &str) -> String {
    let (scheme, rest) = url.split_once("://").unwrap_or(("", url));
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").rsplit('@').next().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");
    let ours = scheme == "tauri" || host == "tauri.localhost" || host == "localhost";
    if ours {
        return format!("{scheme}://{}", rest.split(['?', '#']).next().unwrap_or(""));
    }
    if KEPT_HOSTS.iter().any(|kept| host == *kept || host.ends_with(&format!(".{kept}"))) {
        format!("{scheme}://{host}/…")
    } else {
        "[link]".to_string()
    }
}

fn code_file(text: &str) -> bool {
    [".rs", ".js", ".mjs", ".ts", ".tsx", ".html", ".css"].iter().any(|ext| text.split(':').next().unwrap_or(text).ends_with(ext))
}

fn clean(message: &str, home: Option<&str>) -> String {
    static SECRET: OnceLock<Regex> = OnceLock::new();
    static URL: OnceLock<Regex> = OnceLock::new();
    static EMAIL: OnceLock<Regex> = OnceLock::new();
    static PROFILE: OnceLock<Regex> = OnceLock::new();
    static DOUBLE: OnceLock<Regex> = OnceLock::new();
    static SINGLE: OnceLock<Regex> = OnceLock::new();
    static MENTION: OnceLock<Regex> = OnceLock::new();
    static NAME: OnceLock<Regex> = OnceLock::new();

    let text = message.replace("\r\n", "\n");
    let text = pattern(&SECRET, r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?i:bearer|token)\s+[A-Za-z0-9._~+/=-]{20,})").replace_all(&text, "[hidden]");
    let text = match home {
        Some(home) => text.replace(home, "~"),
        None => text.into_owned(),
    };
    let text = pattern(&PROFILE, r"(?i)(?:/Users/|/home/|[A-Z]:\\Users\\)[^/\\\s]+").replace_all(&text, "~");
    let text = pattern(&URL, r"[A-Za-z][A-Za-z0-9+.-]*://[^\s\x22'<>`)\]]+").replace_all(&text, |c: &regex::Captures| link(&c[0]));
    let text = pattern(&EMAIL, r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").replace_all(&text, "[email]");
    let text = pattern(&DOUBLE, r"[\x22“`][^\x22”`\n]*[\x22”`]").replace_all(&text, "\"…\"");
    let text = pattern(&SINGLE, r"(^|[\s(\[:=,])'[^'\n]*'($|[\s).,;:\]])").replace_all(&text, "${1}'…'${2}");
    let text = pattern(&MENTION, r"(^|[^\w@])@[A-Za-z0-9][A-Za-z0-9_-]*").replace_all(&text, "${1}@…");
    let text = pattern(&NAME, r"(^|[\s(\[,;=])([A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+)").replace_all(&text, |c: &regex::Captures| {
        if code_file(&c[2]) { c[0].to_string() } else { format!("{}…/…", &c[1]) }
    });
    text.replace('\n', " ⏎ ").chars().take(LONGEST).collect()
}

fn stamp(seconds: u64) -> String {
    let (days, rest) = ((seconds / 86_400) as i64, seconds % 86_400);
    let (year, month, day) = civil(days);
    format!("{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}Z", rest / 3600, rest / 60 % 60, rest % 60)
}

fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

pub fn show_logs(app: &AppHandle) {
    use tauri_plugin_opener::OpenerExt;
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
    }
}

fn report_url(version: &str, os: &str) -> String {
    let app = match os {
        "macos" => "Desktop app on Mac",
        "windows" => "Desktop app on Windows",
        _ => "Desktop app on Linux",
    };
    let encode = |text: &str| text.replace(' ', "+");
    format!("{ISSUES}?template=bug_report.yml&app={}&version={}", encode(app), encode(version))
}

pub fn report(app: &AppHandle) {
    use tauri_plugin_opener::OpenerExt;
    write("report", "Report a Problem opened");
    show_logs(app);
    let url = report_url(&app.package_info().version.to_string(), std::env::consts::OS);
    let _ = app.opener().open_url(url, None::<&str>);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_in_utc() {
        assert_eq!(stamp(0), "1970-01-01 00:00:00Z");
        assert_eq!(stamp(1_700_000_000), "2023-11-14 22:13:20Z");
        assert_eq!(stamp(951_782_400), "2000-02-29 00:00:00Z");
    }

    #[test]
    fn keeps_tokens_and_the_home_folder_out() {
        let token = format!("gho_{}", "a".repeat(36));
        let pat = format!("github_pat_{}", "B1_".repeat(10));
        let said = clean(&format!("auth {token} then {pat} and Bearer {}", "x".repeat(24)), Some("/Users/ana"));
        assert_eq!(said, "auth [hidden] then [hidden] and [hidden]");
        assert_eq!(clean("read /Users/ana/Library/x.json", Some("/Users/ana")), "read ~/Library/x.json");
        assert_eq!(clean("one\r\ntwo\nthree", None), "one ⏎ two ⏎ three");
        assert_eq!(clean(&"y".repeat(LONGEST + 10), None).chars().count(), LONGEST);
    }

    #[test]
    fn keeps_anything_about_people_and_their_work_out() {
        assert_eq!(clean("open /home/bruno/code and C:\\Users\\Carla\\AppData and /Users/dana/x", None), "open ~/code and ~\\AppData and ~/x");
        assert_eq!(
            clean("GET https://api.github.com/repos/acme/secret/pulls/7?x=1 failed, see https://wiki.acme.dev/page", None),
            "GET https://api.github.com/… failed, see [link]"
        );
        assert_eq!(clean("at tauri://localhost/assets/panel-x1.js:3:9", None), "at tauri://localhost/assets/panel-x1.js:3:9");
        assert_eq!(clean("at http://tauri.localhost/assets/a.js?v=2", None), "at http://tauri.localhost/assets/a.js");
        assert_eq!(clean("Could not resolve to a Repository with the name 'acme/secret'.", None), "Could not resolve to a Repository with the name '…'.");
        assert_eq!(clean(r#"title "Fix the payroll bug" by @ana_lima, mail ana@acme.dev"#, None), "title \"…\" by @…, mail [email]");
        assert_eq!(clean("refreshing acme/secret-repo#12 failed", None), "refreshing …/…#12 failed");
        assert_eq!(clean("it couldn't, and it didn't", None), "it couldn't, and it didn't");
        assert_eq!(clean("at src/watch.rs:12 and src/panel.tsx:3", None), "at src/watch.rs:12 and src/panel.tsx:3");
    }

    #[test]
    fn a_report_names_the_app_and_its_version() {
        assert_eq!(
            report_url("1.0.1", "windows"),
            "https://github.com/hyanmandian/focus-diff/issues/new?template=bug_report.yml&app=Desktop+app+on+Windows&version=1.0.1"
        );
        assert!(report_url("1.0.1", "macos").contains("app=Desktop+app+on+Mac"));
        assert!(report_url("1.0.1", "linux").contains("app=Desktop+app+on+Linux"));
    }
}
