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

/// One frame, drawn on an 18-point grid like an SF Symbol: a magnifying glass in focus brackets
/// with rounded corners, Focus Diff's logo as a menu bar glyph. `focus` 0..1 pulls the brackets in
/// on the glass (0 at rest, 1 fully focused); `dot` puts the unread mark where the top right
/// bracket is.
pub fn frame(focus: f32, dot: bool) -> Image<'static> {
    let scale = SIZE as f32 / 18.0;
    let stroke = 0.75; // half of a 1.5pt line, the menu bar's weight
    let inset = 0.9 * focus;
    let (lo, hi) = (2.0 + inset, 16.0 - inset);
    let (radius, arm) = (2.0, 3.5); // a bracket's rounded corner, and how far each arm reaches
    // Straight strokes (ends, half width) and quarter circles (center, which quadrant).
    type Line = ((f32, f32), (f32, f32), f32);
    let mut lines: Vec<Line> = Vec::new();
    let mut corners: Vec<(f32, f32, f32, f32)> = Vec::new();
    for (x, dx) in [(lo, 1.0), (hi, -1.0)] {
        for (y, dy) in [(lo, 1.0), (hi, -1.0)] {
            if dot && dx < 0.0 && dy > 0.0 {
                continue;
            }
            let (cx, cy) = (x + dx * radius, y + dy * radius);
            corners.push((cx, cy, -dx, -dy));
            lines.push(((x, cy), (x, y + dy * arm), stroke));
            lines.push(((cx, y), (x + dx * arm, y), stroke));
        }
    }
    // The glass: a ring and a slightly heavier handle.
    let (gx, gy, ring) = (8.25, 8.25, 3.25);
    lines.push(((10.6, 10.6), (13.0, 13.0), 0.875));

    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let n = SUPERSAMPLE * SUPERSAMPLE;
    for py in 0..SIZE {
        for px in 0..SIZE {
            let mut hits = 0u32;
            for sy in 0..SUPERSAMPLE {
                for sx in 0..SUPERSAMPLE {
                    let x = (px as f32 + (sx as f32 + 0.5) / SUPERSAMPLE as f32) / scale;
                    let y = (py as f32 + (sy as f32 + 0.5) / SUPERSAMPLE as f32) / scale;
                    let glass = (((x - gx).powi(2) + (y - gy).powi(2)).sqrt() - ring).abs() <= stroke;
                    let line = lines.iter().any(|&(a, b, half)| to_segment(x, y, a, b) <= half);
                    let corner = corners.iter().any(|&(cx, cy, qx, qy)| {
                        (x - cx) * qx >= 0.0 && (y - cy) * qy >= 0.0 && (((x - cx).powi(2) + (y - cy).powi(2)).sqrt() - radius).abs() <= stroke
                    });
                    let mark = dot && (x - 14.5).powi(2) + (y - 3.5).powi(2) <= 2.4 * 2.4;
                    hits += (glass || line || corner || mark) as u32;
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
