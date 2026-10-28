use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    En,
    PtBr,
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn current() -> Locale {
    if CURRENT.load(Ordering::Relaxed) == 1 { Locale::PtBr } else { Locale::En }
}

pub fn set(locale: Locale) {
    CURRENT.store(locale as u8, Ordering::Relaxed);
}

pub fn resolve(language: &str, preferred: &[String]) -> Locale {
    match language {
        "en" => return Locale::En,
        "pt-BR" => return Locale::PtBr,
        _ => {}
    }
    for tag in preferred {
        match tag.to_lowercase().split(['-', '_']).next() {
            Some("pt") => return Locale::PtBr,
            Some("en") => return Locale::En,
            _ => {}
        }
    }
    Locale::En
}

#[cfg(target_os = "macos")]
pub fn system_languages() -> Vec<String> {
    objc2_foundation::NSLocale::preferredLanguages().iter().map(|l| l.to_string()).collect()
}

#[cfg(not(target_os = "macos"))]
pub fn system_languages() -> Vec<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"].iter().filter_map(|v| std::env::var(v).ok()).filter(|v| !v.is_empty()).collect()
}

pub fn apply_config(config: &str) {
    let language = serde_json::from_str::<serde_json::Value>(config).ok().and_then(|c| c["language"].as_str().map(String::from)).unwrap_or_default();
    set(resolve(&language, &system_languages()));
}

pub fn one(n: usize) -> bool {
    n == 1
}

macro_rules! tr {
    ($en:literal, $pt:literal $(,)?) => {
        match $crate::i18n::current() {
            $crate::i18n::Locale::En => format!($en),
            $crate::i18n::Locale::PtBr => format!($pt),
        }
    };
}
pub(crate) use tr;

#[cfg(test)]
pub fn in_locale<T>(locale: Locale, f: impl FnOnce() -> T) -> T {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    set(locale);
    let result = f();
    set(Locale::En);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_a_pick_then_the_first_language_spoken() {
        let langs = |l: &[&str]| l.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(resolve("en", &langs(&["pt-BR"])), Locale::En);
        assert_eq!(resolve("system", &langs(&["pt-PT", "en-US"])), Locale::PtBr);
        assert_eq!(resolve("system", &langs(&["fr-FR", "pt_BR.UTF-8"])), Locale::PtBr);
        assert_eq!(resolve("", &langs(&["de", "fr"])), Locale::En);
    }

    #[test]
    fn says_it_in_the_language_in_use() {
        let n = 3;
        assert_eq!(in_locale(Locale::En, || tr!("{n} files", "{n} arquivos")), "3 files");
        assert_eq!(in_locale(Locale::PtBr, || tr!("{n} files", "{n} arquivos")), "3 arquivos");
        assert!(one(1) && !one(0) && !one(2));
    }
}
