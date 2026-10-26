//! About Focus Diff: the standard About panel, with what the app is, where to find it and the
//! open-source software it's built on as its credits, in the system's own text colours (a plain
//! string there draws black, unreadable in Dark Mode).

use tauri::{AppHandle, Runtime};

use crate::i18n::tr;

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let version = app.package_info().version.to_string();
    let _ = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        mac::show(&version);
        #[cfg(not(target_os = "macos"))]
        let _ = version;
    });
}

/// The credits, a paragraph to a line; the website's address is made a link.
fn credits() -> String {
    [
        tr!("Code review without opening GitHub.", "Code review sem abrir o GitHub."),
        WEBSITE.to_string(),
        tr!("Built with open-source software:", "Feito com software de código aberto:"),
        "Tauri (MIT or Apache-2.0) · React (MIT)\n@pierre/diffs (Apache-2.0) · Mermaid (MIT)\nBase UI and shadcn/ui (MIT) · Lucide (ISC)".to_string(),
    ]
    .join("\n\n")
}

const WEBSITE: &str = "focus-diff.com";

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSAboutPanelOptionApplicationVersion, NSAboutPanelOptionCredits, NSAboutPanelOptionVersion, NSApplication, NSColor, NSFont, NSFontAttributeName, NSForegroundColorAttributeName,
        NSLinkAttributeName, NSMutableParagraphStyle, NSParagraphStyleAttributeName, NSTextAlignment,
    };
    use objc2_foundation::{NSDictionary, NSMutableAttributedString, NSRange, NSString, NSURL};

    use super::{credits, WEBSITE};

    pub fn show(version: &str) {
        let Some(main) = MainThreadMarker::new() else { return };
        let text = credits();
        let ns_text = NSString::from_str(&text);
        let credits = NSMutableAttributedString::from_nsstring(&ns_text);
        let all = NSRange::new(0, ns_text.length());
        let paragraph = NSMutableParagraphStyle::new();
        paragraph.setAlignment(NSTextAlignment::Center);
        // SAFETY: AppKit's attribute names, each given a value of the type it takes.
        unsafe {
            credits.addAttribute_value_range(NSForegroundColorAttributeName, &NSColor::secondaryLabelColor(), all);
            credits.addAttribute_value_range(NSFontAttributeName, &NSFont::systemFontOfSize(NSFont::smallSystemFontSize()), all);
            credits.addAttribute_value_range(NSParagraphStyleAttributeName, &paragraph, all);
            let at = text.find(WEBSITE).map(|i| text[..i].encode_utf16().count()).unwrap_or(0);
            if let Some(url) = NSURL::URLWithString(&NSString::from_str(&format!("https://{WEBSITE}"))) {
                credits.addAttribute_value_range(NSLinkAttributeName, &url, NSRange::new(at, WEBSITE.encode_utf16().count()));
            }
        }
        // "Version 0.1.0", not "Version 0.1.0 (0.1.0)": an empty build number isn't shown.
        let keys: [&NSString; 3] = unsafe { [NSAboutPanelOptionApplicationVersion, NSAboutPanelOptionVersion, NSAboutPanelOptionCredits] };
        let values: [Retained<AnyObject>; 3] = [
            Retained::into_super(Retained::into_super(NSString::from_str(version))),
            Retained::into_super(Retained::into_super(NSString::from_str(""))),
            Retained::into_super(Retained::into_super(Retained::into_super(credits))),
        ];
        let options = NSDictionary::from_retained_objects(&keys, &values);
        let app = NSApplication::sharedApplication(main);
        // SAFETY: the keys are AppKit's About panel options, each with a value of the type it takes.
        unsafe { app.orderFrontStandardAboutPanelWithOptions(&options) };
        app.activate();
    }
}
