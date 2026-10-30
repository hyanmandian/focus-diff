use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect};
use crate::sync::Locked;

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
            let rect = app
                .state::<crate::Tray>()
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
                let handle = app.clone();
                app.run_on_main_thread(move || {
                    let result = crate::toggle_panel(&handle, &rect);
                    eprintln!("[devctl] panel shown in {:?} ({}) {result:?}", started.elapsed(), if fresh { "new web view" } else { "kept" });
                })
                .map_err(|e| e.to_string())
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
                [id, repo, number] => crate::show_review(app.clone(), id.to_string(), repo.to_string(), number.parse().unwrap_or(0), format!("#{number}"), vec![], None, None),
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
        (Some("focus"), _, _) => {
            let panel = app.get_webview_window(crate::PANEL);
            app.run_on_main_thread(move || {
                let key = panel.as_ref().map(|p| p.is_focused().unwrap_or(false));
                #[cfg(target_os = "macos")]
                let responder = panel.as_ref().and_then(|p| p.ns_window().ok()).and_then(|pointer| {
                    // SAFETY: Tauri's live NSWindow, on the main thread.
                    let ns = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
                    ns.firstResponder().map(|r| r.class().name().to_string_lossy().into_owned())
                });
                #[cfg(not(target_os = "macos"))]
                let responder: Option<String> = None;
                eprintln!("[devctl] focus: app active {}, panel key {key:?}, first responder {responder:?}", crate::is_active());
            })
            .map_err(|e| e.to_string())
        }
        (Some("tray"), _, _) => {
            let rect = app.state::<crate::Tray>().0.held().as_ref().and_then(|t| t.rect().ok().flatten());
            eprintln!("[devctl] tray: {rect:?}");
            Ok(())
        }
        #[cfg(target_os = "macos")]
        (Some("lights"), Some(label), _) => match app.get_webview_window(label) {
            Some(window) => app
                .run_on_main_thread(move || {
                    use objc2_app_kit::{NSWindow, NSWindowButton};
                    let Ok(pointer) = window.ns_window() else { return };
                    // SAFETY: Tauri's live NSWindow, on the main thread.
                    let window = unsafe { &*(pointer as *const NSWindow) };
                    let height = window.frame().size.height;
                    if let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) {
                        let frame = close.convertRect_toView(close.bounds(), None);
                        eprintln!("[devctl] lights: close top {} height {} center {} (window {height})", height - frame.origin.y - frame.size.height, frame.size.height, height - frame.origin.y - frame.size.height / 2.0);
                        let zoom = window.standardWindowButton(NSWindowButton::ZoomButton).map(|z| z.convertRect_toView(z.bounds(), None));
                        eprintln!("[devctl] lights: close left {} zoom right {:?}", frame.origin.x, zoom.map(|z| z.origin.x + z.size.width));
                    }
                })
                .map_err(|e| e.to_string()),
            None => Err(format!("no window {label}")),
        },
        #[cfg(target_os = "macos")]
        (Some("hit"), Some(label), Some(at)) => match (app.get_webview_window(label), at.split_once(' ')) {
            (Some(window), Some((x, y))) => {
                let (x, y): (f64, f64) = (x.parse().unwrap_or(0.0), y.parse().unwrap_or(0.0));
                app.run_on_main_thread(move || {
                    use objc2_app_kit::NSWindow;
                    let Ok(pointer) = window.ns_window() else { return };
                    // SAFETY: Tauri's live NSWindow, on the main thread.
                    let ns = unsafe { &*(pointer as *const NSWindow) };
                    let Some(frame_view) = ns.contentView().and_then(|v| unsafe { v.superview() }) else { return };
                    let height = ns.frame().size.height;
                    let hit = frame_view.hitTest(objc2_foundation::NSPoint::new(x, height - y));
                    eprintln!("[devctl] hit: {:?}", hit.map(|v| v.class().name().to_string_lossy().into_owned()));
                })
                .map_err(|e| e.to_string())
            }
            _ => Err("hit <label> <x> <y>".into()),
        },
        (Some("props"), Some(label), _) => match app.get_webview_window(label) {
            Some(w) => {
                eprintln!(
                    "[devctl] props {label}: resizable={} maximizable={} minimizable={} decorated={} on_top={}",
                    w.is_resizable().unwrap_or(false),
                    w.is_maximizable().unwrap_or(false),
                    w.is_minimizable().unwrap_or(false),
                    w.is_decorated().unwrap_or(false),
                    w.is_always_on_top().unwrap_or(false)
                );
                Ok(())
            }
            None => Err(format!("no window {label}")),
        },
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
