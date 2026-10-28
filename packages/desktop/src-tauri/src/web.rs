//! Signing in to github.com itself, only to attach pictures and videos to comments the way
//! github.com does: GitHub has no API for it, and its tokens can't do it. The person signs in on
//! github.com's own page, in a window of its own that can't reach the app (no capability names it)
//! and keeps nothing (a private web view); the app never sees a password. Once they're in, the
//! session's cookies are kept in the system keychain, next to the token, and only ever sent to
//! https://github.com.

use std::io::Read;
use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::i18n::tr;

pub const WINDOW: &str = "github-sign-in";
pub const HOST: &str = "https://github.com";
const KEYCHAIN_SERVICE: &str = "com.focusdiff.app";
const KEYCHAIN_ACCOUNT: &str = "github.com session";
/// Safari's: the sign-in window says it's Safari, and the requests made with its cookies say the
/// same, so github.com sees one browser.
pub const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
/// How long the sign-in window waits for the person before it stops looking.
const PATIENCE: Duration = Duration::from_secs(60 * 60);

/// Who's signed in on github.com, and the cookies that say so.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Session {
    pub login: String,
    cookies: Vec<(String, String)>,
}

impl Session {
    fn header(&self) -> String {
        self.cookies.iter().map(|(name, value)| format!("{name}={value}")).collect::<Vec<_>>().join("; ")
    }

    /// What github.com set in an answer, kept so the next request carries it (its session cookie
    /// changes as it goes, and its forms' tokens go with it). True when something changed.
    fn absorb(&mut self, set_cookies: &[String]) -> bool {
        let mut changed = false;
        for line in set_cookies {
            let mut parts = line.split(';');
            let Some((name, value)) = parts.next().and_then(|p| p.split_once('=')) else { continue };
            let (name, value) = (name.trim(), value.trim());
            let gone = value.is_empty()
                || parts.any(|a| {
                    let a = a.trim().to_ascii_lowercase();
                    a == "max-age=0" || a.starts_with("max-age=-") || a.contains("1970")
                });
            let at = self.cookies.iter().position(|(n, _)| n == name);
            match (at, gone) {
                (Some(i), true) => {
                    self.cookies.remove(i);
                    changed = true;
                }
                (Some(i), false) if self.cookies[i].1 != value => {
                    self.cookies[i].1 = value.to_string();
                    changed = true;
                }
                (None, false) => {
                    self.cookies.push((name.to_string(), value.to_string()));
                    changed = true;
                }
                _ => {}
            }
        }
        changed
    }
}

/// The session, read from the keychain once and kept in memory.
#[derive(Default)]
pub struct WebSession(Mutex<Option<Option<Session>>>);

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

impl WebSession {
    pub fn get(&self) -> Option<Session> {
        let mut kept = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if kept.is_none() {
            let read = keychain().ok().and_then(|k| k.get_password().ok()).and_then(|text| serde_json::from_str(&text).ok());
            *kept = Some(read);
        }
        kept.clone().flatten()
    }

    pub fn login(&self) -> Option<String> {
        self.get().map(|s| s.login)
    }

    pub fn save(&self, session: Session) -> Result<(), String> {
        let text = serde_json::to_string(&session).map_err(|e| e.to_string())?;
        keychain()?.set_password(&text).map_err(|e| e.to_string())?;
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(Some(session));
        Ok(())
    }

    pub fn forget(&self) {
        if let Ok(entry) = keychain() {
            let _ = entry.delete_credential();
        }
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(None);
    }
}

/// Tells every window who's signed in on github.com now (or that nobody is).
pub fn announce(app: &AppHandle) {
    let _ = app.emit("web-session", app.state::<WebSession>().login());
}

// MARK: The sign-in window

/// Where the sign-in window may go: github.com, the puzzles it may ask to be solved, and the
/// accounts it lets you sign in with. Anything else stays out (a link to it opens in the browser).
fn may_load(url: &Url) -> bool {
    if url.scheme() == "about" {
        return true;
    }
    let Some(host) = url.host_str() else { return false };
    let within = |domain: &str| host == domain || host.ends_with(&format!(".{domain}"));
    url.scheme() == "https"
        && (within("github.com") || within("octocaptcha.com") || within("arkoselabs.com") || host == "accounts.google.com" || host == "appleid.apple.com")
}

pub fn sign_in(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.show()?;
        return window.set_focus();
    }
    let login: Url = format!("{HOST}/login").parse().expect("a valid address");
    let opener = app.clone();
    let window = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::External(login))
        .title(tr!("Sign in to github.com", "Entrar no github.com"))
        .inner_size(480.0, 720.0)
        .min_inner_size(400.0, 480.0)
        .center()
        // Nothing kept on disk: the cookies the app needs go to the keychain, the rest goes away.
        .incognito(true)
        .user_agent(USER_AGENT)
        .on_navigation(may_load)
        // A link meant for a new window opens in the browser; no window opens here.
        .on_new_window(move |url, _| {
            if url.scheme() == "https" {
                let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .build()?;
    crate::update_presence(app);
    window.set_focus()?;
    let app = app.clone();
    thread::spawn(move || wait_for_sign_in(&app));
    Ok(())
}

/// Looks at the window's cookies until github.com says the person is in, then keeps them and
/// closes it. Off the main thread: reading cookies waits on it.
fn wait_for_sign_in(app: &AppHandle) {
    let started = Instant::now();
    let github: Url = format!("{HOST}/").parse().expect("a valid address");
    while started.elapsed() < PATIENCE {
        thread::sleep(Duration::from_millis(800));
        let Some(window) = app.get_webview_window(WINDOW) else { return };
        let Ok(cookies) = window.cookies_for_url(github.clone()) else { continue };
        let value = |name: &str| cookies.iter().find(|c| c.name() == name).map(|c| c.value().to_string());
        let (Some("yes"), Some(_), Some(login)) = (value("logged_in").as_deref(), value("user_session"), value("dotcom_user")) else { continue };
        let session = Session { login, cookies: cookies.iter().map(|c| (c.name().to_string(), c.value().to_string())).collect() };
        if app.state::<WebSession>().save(session).is_ok() {
            announce(app);
        }
        let _ = window.close();
        return;
    }
}

/// Forgets the session here. (github.com still lists it under your sessions until it ends.)
pub fn sign_out(app: &AppHandle) {
    app.state::<WebSession>().forget();
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.close();
    }
    announce(app);
}

// MARK: Requests to github.com

/// One answer from github.com.
pub struct Answer {
    pub status: u16,
    pub location: Option<String>,
    pub body: String,
}

/// A request to github.com with the session's cookies, never anywhere else, and never following a
/// redirect (one to the sign-in page is how an ended session shows). `body`: its content type
/// and bytes. What github.com sets in its answer is kept in `session`.
pub fn request(session: &mut Session, method: &str, path: &str, headers: &[(&str, &str)], body: Option<(&str, &[u8])>) -> Result<Answer, String> {
    if !crate::github::path_ok(path) {
        return Err("Bad request".into());
    }
    let url = format!("{HOST}{path}");
    let agent = crate::github::agent();
    let cookie = session.header();
    let reached = |e: ureq::Error| tr!("Couldn't reach github.com: {e}", "Não foi possível falar com o github.com: {e}");
    macro_rules! dress {
        ($request:expr) => {{
            let mut request = $request.header("Cookie", &cookie).header("User-Agent", USER_AGENT);
            for (name, value) in headers {
                request = request.header(*name, *value);
            }
            request.config().max_redirects(0).timeout_global(Some(Duration::from_secs(60))).build()
        }};
    }
    let response = match (method, body) {
        ("GET", None) => dress!(agent.get(&url)).call(),
        ("POST", Some((kind, bytes))) => dress!(agent.post(&url).header("Content-Type", kind)).send(bytes),
        ("PUT", Some((kind, bytes))) => dress!(agent.put(&url).header("Content-Type", kind)).send(bytes),
        _ => return Err("Bad request".into()),
    }
    .map_err(reached)?;
    let status = response.status().as_u16();
    let location = response.headers().get("location").and_then(|v| v.to_str().ok()).map(String::from);
    let set: Vec<String> = response.headers().get_all("set-cookie").iter().filter_map(|v| v.to_str().ok()).map(String::from).collect();
    session.absorb(&set);
    let mut bytes = Vec::new();
    response.into_body().into_reader().take(32 * 1024 * 1024).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(Answer { status, location, body: String::from_utf8_lossy(&bytes).into_owned() })
}

/// Where a github.com address of an attachment really is (a signed address on GitHub's content
/// host), asked as the person signed in on github.com: private repositories' attachments are
/// only theirs to see. None without a session, or when it isn't one.
pub fn signed_address(app: &AppHandle, url: &str) -> Option<String> {
    let path = url.strip_prefix(HOST)?;
    if !path.starts_with("/user-attachments/") {
        return None;
    }
    let mut session = app.state::<WebSession>().get()?;
    let answer = request(&mut session, "GET", path, &[], None).ok()?;
    let location = answer.location.filter(|_| (300..400).contains(&answer.status))?;
    crate::github::https_host(&location).is_some_and(|host| host.ends_with(".githubusercontent.com")).then_some(location)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_github_and_its_sign_in_helpers() {
        let ok = |s: &str| may_load(&s.parse().unwrap());
        assert!(ok("https://github.com/login"));
        assert!(ok("https://github.com/sessions/two-factor"));
        assert!(ok("https://octocaptcha.com/"));
        assert!(ok("about:blank"));
        assert!(!ok("http://github.com/login"));
        assert!(!ok("https://github.com.evil.com/"));
        assert!(!ok("https://evilgithub.com/"));
        assert!(!ok("https://example.com/?github.com"));
        assert!(!ok("tauri://localhost/index.html"));
    }

    #[test]
    fn keeps_what_github_sets() {
        let mut session = Session { login: "you".into(), cookies: vec![("_gh_sess".into(), "a".into()), ("user_session".into(), "s".into())] };
        assert!(session.absorb(&["_gh_sess=b; path=/; secure; HttpOnly".into(), "tz=UTC; path=/".into()]));
        assert_eq!(session.header(), "_gh_sess=b; user_session=s; tz=UTC");
        assert!(session.absorb(&["tz=; expires=Thu, 01 Jan 1970 00:00:00 GMT".into()]));
        assert!(!session.absorb(&["_gh_sess=b".into()]));
        assert_eq!(session.header(), "_gh_sess=b; user_session=s");
    }
}
