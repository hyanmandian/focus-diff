//! The menu bar / system tray icon. On macOS it's the system's own SF Symbol for reading text
//! under a magnifying glass, drawn by AppKit, so it has the weight and shape of the menu bar's
//! other icons. Elsewhere (and if the symbol were missing) it's drawn here: a rounded square with
//! the glass cut out.
//!
//! On macOS it's a template image (black + alpha), which the system tints for light and dark menu
//! bars. Elsewhere trays don't tint, so it's drawn in Focus Diff's green.

use std::sync::{Mutex, OnceLock};
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

/// How many sizes the glass grows through in the attention animation.
const STEPS: usize = 8;

/// The symbol's coverage (alpha) at each step of the animation, rendered once.
static SYMBOL: OnceLock<Option<Vec<Vec<u8>>>> = OnceLock::new();

/// Renders the symbol's frames. On the main thread, at startup: AppKit draws them.
pub fn prepare() {
    SYMBOL.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            (0..=STEPS).map(|i| symbol::render(15.0 + 2.0 * i as f64 / STEPS as f64)).collect()
        }
        #[cfg(not(target_os = "macos"))]
        None
    });
}

#[cfg(target_os = "macos")]
mod symbol {
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageRep, NSDeviceRGBColorSpace, NSFontWeightRegular, NSGraphicsContext, NSImage, NSImageSymbolConfiguration};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

    use super::SIZE;

    /// The symbol at `points`, centered in an 18pt square, as alpha at 2x.
    pub fn render(points: f64) -> Option<Vec<u8>> {
        let px = SIZE as isize;
        let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str("text.magnifyingglass"), None)?;
        let image = image.imageWithSymbolConfiguration(&NSImageSymbolConfiguration::configurationWithPointSize_weight(points, unsafe { NSFontWeightRegular }))?;
        // SAFETY: a null planes pointer makes the rep allocate its own buffer.
        let rep = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(),
                std::ptr::null_mut(),
                px,
                px,
                8,
                4,
                true,
                false,
                NSDeviceRGBColorSpace,
                0,
                32,
            )
        }?;
        rep.setSize(NSSize::new(18.0, 18.0));
        let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        let size = image.size();
        image.drawInRect(NSRect::new(NSPoint::new((18.0 - size.width) / 2.0, (18.0 - size.height) / 2.0), size));
        context.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();
        let (row, data) = (rep.bytesPerRow() as usize, rep.bitmapData());
        if data.is_null() {
            return None;
        }
        let side = SIZE as usize;
        // SAFETY: the rep's buffer is bytesPerRow × height, 4 bytes a pixel, alpha last.
        Some((0..side * side).map(|i| unsafe { *data.add((i / side) * row + (i % side) * 4 + 3) }).collect())
    }
}

/// One frame. `focus` 0..1 is how far into the attention animation (0 at rest); `dot` adds the
/// unread badge on the top right corner, with a gap cut around it.
pub fn frame(focus: f32, dot: bool) -> Image<'static> {
    let Some(Some(steps)) = SYMBOL.get() else { return drawn(focus, dot) };
    let Some(alpha) = steps.get((focus.clamp(0.0, 1.0) * STEPS as f32).round() as usize) else { return drawn(focus, dot) };
    let scale = SIZE as f32 / 18.0;
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    for (i, &a) in alpha.iter().enumerate() {
        let (px, py) = ((i as u32 % SIZE) as f32, (i as u32 / SIZE) as f32);
        let a = if dot {
            // How much of the pixel the badge, and the gap around it, cover.
            let cover = |r: f32| {
                let mut hits = 0;
                for s in 0..SUPERSAMPLE * SUPERSAMPLE {
                    let x = (px + ((s % SUPERSAMPLE) as f32 + 0.5) / SUPERSAMPLE as f32) / scale;
                    let y = (py + ((s / SUPERSAMPLE) as f32 + 0.5) / SUPERSAMPLE as f32) / scale;
                    hits += ((x - 15.0).powi(2) + (y - 3.0).powi(2) <= r * r) as u32;
                }
                hits as f32 / (SUPERSAMPLE * SUPERSAMPLE) as f32
            };
            (cover(2.6) * 255.0).max(a as f32 * (1.0 - cover(4.1))) as u8
        } else {
            a
        };
        rgba[i * 4..i * 4 + 3].copy_from_slice(&INK);
        rgba[i * 4 + 3] = a;
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

/// The drawn fallback, on an 18-point grid: a filled rounded square (the app icon's shape) with
/// the magnifying glass cut out.
fn drawn(focus: f32, dot: bool) -> Image<'static> {
    let scale = SIZE as f32 / 18.0;
    let zoom = 1.0 + 0.14 * focus;
    // The glass, around the square's center, so zooming keeps it in place.
    let at = |v: f32| 9.0 + (v - 9.0) * zoom;
    let (gx, gy, ring, rim) = (at(8.0), at(8.0), 3.4 * zoom, 0.95 * zoom);
    let handle = ((at(10.6), at(10.6)), (at(13.5), at(13.5)), 1.15 * zoom);
    let badge = (15.0, 3.0);

    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let n = SUPERSAMPLE * SUPERSAMPLE;
    for py in 0..SIZE {
        for px in 0..SIZE {
            let mut hits = 0u32;
            for sy in 0..SUPERSAMPLE {
                for sx in 0..SUPERSAMPLE {
                    let x = (px as f32 + (sx as f32 + 0.5) / SUPERSAMPLE as f32) / scale;
                    let y = (py as f32 + (sy as f32 + 0.5) / SUPERSAMPLE as f32) / scale;
                    // The square: 16pt with 4.5pt corners.
                    let (qx, qy) = ((x - 9.0).abs() - 3.5, (y - 9.0).abs() - 3.5);
                    let square = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) <= 4.5;
                    let glass = (((x - gx).powi(2) + (y - gy).powi(2)).sqrt() - ring).abs() <= rim || to_segment(x, y, handle.0, handle.1) <= handle.2;
                    let near = |r: f32| (x - badge.0).powi(2) + (y - badge.1).powi(2) <= r * r;
                    let on = if dot { near(2.6) || (square && !glass && !near(4.1)) } else { square && !glass };
                    hits += on as u32;
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

/// While a review time is under way, the minutes left ("24m"), shown beside the icon.
static COUNTDOWN: Mutex<Option<String>> = Mutex::new(None);

/// What the icon says on hover: the countdown first, while there is one.
fn tooltip(count: u32) -> String {
    let waiting = match count {
        0 => "nothing waiting on you".to_string(),
        1 => "1 pull request waiting on you".to_string(),
        n => format!("{n} pull requests waiting on you"),
    };
    match COUNTDOWN.lock().unwrap().as_deref() {
        Some(left) => format!("Focus Diff: review time, {left} left · {waiting}"),
        None => format!("Focus Diff: {waiting}"),
    }
}

static LAST_COUNT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Shows (or, with None, takes away) review time's countdown beside the icon. Windows has no text
/// beside a tray icon, so there it's in the tooltip only.
pub fn countdown<R: Runtime>(tray: &TrayIcon<R>, text: Option<String>) {
    *COUNTDOWN.lock().unwrap() = text;
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(COUNTDOWN.lock().unwrap().as_deref());
    let _ = tray.set_tooltip(Some(&tooltip(LAST_COUNT.load(Ordering::SeqCst))));
}

/// Bumped by every new animation, so an older one still running stops drawing.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Shows how many pull requests wait on you, and, when something new came in, plays the focus
/// animation: the glass zooms in three times, then rest with the unread dot.
pub fn update<R: Runtime>(app: &AppHandle<R>, tray: &TrayIcon<R>, count: u32, animate: bool) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let dot = count > 0;
    LAST_COUNT.store(count, Ordering::SeqCst);
    let _ = tray.set_tooltip(Some(&tooltip(count)));
    // No number beside it: the dot says there's something, the panel says what (a count of every
    // unread pull request in every queue is noise in a menu bar). Only review time's countdown.
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(COUNTDOWN.lock().unwrap().as_deref());
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
        prepare();
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
