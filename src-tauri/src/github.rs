//! GitHub access. The token never reaches the web views: they ask for API calls by path, and this
//! module makes them with the token from the system keychain (or from the GitHub CLI, if that's
//! what the person chose). Only api.github.com is ever called with it.
//!
//! Signing in uses GitHub's device flow (no server of ours, no redirect): the app shows a code, the
//! person enters it on github.com, and the app picks up the token.

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use crate::i18n::tr;

const KEYCHAIN_SERVICE: &str = "com.focusdiff.app";
const KEYCHAIN_ACCOUNT: &str = "github";
const API: &str = "https://api.github.com";
/// Read pull requests, comment and review on them, and read team membership (for team review
/// requests). Nothing to do with code pushes or admin.
const SCOPES: &str = "repo read:org";
/// The OAuth app's client id, set at build time. Without it the device flow is off and the app
/// offers the GitHub CLI or a token instead.
const CLIENT_ID: Option<&str> = option_env!("FOCUS_DIFF_GITHUB_CLIENT_ID");

#[derive(Default)]
pub struct Auth {
    /// The token in use, kept in memory once read. Never serialized.
    token: Mutex<Option<String>>,
    source: Mutex<Option<Source>>,
    /// Who the token belongs to, once GitHub said.
    login: Mutex<Option<String>>,
    etags: Mutex<Etags>,
    recent: Mutex<Recent>,
}

/// The pages' read requests answered in the last two minutes, kept whole: what the panel fetched
/// ahead (a pull request under the pointer) the review window then gets at once, with no request.
/// Any write clears it, so nothing shown is older than what the person just did.
#[derive(Default)]
struct Recent {
    entries: HashMap<String, (Instant, u16, String)>,
    bytes: usize,
}

impl Recent {
    const FOR: Duration = Duration::from_secs(120);
    const BUDGET: usize = 32 * 1024 * 1024;

    fn get(&mut self, key: &str) -> Option<(u16, String)> {
        let (at, status, body) = self.entries.get(key)?;
        if at.elapsed() < Self::FOR {
            return Some((*status, body.clone()));
        }
        let (_, _, body) = self.entries.remove(key)?;
        self.bytes -= body.len();
        None
    }

    fn put(&mut self, key: String, status: u16, body: String) {
        self.entries.retain(|_, (at, _, _)| at.elapsed() < Self::FOR);
        self.bytes = self.entries.values().map(|(_, _, b)| b.len()).sum();
        if self.bytes + body.len() > Self::BUDGET {
            return;
        }
        self.bytes += body.len();
        self.entries.insert(key, (Instant::now(), status, body));
    }

    fn clear(&mut self) {
        *self = Recent::default();
    }
}

/// A GraphQL request that only reads: a query, not a mutation.
fn is_query(body: Option<&str>) -> bool {
    body.and_then(|b| serde_json::from_str::<Value>(b).ok())
        .and_then(|v| v["query"].as_str().map(|q| q.trim_start().to_string()))
        .is_some_and(|q| q.starts_with("query") || q.starts_with('{'))
}

/// GET responses GitHub tagged, by path: asked again with the tag, GitHub answers 304 Not Modified
/// without the body (faster, and free against the rate limit), and the kept body is used.
#[derive(Default)]
struct Etags {
    entries: HashMap<String, (String, String)>,
    order: VecDeque<String>,
    bytes: usize,
}

impl Etags {
    const BUDGET: usize = 16 * 1024 * 1024;
    const LARGEST: usize = 4 * 1024 * 1024;

    fn get(&self, key: &str) -> Option<&(String, String)> {
        self.entries.get(key)
    }

    fn put(&mut self, key: String, etag: String, body: String) {
        if body.len() > Self::LARGEST {
            return;
        }
        if let Some((_, old)) = self.entries.remove(&key) {
            self.bytes -= old.len();
            self.order.retain(|k| *k != key);
        }
        self.bytes += body.len();
        self.order.push_back(key.clone());
        self.entries.insert(key, (etag, body));
        // The oldest go first.
        while self.bytes > Self::BUDGET {
            let Some(oldest) = self.order.pop_front() else { break };
            if let Some((_, body)) = self.entries.remove(&oldest) {
                self.bytes -= body.len();
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// From the device flow or a pasted token, kept in the keychain.
    Keychain,
    /// Read from `gh auth token` each time it's needed.
    Gh,
}

#[derive(Serialize)]
pub struct Status {
    pub signed_in: bool,
    pub source: Option<Source>,
    pub login: Option<String>,
    pub device_flow: bool,
    pub gh_available: bool,
}

/// One client for the app's life, so connections to GitHub are kept open and reused instead of
/// a new TLS handshake per request.
pub(crate) fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(30)))
            .http_status_as_error(false)
            .user_agent(concat!("FocusDiff/", env!("CARGO_PKG_VERSION")))
            .build()
            .into()
    })
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// Apps opened from the Finder don't get the shell's PATH, so look where package managers put gh.
fn gh_path() -> Option<String> {
    let candidates = if cfg!(windows) {
        vec!["gh.exe".to_string(), r"C:\Program Files\GitHub CLI\gh.exe".to_string()]
    } else {
        vec![
            "/opt/homebrew/bin/gh".to_string(),
            "/usr/local/bin/gh".to_string(),
            "/usr/bin/gh".to_string(),
            "/home/linuxbrew/.linuxbrew/bin/gh".to_string(),
        ]
    };
    candidates.into_iter().find(|p| {
        Command::new(p)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

fn gh_token() -> Result<String, String> {
    let gh = gh_path().ok_or_else(|| tr!("The GitHub CLI isn't installed", "O GitHub CLI não está instalado"))?;
    let output = Command::new(gh)
        .args(["auth", "token", "--hostname", "github.com"])
        .output()
        .map_err(|e| e.to_string())?;
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || token.is_empty() {
        return Err(tr!("The GitHub CLI isn't signed in: run `gh auth login`", "O GitHub CLI não está conectado: rode `gh auth login`"));
    }
    Ok(token)
}

impl Auth {
    /// The token, from memory, the keychain or gh, in that order.
    fn token(&self) -> Result<String, String> {
        if let Some(token) = self.token.lock().unwrap().clone() {
            return Ok(token);
        }
        let source = *self.source.lock().unwrap();
        let token = match source {
            Some(Source::Gh) => gh_token()?,
            _ => {
                let token = keychain()?.get_password().map_err(|_| tr!("Not signed in to GitHub", "Você não está conectado ao GitHub"))?;
                *self.source.lock().unwrap() = Some(Source::Keychain);
                token
            }
        };
        *self.token.lock().unwrap() = Some(token.clone());
        Ok(token)
    }

    /// For git, which fetches a pull request's code for the AI (checkout.rs) from github.com.
    pub fn token_for_git(&self) -> Result<String, String> {
        self.token()
    }

    pub fn set_source(&self, source: Option<Source>) {
        *self.source.lock().unwrap() = source;
        *self.token.lock().unwrap() = None;
        *self.login.lock().unwrap() = None;
        *self.etags.lock().unwrap() = Etags::default();
        self.recent.lock().unwrap().clear();
    }

    /// Who's signed in: None when no one is (no token, or GitHub refused it); an error when GitHub
    /// couldn't be reached to tell.
    pub fn login(&self) -> Result<Option<String>, String> {
        if let Some(login) = self.login.lock().unwrap().clone() {
            return Ok(Some(login));
        }
        if self.token().is_err() {
            return Ok(None);
        }
        let (status, body) = self.request("GET", "/user", None, None)?;
        match status {
            200 => {
                let login = serde_json::from_str::<Value>(&body).ok().and_then(|v| v["login"].as_str().map(String::from));
                login.clone_into(&mut self.login.lock().unwrap());
                Ok(login)
            }
            401 => Ok(None),
            _ => Err(tr!("GitHub returned {status}", "O GitHub respondeu {status}")),
        }
    }

    pub fn status(&self) -> Status {
        let login = self.login().ok().flatten();
        Status {
            signed_in: login.is_some(),
            source: if login.is_some() { *self.source.lock().unwrap() } else { None },
            login,
            device_flow: CLIENT_ID.is_some(),
            gh_available: gh_path().is_some(),
        }
    }

    pub fn use_gh(&self) -> Result<(), String> {
        gh_token()?;
        self.set_source(Some(Source::Gh));
        Ok(())
    }

    /// A pasted token (classic or fine-grained), checked against GitHub before it's kept.
    pub fn use_token(&self, token: &str) -> Result<(), String> {
        let token = token.trim();
        if token.is_empty() || token.chars().any(char::is_whitespace) {
            return Err(tr!("That doesn't look like a token", "Isso não parece um token"));
        }
        let (status, _, _) = call(token, "GET", "/user", None, None, None)?;
        if status != 200 {
            return Err(tr!("GitHub didn't accept that token", "O GitHub não aceitou esse token"));
        }
        keychain()?.set_password(token).map_err(|e| e.to_string())?;
        self.set_source(Some(Source::Keychain));
        Ok(())
    }

    pub fn sign_out(&self) -> Result<(), String> {
        if *self.source.lock().unwrap() != Some(Source::Gh) {
            // Nothing stored is fine.
            let _ = keychain()?.delete_credential();
        }
        self.set_source(None);
        Ok(())
    }

    /// A page's call: reads answered in the last two minutes come from memory; writes go through
    /// and clear that memory.
    pub fn request_for_page(&self, method: &str, path: &str, body: Option<&str>, accept: Option<&str>) -> Result<(u16, String), String> {
        let read = method == "GET" || (method == "POST" && path == "/graphql" && is_query(body));
        if !read {
            self.recent.lock().unwrap().clear();
            return self.request(method, path, body, accept);
        }
        let key = format!("{method} {path} {} {}", accept.unwrap_or(""), body.unwrap_or(""));
        if let Some(hit) = self.recent.lock().unwrap().get(&key) {
            return Ok(hit);
        }
        let (status, text) = self.request(method, path, body, accept)?;
        if status == 200 {
            self.recent.lock().unwrap().put(key, status, text.clone());
        }
        Ok((status, text))
    }

    /// Calls the REST or GraphQL API. Returns the status and body for the web view to read.
    pub fn request(&self, method: &str, path: &str, body: Option<&str>, accept: Option<&str>) -> Result<(u16, String), String> {
        let token = self.token()?;
        let (status, text) = self.call_tagged(&token, method, path, body, accept)?;
        if status == 401 && *self.source.lock().unwrap() == Some(Source::Gh) {
            // gh may have been signed in again since: read its token once more.
            *self.token.lock().unwrap() = None;
            return self.call_tagged(&self.token()?, method, path, body, accept);
        }
        Ok((status, text))
    }

    /// A GET whose answer is bytes, not text (a file at a commit, blobs.rs), up to `largest`.
    pub fn get_bytes(&self, path: &str, accept: &str, largest: usize) -> Result<(u16, Vec<u8>), String> {
        let token = self.token()?;
        let (status, bytes) = call_bytes(&token, path, accept, largest)?;
        if status == 401 && *self.source.lock().unwrap() == Some(Source::Gh) {
            // gh may have been signed in again since: read its token once more.
            *self.token.lock().unwrap() = None;
            return call_bytes(&self.token()?, path, accept, largest);
        }
        Ok((status, bytes))
    }

    /// `call`, with GET responses revalidated by their ETag.
    fn call_tagged(&self, token: &str, method: &str, path: &str, body: Option<&str>, accept: Option<&str>) -> Result<(u16, String), String> {
        if method != "GET" {
            return call(token, method, path, body, accept, None).map(|(status, text, _)| (status, text));
        }
        let key = format!("{}\n{path}", accept.unwrap_or(""));
        let known = self.etags.lock().unwrap().get(&key).cloned();
        let (status, text, etag) = call(token, method, path, None, accept, known.as_ref().map(|(etag, _)| etag.as_str()))?;
        if status == 304
            && let Some((_, body)) = known {
                return Ok((200, body));
            }
        if let (200, Some(etag)) = (status, etag) {
            self.etags.lock().unwrap().put(key, etag, text.clone());
        }
        Ok((status, text))
    }
}

fn call(token: &str, method: &str, path: &str, body: Option<&str>, accept: Option<&str>, if_none_match: Option<&str>) -> Result<(u16, String, Option<String>), String> {
    // Only ever the API, whatever path a page sends: no other host, no scheme tricks.
    if !path.starts_with('/') || path.starts_with("//") || path.contains('\\') {
        return Err("Bad request".into());
    }
    let url = format!("{API}{path}");
    let accept = accept.unwrap_or("application/vnd.github+json");
    let agent = agent();
    let auth = format!("Bearer {token}");
    let response = match (method, body) {
        ("GET", _) => {
            let request = agent.get(&url).header("Authorization", &auth).header("Accept", accept).header("X-GitHub-Api-Version", "2022-11-28");
            match if_none_match {
                Some(etag) => request.header("If-None-Match", etag).call(),
                None => request.call(),
            }
        }
        ("DELETE", None) => agent.delete(&url).header("Authorization", &auth).header("Accept", accept).header("X-GitHub-Api-Version", "2022-11-28").call(),
        (_, body) => {
            let request = match method {
                "POST" => agent.post(&url),
                "PATCH" => agent.patch(&url),
                "PUT" => agent.put(&url),
                "DELETE" => agent.delete(&url).force_send_body(),
                _ => return Err("Bad request".into()),
            };
            request
                .header("Authorization", &auth)
                .header("Accept", accept)
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("Content-Type", "application/json")
                .send(body.unwrap_or(""))
        }
    }
    .map_err(|e| tr!("Couldn't reach GitHub: {e}", "Não foi possível falar com o GitHub: {e}"))?;
    let status = response.status().as_u16();
    let etag = response.headers().get("etag").and_then(|v| v.to_str().ok()).map(String::from);
    let mut text = String::new();
    response
        .into_body()
        .into_reader()
        .take(64 * 1024 * 1024) // a sane ceiling for one response
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    Ok((status, text, etag))
}

fn call_bytes(token: &str, path: &str, accept: &str, largest: usize) -> Result<(u16, Vec<u8>), String> {
    // Only ever the API, as `call`.
    if !path.starts_with('/') || path.starts_with("//") || path.contains('\\') {
        return Err("Bad request".into());
    }
    let response = agent()
        .get(&format!("{API}{path}"))
        .header("Authorization", &format!("Bearer {token}"))
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(|e| tr!("Couldn't reach GitHub: {e}", "Não foi possível falar com o GitHub: {e}"))?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    response.into_body().into_reader().take(largest as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > largest {
        return Err(tr!("The file is too large to show", "O arquivo é grande demais para mostrar"));
    }
    Ok((status, bytes))
}

#[derive(Serialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

pub fn device_start() -> Result<DeviceCode, String> {
    let client_id = CLIENT_ID.ok_or_else(|| tr!("Signing in with GitHub isn't set up in this build", "Entrar com o GitHub não está configurado nesta versão"))?;
    let response = agent()
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .send_form([("client_id", client_id), ("scope", SCOPES)])
        .map_err(|e| tr!("Couldn't reach GitHub: {e}", "Não foi possível falar com o GitHub: {e}"))?;
    let v: Value = response.into_body().read_json().map_err(|e| e.to_string())?;
    Ok(DeviceCode {
        device_code: v["device_code"].as_str().ok_or_else(|| tr!("GitHub didn't send a code", "O GitHub não mandou um código"))?.to_string(),
        user_code: v["user_code"].as_str().ok_or_else(|| tr!("GitHub didn't send a code", "O GitHub não mandou um código"))?.to_string(),
        verification_uri: v["verification_uri"].as_str().unwrap_or("https://github.com/login/device").to_string(),
        interval: v["interval"].as_u64().unwrap_or(5),
        expires_in: v["expires_in"].as_u64().unwrap_or(900),
    })
}

/// Waits for the person to enter the code on github.com, then keeps the token in the keychain.
/// Blocking: run it off the main thread.
pub fn device_finish(auth: &Auth, device_code: &str, mut interval: u64, expires_in: u64) -> Result<(), String> {
    let client_id = CLIENT_ID.ok_or_else(|| tr!("Signing in with GitHub isn't set up in this build", "Entrar com o GitHub não está configurado nesta versão"))?;
    let deadline = Instant::now() + Duration::from_secs(expires_in);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_secs(interval));
        let response = agent()
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .send_form([
                ("client_id", client_id),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .map_err(|e| tr!("Couldn't reach GitHub: {e}", "Não foi possível falar com o GitHub: {e}"))?;
        let v: Value = response.into_body().read_json().map_err(|e| e.to_string())?;
        if let Some(token) = v["access_token"].as_str() {
            keychain()?.set_password(token).map_err(|e| e.to_string())?;
            auth.set_source(Some(Source::Keychain));
            return Ok(());
        }
        match v["error"].as_str() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += 5,
            Some("expired_token") => return Err(tr!("The code expired: start again", "O código expirou: comece de novo")),
            Some("access_denied") => return Err(tr!("Signing in was cancelled on GitHub", "A entrada foi cancelada no GitHub")),
            Some(other) => return Err(format!("GitHub: {other}")),
            None => return Err(tr!("Unexpected reply from GitHub", "Resposta inesperada do GitHub")),
        }
    }
    Err(tr!("The code expired: start again", "O código expirou: comece de novo"))
}
