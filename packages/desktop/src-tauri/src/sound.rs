#![allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_possible_wrap, reason = "sample math on small, bounded numbers")]

use tauri::{AppHandle};

pub const OWN: bool = cfg!(target_os = "macos");

#[cfg(any(target_os = "macos", test))]
const RATE: u32 = 22_050;
#[cfg(any(target_os = "macos", test))]
const SECONDS: f32 = 2.6;

#[cfg(any(target_os = "macos", test))]
pub fn bowl() -> Vec<u8> {
    const NOTE: f32 = 432.0;
    const PARTIALS: [(f32, f32, f32, f32); 4] = [(1.0, 0.5, 2.4, 0.0), (1.0, 0.28, 2.6, 1.3), (2.76, 0.2, 1.3, 0.0), (5.4, 0.07, 0.6, 0.0)];
    const ATTACK: f32 = 0.008;
    let n = (RATE as f32 * SECONDS) as usize;
    let samples: Vec<f32> = (0..n)
        .map(|i| {
            let t = i as f32 / RATE as f32;
            let attack = (t / ATTACK).min(1.0);
            PARTIALS
                .iter()
                .map(|&(ratio, gain, fade, detune)| {
                    let envelope = gain * attack * (-6.9 * t / fade).exp();
                    envelope * (std::f32::consts::TAU * (NOTE * ratio + detune) * t).sin()
                })
                .sum()
        })
        .collect();
    let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs())).max(f32::EPSILON);
    let pcm: Vec<i16> = samples.iter().map(|s| (s / peak * 0.5 * f32::from(i16::MAX)) as i16).collect();

    let data = (pcm.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&(RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data.to_le_bytes());
    for s in pcm {
        wav.extend_from_slice(&s.to_le_bytes());
    }
    wav
}

#[cfg(target_os = "macos")]
thread_local! {
    static SOUND: std::cell::OnceCell<Option<objc2::rc::Retained<objc2_app_kit::NSSound>>> = const { std::cell::OnceCell::new() };
}

pub fn play(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(|| {
        use objc2::AllocAnyThread;
        SOUND.with(|cell| {
            let sound = cell.get_or_init(|| objc2_app_kit::NSSound::initWithData(objc2_app_kit::NSSound::alloc(), &objc2_foundation::NSData::from_vec(bowl())));
            if let Some(sound) = sound {
                sound.stop();
                sound.play();
            }
        });
    });
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_soft_wav() {
        let wav = bowl();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(wav.len(), 44 + (RATE as f32 * SECONDS) as usize * 2);
        let loudest = wav[44..].chunks(2).map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs()).max().unwrap();
        assert!(loudest <= i16::MAX as u16 / 2 + 1, "{loudest}");
        if let Ok(path) = std::env::var("SOUND_PREVIEW") {
            std::fs::write(path, &wav).unwrap();
        }
    }
}
