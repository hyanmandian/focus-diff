//! The menu bar / system tray icon: Focus Diff's focus brackets around two diff lines, drawn here
//! rather than shipped as images so every frame of the attention animation is exact at any scale.
//!
//! On macOS it's a template image (black + alpha), which the system tints for light and dark menu
//! bars. Elsewhere trays don't tint, so it's drawn in Focus Diff's green.

use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use tauri::image::Image;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Runtime};

const SIZE: u32 = 36; // 18pt at 2x, the menu bar's icon size
const SUPERSAMPLE: u32 = 4;

#[cfg(target_os = "macos")]
const INK: [u8; 3] = [0, 0, 0];
#[cfg(not(target_os = "macos"))]
const INK: [u8; 3] = [46, 160, 67];

/// Coverage of a rounded rectangle (x0, y0)-(x1, y1) with corner radius r at sample point (x, y).
fn in_round_rect(x: f32, y: f32, x0: f32, y0: f32, x1: f32, y1: f32, r: f32) -> bool {
    if x < x0 || x > x1 || y < y0 || y > y1 {
        return false;
    }
    let cx = x.clamp(x0 + r, x1 - r);
    let cy = y.clamp(y0 + r, y1 - r);
    (x - cx).powi(2) + (y - cy).powi(2) <= r * r
}

/// One frame. `focus` 0..1 pulls the brackets in (0 at rest, 1 fully focused); `dot` adds the
/// unread mark in the top right corner.
pub fn frame(focus: f32, dot: bool) -> Image<'static> {
    let s = SIZE as f32;
    let stroke = 3.0;
    let arm = 8.0;
    // The brackets sit at the edges at rest and close in as they focus.
    let inset = 3.0 + 4.0 * focus;
    let (lo, hi) = (inset, s - inset);
    let mut shapes: Vec<(f32, f32, f32, f32, f32)> = Vec::new();
    for (cx, dx) in [(lo, 1.0), (hi, -1.0)] {
        for (cy, dy) in [(lo, 1.0), (hi, -1.0)] {
            // With something unread, the top right corner becomes the dot.
            if dot && dx < 0.0 && dy > 0.0 {
                continue;
            }
            let (hx0, hx1) = if dx > 0.0 { (cx, cx + arm) } else { (cx - arm, cx) };
            let (vy0, vy1) = if dy > 0.0 { (cy, cy + arm) } else { (cy - arm, cy) };
            let (hy0, hy1) = if dy > 0.0 { (cy, cy + stroke) } else { (cy - stroke, cy) };
            let (vx0, vx1) = if dx > 0.0 { (cx, cx + stroke) } else { (cx - stroke, cx) };
            shapes.push((hx0, hy0, hx1, hy1, 1.2));
            shapes.push((vx0, vy0, vx1, vy1, 1.2));
        }
    }
    // Two diff lines, the second shorter.
    shapes.push((11.0, 13.5, 25.0, 16.5, 1.5));
    shapes.push((11.0, 19.5, 21.0, 22.5, 1.5));

    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let n = SUPERSAMPLE * SUPERSAMPLE;
    for py in 0..SIZE {
        for px in 0..SIZE {
            let mut hits = 0u32;
            for sy in 0..SUPERSAMPLE {
                for sx in 0..SUPERSAMPLE {
                    let x = px as f32 + (sx as f32 + 0.5) / SUPERSAMPLE as f32;
                    let y = py as f32 + (sy as f32 + 0.5) / SUPERSAMPLE as f32;
                    let mut inside = shapes.iter().any(|&(x0, y0, x1, y1, r)| in_round_rect(x, y, x0, y0, x1, y1, r));
                    if dot && !inside {
                        let (dx, dy) = (x - (hi - 4.0), y - (lo + 4.0));
                        inside = dx * dx + dy * dy <= 4.5 * 4.5;
                    }
                    hits += inside as u32;
                }
            }
            let i = ((py * SIZE + px) * 4) as usize;
            rgba[i..i + 3].copy_from_slice(&INK);
            rgba[i + 3] = ((hits * 255) / n) as u8;
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

/// Bumped by every new animation, so an older one still running stops drawing.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Shows how many pull requests wait on you, and, when something new came in, plays the focus
/// animation: the brackets close in on the lines three times, then rest with the unread dot.
pub fn update<R: Runtime>(app: &AppHandle<R>, tray: &TrayIcon<R>, count: u32, animate: bool) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let dot = count > 0;
    let tooltip = match count {
        0 => "Focus Diff Pro: nothing waiting on you".to_string(),
        1 => "Focus Diff Pro: 1 pull request waiting on you".to_string(),
        n => format!("Focus Diff Pro: {n} pull requests waiting on you"),
    };
    let _ = tray.set_tooltip(Some(&tooltip));
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(if dot { Some(count.to_string()) } else { None });
    let rest = frame(0.0, dot);
    if !animate {
        let _ = tray.set_icon(Some(rest));
        return;
    }
    let tray = tray.clone();
    let app = app.clone();
    thread::spawn(move || {
        const FRAMES: u32 = 18; // one close-in-and-out, at 30 fps
        for _ in 0..3 {
            for f in 0..=FRAMES {
                if GENERATION.load(Ordering::SeqCst) != generation {
                    return;
                }
                // Ease in and out: sin² over the cycle.
                let t = (std::f32::consts::PI * f as f32 / FRAMES as f32).sin().powi(2);
                let image = frame(t, dot);
                let tray = tray.clone();
                let _ = app.run_on_main_thread(move || {
                    let _ = tray.set_icon(Some(image));
                });
                thread::sleep(Duration::from_millis(33));
            }
            thread::sleep(Duration::from_millis(120));
        }
        let _ = app.run_on_main_thread(move || {
            let _ = tray.set_icon(Some(rest));
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes the rest frame, mid-focus and the unread frame as BMPs into $TRAY_PREVIEW_DIR, to
    /// look at the icon's drawing. Skipped when the variable isn't set.
    #[test]
    fn preview_frames() {
        let Ok(dir) = std::env::var("TRAY_PREVIEW_DIR") else { return };
        for (name, image) in [("rest", frame(0.0, false)), ("focus", frame(1.0, false)), ("unread", frame(0.0, true))] {
            let (w, h) = (image.width(), image.height());
            let mut bmp = Vec::new();
            let size = 54 + w * h * 4;
            bmp.extend_from_slice(b"BM");
            bmp.extend_from_slice(&size.to_le_bytes());
            bmp.extend_from_slice(&[0; 4]);
            bmp.extend_from_slice(&54u32.to_le_bytes());
            bmp.extend_from_slice(&40u32.to_le_bytes());
            bmp.extend_from_slice(&(w as i32).to_le_bytes());
            bmp.extend_from_slice(&(-(h as i32)).to_le_bytes());
            bmp.extend_from_slice(&1u16.to_le_bytes());
            bmp.extend_from_slice(&32u16.to_le_bytes());
            bmp.extend_from_slice(&[0; 24]);
            // On white, as a light menu bar shows it: blend the ink over white.
            for px in image.rgba().chunks(4) {
                let a = px[3] as u32;
                let blend = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
                bmp.extend_from_slice(&[blend(px[2]), blend(px[1]), blend(px[0]), 255]);
            }
            std::fs::write(format!("{dir}/tray-{name}.bmp"), bmp).unwrap();
        }
    }
}
