//! Notifications on macOS through the system's own framework (UserNotifications). The notification
//! plugin goes through NSUserNotificationCenter there, which recent macOS versions accept and then
//! drop without a word: nothing ever reached Notification Center. Elsewhere the plugin is used.
//! UserNotifications works only from inside an app bundle (the center needs its identifier), so a
//! bare binary, as `cargo run` makes, shows nothing and says so on stderr.

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_user_notifications::{UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationRequest, UNNotificationSound, UNUserNotificationCenter};
use std::sync::atomic::{AtomicU64, Ordering};

/// Whether this runs from an app bundle, the only place the center can be asked for.
fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

/// Asks once to show notifications (the system asks the person the first time, and remembers).
pub fn ask() {
    if !bundled() {
        eprintln!("[notify] not in an app bundle: notifications are off");
        return;
    }
    let done = RcBlock::new(|granted: Bool, _error: *mut NSError| {
        if !granted.as_bool() {
            eprintln!("[notify] notifications aren't allowed in System Settings");
        }
    });
    UNUserNotificationCenter::currentNotificationCenter().requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound, &done);
}

/// Shows a notification now, with the system's sound when `sound`.
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
    // Each its own, so none replaces another still on screen.
    let id = NSString::from_str(&format!("focus-diff-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
    UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, None);
}
