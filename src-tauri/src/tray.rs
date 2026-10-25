//! The menu bar / system tray icon: Focus Diff's magnifying glass in focus brackets, drawn here
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

/// Distance from (x, y) to the segment a–b.
fn to_segment(x: f32, y: f32, (ax, ay): (f32, f32), (bx, by): (f32, f32)) -> f32 {
    let (dx, dy) = (bx - ax, by - ay);
    let t = (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy).max(f32::EPSILON)).clamp(0.0, 1.0);
    ((x - ax - t * dx).powi(2) + (y - ay - t * dy).powi(2)).sqrt()
}

/// One frame: a magnifying glass inside focus brackets, like Focus Diff's logo. `focus` 0..1 pulls
/// the brackets in on the glass (0 at rest, 1 fully focused); `dot` puts the unread mark in the top
/// right corner, in place of that bracket.
pub fn frame(focus: f32, dot: bool) -> Image<'static> {
    let s = SIZE as f32;
    let half = 1.6; // half the stroke: 3.2px at 2x, a little over the menu bar's 1.5pt
    // The brackets sit near the edges at rest and close in as they focus.
    let lo = 4.5 + 3.5 * focus;
    let hi = s - lo;
    let arm = 7.0;
    let mut strokes: Vec<((f32, f32), (f32, f32))> = Vec::new();
    for (cx, dx) in [(lo, 1.0), (hi, -1.0)] {
        for (cy, dy) in [(lo, 1.0), (hi, -1.0)] {
            if dot && dx < 0.0 && dy > 0.0 {
                continue;
            }
            strokes.push(((cx, cy), (cx + dx * arm, cy)));
            strokes.push(((cx, cy), (cx, cy + dy * arm)));
        }
    }
    // The glass: a ring and its handle, centered a little up and left so the whole sits centered.
    let (gx, gy, radius) = (16.6, 16.6, 5.4);
    strokes.push(((gx + 4.6, gy + 4.6), (24.2, 24.2)));

    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let n = SUPERSAMPLE * SUPERSAMPLE;
    for py in 0..SIZE {
        for px in 0..SIZE {
            let mut hits = 0u32;
            for sy in 0..SUPERSAMPLE {
                for sx in 0..SUPERSAMPLE {
                    let x = px as f32 + (sx as f32 + 0.5) / SUPERSAMPLE as f32;
                    let y = py as f32 + (sy as f32 + 0.5) / SUPERSAMPLE as f32;
                    let ring = (((x - gx).powi(2) + (y - gy).powi(2)).sqrt() - radius).abs() <= half;
                    let line = strokes.iter().any(|&(a, b)| to_segment(x, y, a, b) <= half);
                    let mark = dot && (x - (s - 7.0)).powi(2) + (y - 7.0).powi(2) <= 4.6 * 4.6;
                    hits += (ring || line || mark) as u32;
                }
            }
            let i = ((py * SIZE + px) * 4) as usize;
            rgba[i..i + 3].copy_from_slice(&INK);
            rgba[i + 3] = ((hits * 255) / n) as u8;
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

/// Sets a frame. On macOS replacing the image drops its template flag, which leaves it black on a
/// dark menu bar, so it's set again each time.
fn show<R: Runtime>(tray: &TrayIcon<R>, image: Image<'static>) {
    let _ = tray.set_icon(Some(image));
    #[cfg(target_os = "macos")]
    let _ = tray.set_icon_as_template(true);
}

/// Bumped by every new animation, so an older one still running stops drawing.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Shows how many pull requests wait on you, and, when something new came in, plays the focus
/// animation: the brackets close in on the lines three times, then rest with the unread dot.
pub fn update<R: Runtime>(app: &AppHandle<R>, tray: &TrayIcon<R>, count: u32, animate: bool) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let dot = count > 0;
    let tooltip = match count {
        0 => "Focus Diff: nothing waiting on you".to_string(),
        1 => "Focus Diff: 1 pull request waiting on you".to_string(),
        n => format!("Focus Diff: {n} pull requests waiting on you"),
    };
    let _ = tray.set_tooltip(Some(&tooltip));
    // No number beside it: the dot says there's something, the panel says what (a count of every
    // unread pull request in every queue is noise in a menu bar).
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(None::<&str>);
    let rest = frame(0.0, dot);
    if !animate {
        show(tray, rest);
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
                    show(&tray, image);
                });
                thread::sleep(Duration::from_millis(33));
            }
            thread::sleep(Duration::from_millis(120));
        }
        let _ = app.run_on_main_thread(move || {
            show(&tray, rest);
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
