use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Deserialize;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::ai;
use crate::i18n::tr;

const TIME_LIMIT: Duration = Duration::from_secs(120);

#[derive(Deserialize)]
pub struct Context {
    number: u64,
    repo: String,
    title: String,
    url: String,
    author: String,
    me: String,
}

impl Context {
    fn check(&self) -> Result<(), String> {
        let login = |s: &str| s.len() <= 60 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-[]".contains(c));
        if crate::github::repo_ok(&self.repo) && login(&self.author) && login(&self.me) && self.url.starts_with("https://github.com/") && self.title.len() <= 1000 {
            Ok(())
        } else {
            Err(tr!("That isn't a pull request", "Isso não é um pull request"))
        }
    }
}

fn command_of(config: &Path, action: &str, step: usize) -> Result<String, String> {
    let text = fs::read_to_string(config).map_err(|_| tr!("Actions are set up in Settings", "As ações são configuradas nos Ajustes"))?;
    let config: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let action = config["actions"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|a| std::iter::once(a).chain(a["choices"].as_array().into_iter().flatten()))
        .find(|a| a["id"].as_str() == Some(action))
        .ok_or_else(|| tr!("That action is gone", "Essa ação não existe mais"))?;
    let step = &action["steps"][step];
    match (step["kind"].as_str(), step["command"].as_str()) {
        (Some("run"), Some(command)) if !command.trim().is_empty() => Ok(command.to_string()),
        _ => Err(tr!("That step has no command", "Esse passo não tem comando")),
    }
}

fn allowed(path: &Path) -> HashSet<String> {
    fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn ask(app: &tauri::AppHandle, name: &str, command: &str) -> bool {
    let shown: String = command.chars().take(600).collect();
    app.dialog()
        .message(tr!(
            "“{name}” wants to run this command, as you:\n\n{shown}\n\nIt gets the pull request's number, title, link, repository and author, and your GitHub login. Allow it from now on?",
            "“{name}” quer rodar este comando, como você:\n\n{shown}\n\nEle recebe o número, o título, o link, o repositório e o autor do pull request, e o seu login do GitHub. Permitir daqui em diante?"
        ))
        .title(tr!("Run a command?", "Rodar um comando?"))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(tr!("Allow and run", "Permitir e rodar"), tr!("Cancel", "Cancelar")))
        .blocking_show()
}

fn for_shell(value: &str) -> String {
    if cfg!(windows) { value.chars().map(|c| if "\"&|<>^%!`\r\n".contains(c) { ' ' } else { c }).collect() } else { value.to_string() }
}

fn shell(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut shell = Command::new("cmd");
        shell.raw_arg("/S /C").raw_arg(format!("\"{command}\""));
        shell
    }
    #[cfg(not(windows))]
    {
        let mut shell = Command::new("/bin/sh");
        shell.arg("-c").arg(command);
        shell
    }
}

pub fn run(app: &tauri::AppHandle, config: PathBuf, trusted: PathBuf, action: &str, name: &str, step: usize, pr: Context) -> Result<String, String> {
    pr.check()?;
    let command = command_of(&config, action, step)?;
    let mut allowed = allowed(&trusted);
    if !allowed.contains(&command) {
        if !ask(app, name, &command) {
            return Err(tr!("Not run", "Não foi rodado"));
        }
        allowed.insert(command.clone());
        let json = serde_json::to_string_pretty(&allowed).map_err(|e| e.to_string())?;
        fs::write(&trusted, json).map_err(|e| e.to_string())?;
    }

    let mut shell = shell(&command);
    shell
        .env("PATH", ai::search_path())
        .env("PR_NUMBER", pr.number.to_string())
        .env("PR_REPO", for_shell(&pr.repo))
        .env("PR_TITLE", for_shell(&pr.title))
        .env("PR_URL", for_shell(&pr.url))
        .env("PR_AUTHOR", for_shell(&pr.author))
        .env("GITHUB_LOGIN", for_shell(&pr.me));
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        shell.current_dir(home);
    }
    let output = ai::run_with_limit(&mut shell, None, TIME_LIMIT)?;
    let said = |s: &str| s.trim().lines().last().unwrap_or_default().chars().take(300).collect::<String>();
    if output.status_ok {
        Ok(said(&output.stdout))
    } else {
        let message = said(&output.stderr);
        Err(if message.is_empty() { tr!("The command failed", "O comando falhou") } else { message })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_run_steps_of_saved_actions() {
        let dir = std::env::temp_dir().join(format!("fdp-actions-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let config = dir.join("config.json");
        fs::write(&config, r#"{"actions":[{"id":"a1","steps":[{"kind":"comment","body":"hi"},{"kind":"run","command":"echo ok"}]}]}"#).unwrap();
        assert_eq!(command_of(&config, "a1", 1).as_deref(), Ok("echo ok"));
        assert!(command_of(&config, "a1", 0).is_err());
        assert!(command_of(&config, "a1", 5).is_err());
        assert!(command_of(&config, "nope", 1).is_err());
        fs::write(&config, r#"{"actions":[{"id":"a1","steps":[],"choices":[{"id":"c1","steps":[{"kind":"run","command":"echo dana"}]}]}]}"#).unwrap();
        assert_eq!(command_of(&config, "c1", 0).as_deref(), Ok("echo dana"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn keeps_what_a_pull_request_says_out_of_the_windows_shell() {
        let title = for_shell("a & echo pwned %PATH% | b");
        if cfg!(windows) {
            assert!(!title.contains(['&', '%', '|']));
        } else {
            assert_eq!(title, "a & echo pwned %PATH% | b");
        }
    }

    #[test]
    fn runs_the_command_as_written() {
        let output = shell(r#"echo "a b""#).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), if cfg!(windows) { r#""a b""# } else { "a b" });
    }

    #[test]
    fn checks_the_pull_request() {
        let pr = |repo: &str, url: &str| Context { number: 1, repo: repo.into(), title: "x".into(), url: url.into(), author: "ana".into(), me: "me".into() };
        assert!(pr("acme/web", "https://github.com/acme/web/pull/1").check().is_ok());
        assert!(pr("acme/web;rm", "https://github.com/acme/web/pull/1").check().is_err());
        assert!(pr("acme/web", "https://evil.example/").check().is_err());
    }
}
