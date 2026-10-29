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
        write("panic", &info.to_string());
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

fn clean(message: &str, home: Option<&str>) -> String {
    static SECRET: OnceLock<Regex> = OnceLock::new();
    let secret = SECRET.get_or_init(|| {
        Regex::new(r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?i:bearer|token)\s+[A-Za-z0-9._~+/=-]{20,})").expect("a valid pattern")
    });
    let hidden = secret.replace_all(message, "[hidden]");
    let local = match home {
        Some(home) => hidden.replace(home, "~"),
        None => hidden.into_owned(),
    };
    local.replace("\r\n", "\n").replace('\n', " ⏎ ").chars().take(LONGEST).collect()
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
    fn a_report_names_the_app_and_its_version() {
        assert_eq!(
            report_url("1.0.1", "windows"),
            "https://github.com/hyanmandian/focus-diff/issues/new?template=bug_report.yml&app=Desktop+app+on+Windows&version=1.0.1"
        );
        assert!(report_url("1.0.1", "macos").contains("app=Desktop+app+on+Mac"));
        assert!(report_url("1.0.1", "linux").contains("app=Desktop+app+on+Linux"));
    }
}
