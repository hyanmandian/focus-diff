use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use crate::i18n::tr;
use crate::sync::Locked;

const KEYCHAIN_SERVICE: &str = "com.focusdiff.app";
const KEYCHAIN_ACCOUNT: &str = "github";
const API: &str = "https://api.github.com";
const SCOPES: &str = "repo read:org read:user";
const CLIENT_ID: Option<&str> = option_env!("FOCUS_DIFF_GITHUB_CLIENT_ID");

#[derive(Default)]
pub struct Auth {
    token: Mutex<Option<String>>,
    source: Mutex<Option<Source>>,
    login: Mutex<Option<String>>,
    etags: Mutex<Etags>,
    recent: Mutex<Recent>,
}

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

fn is_query(body: Option<&str>) -> bool {
    body.and_then(|b| serde_json::from_str::<Value>(b).ok())
        .and_then(|v| v["query"].as_str().map(|q| q.trim_start().to_string()))
        .is_some_and(|q| q.starts_with("query") || q.starts_with('{'))
}

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
    Keychain,
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

pub fn name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name != "." && name != ".." && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

pub fn repo_ok(repo: &str) -> bool {
    repo.split_once('/').is_some_and(|(owner, name)| name_ok(owner) && name_ok(name))
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

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
    fn token(&self) -> Result<String, String> {
        if let Some(token) = self.token.held().clone() {
            return Ok(token);
        }
        let source = *self.source.held();
        let token = match source {
            Some(Source::Gh) => gh_token()?,
            _ => {
                let token = keychain()?.get_password().map_err(|_| tr!("Not signed in to GitHub", "Você não está conectado ao GitHub"))?;
                *self.source.held() = Some(Source::Keychain);
                token
            }
        };
        *self.token.held() = Some(token.clone());
        Ok(token)
    }

    pub fn token_for_git(&self) -> Result<String, String> {
        self.token()
    }

    pub fn set_source(&self, source: Option<Source>) {
        *self.source.held() = source;
        *self.token.held() = None;
        *self.login.held() = None;
        *self.etags.held() = Etags::default();
        self.recent.held().clear();
    }

    pub fn login(&self) -> Result<Option<String>, String> {
        if let Some(login) = self.login.held().clone() {
            return Ok(Some(login));
        }
        if self.token().is_err() {
            return Ok(None);
        }
        let (status, body) = self.request("GET", "/user", None, None)?;
        match status {
            200 => {
                let login = serde_json::from_str::<Value>(&body).ok().and_then(|v| v["login"].as_str().map(String::from));
                login.clone_into(&mut self.login.held());
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
            source: if login.is_some() { *self.source.held() } else { None },
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
        if *self.source.held() != Some(Source::Gh) {
            let _ = keychain()?.delete_credential();
        }
        self.set_source(None);
        Ok(())
    }

    pub fn request_for_page(&self, method: &str, path: &str, body: Option<&str>, accept: Option<&str>) -> Result<(u16, String), String> {
        let read = method == "GET" || (method == "POST" && ((path == "/graphql" && is_query(body)) || path == "/markdown"));
        if !read {
            self.recent.held().clear();
            return self.request(method, path, body, accept);
        }
        let key = format!("{method} {path} {} {}", accept.unwrap_or(""), body.unwrap_or(""));
        if let Some(hit) = self.recent.held().get(&key) {
            return Ok(hit);
        }
        let (status, text) = self.request(method, path, body, accept)?;
        if status == 200 {
            self.recent.held().put(key, status, text.clone());
        }
        Ok((status, text))
    }

    pub fn request(&self, method: &str, path: &str, body: Option<&str>, accept: Option<&str>) -> Result<(u16, String), String> {
        self.with_token(|token| self.call_tagged(token, method, path, body, accept))
    }

    pub fn get_bytes(&self, path: &str, accept: &str, largest: usize) -> Result<(u16, Vec<u8>), String> {
        self.with_token(|token| call_bytes(token, path, accept, largest))
    }

    fn with_token<T>(&self, call: impl Fn(&str) -> Result<(u16, T), String>) -> Result<(u16, T), String> {
        let (status, answer) = call(&self.token()?)?;
        if status == 401 && *self.source.held() == Some(Source::Gh) {
            *self.token.held() = None;
            return call(&self.token()?);
        }
        Ok((status, answer))
    }

    pub fn redirect(&self, path: &str) -> Result<(u16, Option<String>), String> {
        let response = api(agent().get(api_url(path)?), &self.token()?, "application/vnd.github+json").config().max_redirects(0).build().call().map_err(unreachable)?;
        let location = response.headers().get("location").and_then(|v| v.to_str().ok()).map(String::from);
        Ok((response.status().as_u16(), location))
    }

    fn call_tagged(&self, token: &str, method: &str, path: &str, body: Option<&str>, accept: Option<&str>) -> Result<(u16, String), String> {
        if method != "GET" {
            return call(token, method, path, body, accept, None).map(|(status, text, _)| (status, text));
        }
        let key = format!("{}\n{path}", accept.unwrap_or(""));
        let known = self.etags.held().get(&key).cloned();
        let (status, text, etag) = call(token, method, path, None, accept, known.as_ref().map(|(etag, _)| etag.as_str()))?;
        if status == 304
            && let Some((_, body)) = known {
                return Ok((200, body));
            }
        if let (200, Some(etag)) = (status, etag) {
            self.etags.held().put(key, etag, text.clone());
        }
        Ok((status, text))
    }
}

pub(crate) fn path_ok(path: &str) -> bool {
    path.starts_with('/') && !path.starts_with("//") && !path.contains('\\')
}

pub(crate) fn https_host(url: &str) -> Option<String> {
    let host = url.strip_prefix("https://")?.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    (!host.is_empty() && !host.contains(['@', ':', '\\'])).then_some(host)
}

fn api_url(path: &str) -> Result<String, String> {
    if path_ok(path) { Ok(format!("{API}{path}")) } else { Err("Bad request".into()) }
}

fn api<B>(request: ureq::RequestBuilder<B>, token: &str, accept: &str) -> ureq::RequestBuilder<B> {
    request.header("Authorization", &format!("Bearer {token}")).header("Accept", accept).header("X-GitHub-Api-Version", "2022-11-28")
}

fn unreachable(e: ureq::Error) -> String {
    tr!("Couldn't reach GitHub: {e}", "Não foi possível falar com o GitHub: {e}")
}

fn call(token: &str, method: &str, path: &str, body: Option<&str>, accept: Option<&str>, if_none_match: Option<&str>) -> Result<(u16, String, Option<String>), String> {
    let url = api_url(path)?;
    let accept = accept.unwrap_or("application/vnd.github+json");
    let agent = agent();
    let response = match (method, body) {
        ("GET", _) => {
            let request = api(agent.get(&url), token, accept);
            match if_none_match {
                Some(etag) => request.header("If-None-Match", etag).call(),
                None => request.call(),
            }
        }
        ("DELETE", None) => api(agent.delete(&url), token, accept).call(),
        (_, body) => {
            let request = match method {
                "POST" => agent.post(&url),
                "PATCH" => agent.patch(&url),
                "PUT" => agent.put(&url),
                "DELETE" => agent.delete(&url).force_send_body(),
                _ => return Err("Bad request".into()),
            };
            api(request, token, accept).header("Content-Type", "application/json").send(body.unwrap_or(""))
        }
    }
    .map_err(unreachable)?;
    let status = response.status().as_u16();
    let etag = response.headers().get("etag").and_then(|v| v.to_str().ok()).map(String::from);
    let mut text = String::new();
    response
        .into_body()
        .into_reader()
        .take(64 * 1024 * 1024)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    Ok((status, text, etag))
}

fn call_bytes(token: &str, path: &str, accept: &str, largest: usize) -> Result<(u16, Vec<u8>), String> {
    let response = api(agent().get(api_url(path)?), token, accept).call().map_err(unreachable)?;
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
        .map_err(unreachable)?;
    let v: Value = response.into_body().read_json().map_err(|e| e.to_string())?;
    Ok(DeviceCode {
        device_code: v["device_code"].as_str().ok_or_else(|| tr!("GitHub didn't send a code", "O GitHub não mandou um código"))?.to_string(),
        user_code: v["user_code"].as_str().ok_or_else(|| tr!("GitHub didn't send a code", "O GitHub não mandou um código"))?.to_string(),
        verification_uri: v["verification_uri"].as_str().unwrap_or("https://github.com/login/device").to_string(),
        interval: v["interval"].as_u64().unwrap_or(5),
        expires_in: v["expires_in"].as_u64().unwrap_or(900),
    })
}

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
            .map_err(unreachable)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_of_https_addresses() {
        assert_eq!(https_host("https://X.GitHubUserContent.com/a?b").as_deref(), Some("x.githubusercontent.com"));
        for bad in ["http://github.com/", "https://", "https://user@github.com/", "https://github.com:8443/", "https://evil.com\\.github.com/"] {
            assert_eq!(https_host(bad), None, "{bad}");
        }
    }

    #[test]
    fn repository_names() {
        assert!(repo_ok("acme/web.site") && repo_ok("acme/.github") && repo_ok("focus-diff/focus_diff"));
        for bad in ["acme", "acme/", "/web", "acme/..", "../web", "acme/web/x", "acme/a b", "acme/a\\b"] {
            assert!(!repo_ok(bad), "{bad}");
        }
    }
}
