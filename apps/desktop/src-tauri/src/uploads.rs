//! Pictures and videos attached to a comment, the way github.com attaches them: GitHub has no
//! API for it, so this does what github.com's comment box does, as the person signed in on
//! github.com (web.rs). The address it gives back (github.com/user-attachments/assets/…) follows
//! the repository's permissions, so nothing from a private repository is shown to anyone else.
//!
//! 1. The pull request's page, for the upload token, the page's fetch nonce and the
//!    repository's id.
//! 2. POST /upload/policies/assets: where to put the file (GitHub's storage, on S3) and with what.
//! 3. The file to that storage, with only the fields it was given: no GitHub cookies go there.
//! 4. PUT the asset's upload address on github.com, which makes it live.
//!
//! None of this is documented by GitHub; the steps follow github.com's own requests as
//! open-source tools reproduce them (drogers0/gh-image, sudosubin/gh-attach).

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

use crate::i18n::tr;
use crate::web::{self, HOST, Session, WebSession};

const IMAGE_LIMIT: usize = 10 * 1024 * 1024;
/// GitHub's limit on paid plans; on free ones it's 10 MB, and GitHub says so when it refuses.
const VIDEO_LIMIT: usize = 100 * 1024 * 1024;

/// Why an upload didn't happen, as the pages tell it apart.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Error {
    /// Nobody's signed in on github.com in the app.
    NotSignedIn,
    /// The session ended (signed out on github.com, or it expired): sign in again.
    SessionExpired,
    Failed { message: String },
}

fn failed(message: String) -> Error {
    Error::Failed { message }
}

#[derive(Serialize)]
pub struct Uploaded {
    pub href: String,
    /// "image" or "video": how it goes into the comment.
    pub kind: &'static str,
}

/// What GitHub takes, by the file's extension, checked against its first bytes; true for videos.
fn content_type(name: &str, bytes: &[u8]) -> Option<(&'static str, bool)> {
    let extension = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let (kind, video) = match extension.as_str() {
        "png" => ("image/png", false),
        "jpg" | "jpeg" => ("image/jpeg", false),
        "gif" => ("image/gif", false),
        "webp" => ("image/webp", false),
        "svg" => ("image/svg+xml", false),
        "mp4" | "m4v" => ("video/mp4", true),
        "mov" => ("video/quicktime", true),
        "webm" => ("video/webm", true),
        _ => return None,
    };
    let looks_right = match kind {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G']),
        "image/jpeg" => bytes.starts_with(&[0xFF, 0xD8]),
        "image/gif" => bytes.starts_with(b"GIF"),
        "image/webp" => bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "image/svg+xml" => String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).contains("<svg"),
        "video/webm" => bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]),
        _ => bytes.get(4..8) == Some(b"ftyp"),
    };
    looks_right.then_some((kind, video))
}

// MARK: The page

/// What the pull request's page gives for an upload.
#[derive(Default, Debug)]
struct Page {
    referer: String,
    /// The comment box's own upload token, in the page's data.
    upload_token: Option<String>,
    fetch_nonce: Option<String>,
    release: Option<String>,
    repository_id: Option<u64>,
}

fn pattern(cell: &'static OnceLock<Regex>, source: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(source).expect("a valid pattern"))
}

fn parse_page(referer: String, html: &str) -> Page {
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    static NONCE: OnceLock<Regex> = OnceLock::new();
    static RELEASE: OnceLock<Regex> = OnceLock::new();
    static IDS: OnceLock<[Regex; 4]> = OnceLock::new();
    let first = |re: &Regex| re.captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).filter(|s| !s.is_empty());
    let ids = IDS.get_or_init(|| {
        [
            r#"<file-attachment\b[^>]*data-upload-repository-id=["'](\d+)["']"#,
            r#""repository"\s*:\s*\{[^{}]*"databaseId"\s*:\s*(\d+)"#,
            r#"<meta\b[^>]*name=["']octolytics-dimension-repository_id["'][^>]*content=["'](\d+)["']"#,
            r#"<deferred-side-panel\b[^>]*data-url=["'][^"']*(?:\?|&(?:amp;)?)repository_id=(\d+)"#,
        ]
        .map(|p| Regex::new(p).expect("a valid pattern"))
    });
    Page {
        referer,
        upload_token: first(pattern(&TOKEN, r#""uploadToken"\s*:\s*"([^"]+)""#)),
        fetch_nonce: first(pattern(&NONCE, r#"<meta[^>]*name=["']fetch-nonce["'][^>]*content=["']([^"']+)["']"#)),
        release: first(pattern(&RELEASE, r#"<meta[^>]*name=["']release["'][^>]*content=["']([^"']+)["']"#)),
        repository_id: ids.iter().find_map(|re| first(re).and_then(|id| id.parse().ok()).filter(|id| *id > 0)),
    }
}

/// github.com's "Sign in to GitHub" page, served in place of the one asked for when the session
/// has ended (a real page carries "currentUser" in its data, signed in or not).
fn is_sign_in_page(html: &str) -> bool {
    let start = html.find("<title>").map(|i| &html[i + 7..]).unwrap_or("");
    start.trim_start().starts_with("Sign in to") && !html.contains("\"currentUser\"")
}

fn is_sign_in(location: Option<&str>) -> bool {
    location.is_some_and(|l| {
        let path = l.strip_prefix(HOST).unwrap_or(l);
        path.starts_with("/login") || path.starts_with("/session")
    })
}

/// A page of the repository, read as the person signed in on github.com.
fn read_page(session: &mut Session, owner: &str, path: &str) -> Result<Option<Page>, Error> {
    let answer = web::request(session, "GET", path, &[("Accept", "text/html")], None).map_err(failed)?;
    match answer.status {
        200 if is_sign_in_page(&answer.body) => {
            // An organization's single sign-on, not the end of the session.
            if answer.body.to_ascii_lowercase().contains(&format!("/orgs/{}/sso", owner.to_ascii_lowercase())) {
                return Err(failed(tr!(
                    "{owner} asks for single sign-on on github.com: open the pull request there once to authorize, then try again",
                    "{owner} pede login único (SSO) no github.com: abra o pull request lá uma vez para autorizar e tente de novo"
                )));
            }
            Err(Error::SessionExpired)
        }
        200 => Ok(Some(parse_page(format!("{HOST}{path}"), &answer.body))),
        300..=399 if is_sign_in(answer.location.as_deref()) => Err(Error::SessionExpired),
        _ => Ok(None),
    }
}

fn find_page<R: Runtime>(app: &AppHandle<R>, session: &mut Session, owner: &str, repo: &str, number: u64) -> Result<Page, Error> {
    let Some(mut page) = read_page(session, owner, &format!("/{owner}/{repo}/pull/{number}"))? else {
        let login = &session.login;
        return Err(failed(tr!(
            "github.com didn't show this pull request to @{login}: is that the account you review with?",
            "O github.com não mostrou este pull request para @{login}: é a conta com que você revisa?"
        )));
    };
    // The upload token is on the repository's page when the pull request's doesn't carry it.
    if page.upload_token.is_none()
        && let Ok(Some(home)) = read_page(session, owner, &format!("/{owner}/{repo}"))
    {
        page.upload_token = home.upload_token;
        page.repository_id = page.repository_id.or(home.repository_id);
        if page.fetch_nonce.is_none() {
            page.fetch_nonce = home.fetch_nonce;
            page.release = home.release;
            page.referer = home.referer;
        }
    }
    if page.repository_id.is_none() {
        let (status, body) = app.state::<crate::github::Auth>().request_for_page("GET", &format!("/repos/{owner}/{repo}"), None, None).map_err(failed)?;
        page.repository_id = (status == 200).then(|| serde_json::from_str::<Value>(&body).ok()?["id"].as_u64()).flatten();
    }
    if page.repository_id.is_none() || (page.upload_token.is_none() && page.fetch_nonce.is_none()) {
        return Err(failed(tr!(
            "github.com's page didn't have what an upload needs; it may have changed",
            "A página do github.com não tinha o que um envio precisa; ela pode ter mudado"
        )));
    }
    Ok(page)
}

// MARK: Requests

/// multipart/form-data, as a browser sends a form: the fields, then the file if there's one.
fn multipart(fields: &[(&str, &str)], file: Option<(&str, &str, &[u8])>) -> (String, Vec<u8>) {
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let boundary = format!("----FocusDiff{nanos:x}{:x}", COUNT.fetch_add(1, Ordering::Relaxed));
    let clean = |s: &str| s.replace(['\r', '\n'], " ").replace('"', "%22");
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{value}\r\n", clean(name)).as_bytes());
    }
    if let Some((name, kind, bytes)) = file {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: {kind}\r\n\r\n", clean(name)).as_bytes());
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

/// What GitHub said when it refused, in its words when it gave some.
fn refusal(status: u16, body: &str) -> Error {
    let said = serde_json::from_str::<Value>(body).ok().and_then(|v| {
        let text = |v: &Value| v.as_str().map(String::from);
        text(&v["message"])
            .or_else(|| text(&v["error"]))
            .or_else(|| v["errors"].as_array().and_then(|e| e.iter().find_map(|e| text(e).or_else(|| text(&e["message"])))))
    });
    failed(match said {
        Some(said) => tr!("GitHub didn't take it: {said}", "O GitHub não aceitou: {said}"),
        None => tr!("GitHub didn't take it ({status})", "O GitHub não aceitou ({status})"),
    })
}

/// The headers github.com's comment box sends with its requests.
fn headers(page: &Page) -> Vec<(&'static str, String)> {
    let mut list = vec![
        ("Accept", "application/json".to_string()),
        ("X-Requested-With", "XMLHttpRequest".to_string()),
        ("GitHub-Verified-Fetch", "true".to_string()),
        ("Origin", HOST.to_string()),
        ("Referer", page.referer.clone()),
    ];
    if let Some(nonce) = &page.fetch_nonce {
        list.push(("X-Fetch-Nonce", nonce.clone()));
    }
    if let Some(release) = &page.release {
        list.push(("X-GitHub-Client-Version", release.clone()));
    }
    list
}

fn send(session: &mut Session, method: &str, path: &str, page: &Page, fields: &[(&str, &str)]) -> Result<web::Answer, Error> {
    let owned = headers(page);
    let list: Vec<(&str, &str)> = owned.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let (kind, body) = multipart(fields, None);
    let answer = web::request(session, method, path, &list, Some((&kind, &body))).map_err(failed)?;
    if (300..400).contains(&answer.status) && is_sign_in(answer.location.as_deref()) || answer.status == 401 {
        return Err(Error::SessionExpired);
    }
    Ok(answer)
}

/// The asset's upload policy: where the file goes and what it's sent with.
fn policy(session: &mut Session, page: &Page, name: &str, size: usize, kind: &str) -> Result<Value, Error> {
    let size = size.to_string();
    let id = page.repository_id.unwrap_or_default().to_string();
    let mut fields = vec![("name", name), ("size", size.as_str()), ("content_type", kind)];
    if let Some(token) = &page.upload_token {
        fields.push(("authenticity_token", token.as_str()));
    }
    fields.push(("repository_id", id.as_str()));
    let mut answer = send(session, "POST", "/upload/policies/assets", page, &fields)?;
    // Refused with the page's token: once more with the fetch nonce alone, as the newer comment box asks.
    if matches!(answer.status, 403 | 422) && page.upload_token.is_some() && page.fetch_nonce.is_some() {
        fields.retain(|(k, _)| *k != "authenticity_token");
        let again = send(session, "POST", "/upload/policies/assets", page, &fields)?;
        if matches!(again.status, 200 | 201) {
            answer = again;
        }
    }
    if !matches!(answer.status, 200 | 201) {
        return Err(refusal(answer.status, &answer.body));
    }
    serde_json::from_str(&answer.body).map_err(|_| refusal(answer.status, ""))
}

/// The file to GitHub's storage, with the fields the policy gave, in its order, and the file last.
/// Only to an https address of its storage, and with no cookies.
fn store(policy: &Value, name: &str, kind: &str, bytes: &[u8]) -> Result<(), Error> {
    let url = policy["upload_url"].as_str().unwrap_or_default();
    let host = url.strip_prefix("https://").and_then(|r| r.split(['/', '?', '#']).next()).unwrap_or("").to_ascii_lowercase();
    if host.contains('@') || !(host.ends_with(".amazonaws.com") || host.ends_with(".githubusercontent.com") || host == "github.com") {
        return Err(failed(tr!("GitHub gave an unexpected upload address", "O GitHub deu um endereço de envio inesperado")));
    }
    let form: Vec<(String, String)> = policy["form"]
        .as_object()
        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_str().map(String::from).unwrap_or_else(|| v.to_string()))).collect())
        .unwrap_or_default();
    let fields: Vec<(&str, &str)> = form.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let (content_type, body) = multipart(&fields, Some((name, kind, bytes)));
    let mut request = crate::github::agent().post(url).header("Content-Type", &content_type).header("User-Agent", web::USER_AGENT);
    if let Some(extra) = policy["header"].as_object() {
        for (k, v) in extra {
            if let Some(v) = v.as_str() {
                request = request.header(k.as_str(), v);
            }
        }
    }
    let response = request
        .config()
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(15 * 60)))
        .build()
        .send(&body[..])
        .map_err(|e| failed(tr!("Couldn't reach GitHub's storage: {e}", "Não foi possível falar com o armazenamento do GitHub: {e}")))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(failed(tr!("GitHub's storage didn't take the file ({status})", "O armazenamento do GitHub não aceitou o arquivo ({status})")));
    }
    Ok(())
}

/// Makes the asset live on github.com, and its address.
fn finish(session: &mut Session, page: &Page, policy: &Value) -> Result<String, Error> {
    let path = policy["asset_upload_url"].as_str().unwrap_or_default();
    let token = policy["asset_upload_authenticity_token"].as_str().unwrap_or_default();
    let fallback = policy["asset"]["href"].as_str().unwrap_or_default().to_string();
    let href = if path.is_empty() {
        fallback
    } else {
        let answer = send(session, "PUT", path, page, &[("authenticity_token", token)])?;
        if !(200..300).contains(&answer.status) {
            return Err(refusal(answer.status, &answer.body));
        }
        serde_json::from_str::<Value>(&answer.body).ok().and_then(|v| v["href"].as_str().map(String::from)).filter(|h| !h.is_empty()).unwrap_or(fallback)
    };
    if !href.starts_with(&format!("{HOST}/")) {
        return Err(failed(tr!("GitHub didn't say where the file is", "O GitHub não disse onde o arquivo ficou")));
    }
    Ok(href)
}

/// Uploads one picture or video for a comment on `owner/repo#number`. Blocking.
pub fn upload<R: Runtime>(app: &AppHandle<R>, owner: &str, repo: &str, number: u64, name: &str, bytes: &[u8]) -> Result<Uploaded, Error> {
    let name_ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !name_ok(owner) || !name_ok(repo) || owner.starts_with('.') || repo.starts_with('.') {
        return Err(failed("Bad request".into()));
    }
    let name = name.trim().chars().filter(|c| !c.is_control() && !"/\\".contains(*c)).take(200).collect::<String>();
    let Some((kind, video)) = content_type(&name, bytes) else {
        return Err(failed(tr!(
            "{name} can't be attached: GitHub takes PNG, JPEG, GIF, WebP and SVG pictures, and MP4, MOV and WebM videos",
            "{name} não pode ser anexado: o GitHub aceita imagens PNG, JPEG, GIF, WebP e SVG, e vídeos MP4, MOV e WebM"
        )));
    };
    let limit = if video { VIDEO_LIMIT } else { IMAGE_LIMIT };
    if bytes.is_empty() || bytes.len() > limit {
        let mb = limit / 1024 / 1024;
        return Err(failed(tr!("{name} is over GitHub's limit of {mb} MB", "{name} passa do limite de {mb} MB do GitHub")));
    }
    let web_session = app.state::<WebSession>();
    let Some(mut session) = web_session.get() else { return Err(Error::NotSignedIn) };
    let before = serde_json::to_string(&session).unwrap_or_default();
    let result = (|| {
        let page = find_page(app, &mut session, owner, repo, number)?;
        let policy = policy(&mut session, &page, &name, bytes.len(), kind)?;
        store(&policy, &name, kind, bytes)?;
        finish(&mut session, &page, &policy)
    })();
    match &result {
        Err(Error::SessionExpired) => {
            web_session.forget();
            web::announce(app);
        }
        // github.com's cookies change as it answers: the newest are kept for next time.
        _ if serde_json::to_string(&session).unwrap_or_default() != before => {
            let _ = web_session.save(session);
        }
        _ => {}
    }
    result.map(|href| Uploaded { href, kind: if video { "video" } else { "image" } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_by_name_and_bytes() {
        assert_eq!(content_type("shot.PNG", b"\x89PNG\r\n"), Some(("image/png", false)));
        assert_eq!(content_type("a.jpg", b"\xFF\xD8\xFF"), Some(("image/jpeg", false)));
        assert_eq!(content_type("clip.mov", b"\0\0\0\x14ftypqt  "), Some(("video/quicktime", true)));
        assert_eq!(content_type("clip.webm", b"\x1A\x45\xDF\xA3"), Some(("video/webm", true)));
        assert_eq!(content_type("fake.png", b"GIF89a"), None);
        assert_eq!(content_type("notes.txt", b"hello"), None);
        assert_eq!(content_type("noextension", b"\x89PNG"), None);
    }

    #[test]
    fn reads_the_page() {
        let html = r#"<head><meta name="fetch-nonce" content="v2:abc"><meta name="release" content="deadbeef"><meta name="octolytics-dimension-repository_id" content="42"></head><script type="application/json">{"uploadToken":"tok123","x":1}</script>"#;
        let page = parse_page("https://github.com/a/b/pull/1".into(), html);
        assert_eq!(page.upload_token.as_deref(), Some("tok123"));
        assert_eq!(page.fetch_nonce.as_deref(), Some("v2:abc"));
        assert_eq!(page.release.as_deref(), Some("deadbeef"));
        assert_eq!(page.repository_id, Some(42));
        let attachment = parse_page(String::new(), r#"<file-attachment class="js-upload" data-upload-repository-id="7" data-upload-policy-url="/upload/policies/assets">"#);
        assert_eq!(attachment.repository_id, Some(7));
    }

    #[test]
    fn tells_an_ended_session() {
        assert!(is_sign_in_page("<html><title>Sign in to GitHub · GitHub</title>"));
        assert!(!is_sign_in_page(r#"<title>Sign in to fix things by acme · Pull Request #1</title><script>{"currentUser":null}</script>"#));
        assert!(is_sign_in(Some("https://github.com/login?return_to=x")));
        assert!(!is_sign_in(Some("https://github.com/acme/web/pull/1")));
    }

    #[test]
    fn forms_as_a_browser_sends_them() {
        let (kind, body) = multipart(&[("key", "a/b.png"), ("acl", "private")], Some(("my \"shot\".png", "image/png", b"PNG")));
        let boundary = kind.strip_prefix("multipart/form-data; boundary=").unwrap();
        let text = String::from_utf8(body).unwrap();
        assert!(text.starts_with(&format!("--{boundary}\r\nContent-Disposition: form-data; name=\"key\"\r\n\r\na/b.png\r\n")));
        assert!(text.contains("name=\"file\"; filename=\"my %22shot%22.png\"\r\nContent-Type: image/png\r\n\r\nPNG\r\n"));
        assert!(text.ends_with(&format!("--{boundary}--\r\n")));
        assert!(text.find("acl").unwrap() < text.find("name=\"file\"").unwrap());
    }

    #[test]
    fn github_words_when_refused() {
        let said = crate::i18n::in_locale(crate::i18n::Locale::En, || refusal(422, r#"{"errors":["Size must be less than 10 MB"]}"#));
        assert_eq!(said, failed("GitHub didn't take it: Size must be less than 10 MB".into()));
    }
}
