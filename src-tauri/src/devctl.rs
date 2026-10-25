//! Development only: drives the running app from a file, for testing it end to end without
//! clicking. Compiled into debug builds only (or with the `devctl` feature, to measure a release), and only listening when FOCUS_DIFF_DEVCTL names a
//! file. Each line appended to that file is a command:
//!
//! - `open panel|settings|setup`, `hide panel`, `close <window label>`, `open review <id> <owner/name> <number>`
//! - `eval <window label> <javascript>`: runs it in that window; pages report back with
//!   `window.__TAURI_INTERNALS__.invoke("log", { message })`, printed as `[label] message`
//! - `refresh` / `refresh force`, `windows`, `forget <n>` (the next refresh finds n pull requests'
//!   latest events new)
//!
//! Output goes to the terminal running `tauri dev`, prefixed with [devctl].

use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect};

pub fn start(app: &AppHandle) {
    let Ok(path) = std::env::var("FOCUS_DIFF_DEVCTL") else { return };
    let _ = std::fs::write(&path, "");
    let app = app.clone();
    std::thread::spawn(move || {
        let mut offset = 0;
        loop {
            std::thread::sleep(Duration::from_millis(200));
            let Ok(mut file) = std::fs::File::open(&path) else { continue };
            if file.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut reader = BufReader::new(file);
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                if !line.ends_with('\n') {
                    break;
                }
                offset += line.len() as u64;
                run(&app, line.trim());
                line.clear();
            }
        }
    });
}

fn run(app: &AppHandle, command: &str) {
    eprintln!("[devctl] > {}", command.chars().take(160).collect::<String>());
    let mut words = command.splitn(3, ' ');
    let result: Result<(), String> = match (words.next(), words.next(), words.next()) {
        (Some("open"), Some("panel"), _) => {
            // Under the tray icon when it can say where that is; the top right corner otherwise.
            let rect = app
                .state::<crate::Tray<tauri::Wry>>()
                .0
                .lock()
                .unwrap()
                .as_ref()
                .and_then(|t| t.rect().ok().flatten())
                .unwrap_or(Rect { position: PhysicalPosition::new(1400, 0).into(), size: PhysicalSize::new(24, 24).into() });
            if app.get_webview_window(crate::PANEL).is_some_and(|p| p.is_visible().unwrap_or(false)) {
                Ok(())
            } else {
                let started = std::time::Instant::now();
                let fresh = app.get_webview_window(crate::PANEL).is_none();
                let result = crate::toggle_panel(app, &rect).map_err(|e| e.to_string());
                eprintln!("[devctl] panel shown in {:?} ({})", started.elapsed(), if fresh { "new web view" } else { "kept" });
                result
            }
        }
        (Some("close"), Some(label), _) => match app.get_webview_window(label) {
            Some(window) => window.destroy().map_err(|e| e.to_string()),
            None => Err(format!("no window {label}")),
        },
        (Some("hide"), Some("panel"), _) => {
            crate::hide(app);
            Ok(())
        }
        (Some("open"), Some("settings"), _) => crate::show_settings(app).map_err(|e| e.to_string()),
        (Some("open"), Some("setup"), _) => crate::show_setup(app).map_err(|e| e.to_string()),
        (Some("open"), Some("review"), Some(rest)) => {
            let parts: Vec<&str> = rest.split(' ').collect();
            match parts.as_slice() {
                [id, repo, number] => crate::open_review(app.clone(), id.to_string(), repo.to_string(), number.parse().unwrap_or(0), format!("#{number}"), vec![]),
                _ => Err("open review <id> <owner/name> <number>".into()),
            }
        }
        (Some("eval"), Some(label), Some(js)) => match app.get_webview_window(label) {
            Some(window) => window.eval(js).map_err(|e| e.to_string()),
            None => Err(format!("no window {label}")),
        },
        (Some("refresh"), force, _) => {
            app.state::<crate::watch::Watch>().send(crate::watch::Message::Refresh { force: force == Some("force") });
            Ok(())
        }
        (Some("forget"), Some(n), _) => {
            let titles = app.state::<crate::watch::Watch>().forget(n.parse().unwrap_or(1));
            eprintln!("[devctl] forgot: {}", titles.join(" ; "));
            Ok(())
        }
        (Some("windows"), _, _) => {
            let labels: Vec<String> = app.webview_windows().into_iter().map(|(label, w)| format!("{label}{}", if w.is_visible().unwrap_or(false) { "" } else { " (hidden)" })).collect();
            eprintln!("[devctl] windows: {}", labels.join(", "));
            Ok(())
        }
        _ => Err("unknown command".into()),
    };
    if let Err(e) = result {
        eprintln!("[devctl] error: {e}");
    }
}
