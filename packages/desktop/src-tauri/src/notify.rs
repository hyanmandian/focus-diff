use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_user_notifications::{UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationRequest, UNNotificationSound, UNUserNotificationCenter};
use std::sync::atomic::{AtomicU64, Ordering};

fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

pub fn ask() {
    if !bundled() {
        eprintln!("[notify] not in an app bundle: notifications are off");
        return;
    }
    let done = RcBlock::new(|granted: Bool, error: *mut NSError| {
        if !granted.as_bool() {
            // SAFETY: the system passes a valid NSError or null, alive for the call.
            let why = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| "turned off in System Settings".into());
            eprintln!("[notify] notifications aren't allowed: {why}");
        }
    });
    UNUserNotificationCenter::currentNotificationCenter().requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound, &done);
}

pub fn show(title: &str, body: &str, sound: bool) {
    if !bundled() {
        return;
    }
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    if sound {
        content.setSound(Some(&UNNotificationSound::defaultSound()));
    }
    let id = NSString::from_str(&format!("focus-diff-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
    let done = RcBlock::new(|error: *mut NSError| {
        // SAFETY: the system passes a valid NSError or null, alive for the call.
        if let Some(e) = unsafe { error.as_ref() } {
            eprintln!("[notify] not shown: {}", e.localizedDescription());
        }
    });
    UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, Some(&done));
}
