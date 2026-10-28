use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread};
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use tauri::AppHandle;

static APP: OnceLock<AppHandle> = OnceLock::new();

fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "FocusDiffNotifications"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(&self, _center: &UNUserNotificationCenter, _notification: &UNNotification, done: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>) {
            done.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(&self, _center: &UNUserNotificationCenter, response: &UNNotificationResponse, done: &DynBlock<dyn Fn()>) {
            if let Some(app) = APP.get() {
                clicked(app, &response.notification().request().identifier().to_string());
            }
            done.call(());
        }
    }
);

impl Delegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        // SAFETY: NSObject's init on a freshly allocated object.
        unsafe { msg_send![super(this), init] }
    }
}

fn identifier(n: u64, url: Option<&str>) -> String {
    format!("focus-diff-{}-{n}|{}", std::process::id(), url.unwrap_or_default())
}

fn link_of(identifier: &str) -> Option<String> {
    let (_, url) = identifier.split_once('|')?;
    crate::link::parse(url).map(|link| link.app_link())
}

fn clicked(app: &AppHandle, identifier: &str) {
    match link_of(identifier) {
        Some(link) => crate::link::open(app, &link),
        None => crate::show_panel(app),
    }
}

pub fn start(app: &AppHandle) {
    if !bundled() {
        eprintln!("[notify] not in an app bundle: notifications are off");
        return;
    }
    let _ = APP.set(app.clone());
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let delegate = Delegate::new();
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    std::mem::forget(delegate);
    let done = RcBlock::new(|granted: Bool, error: *mut NSError| {
        if !granted.as_bool() {
            // SAFETY: the system passes a valid NSError or null, alive for the call.
            let why = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| "turned off in System Settings".into());
            eprintln!("[notify] notifications aren't allowed: {why}");
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound, &done);
}

pub fn show(title: &str, body: &str, sound: bool, url: Option<&str>) {
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
    let id = NSString::from_str(&identifier(NEXT.fetch_add(1, Ordering::Relaxed), url));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
    let done = RcBlock::new(|error: *mut NSError| {
        // SAFETY: the system passes a valid NSError or null, alive for the call.
        if let Some(e) = unsafe { error.as_ref() } {
            eprintln!("[notify] not shown: {}", e.localizedDescription());
        }
    });
    UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, Some(&done));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_notification_carries_its_pull_request() {
        let id = identifier(3, Some("https://github.com/acme/web/pull/7"));
        assert_eq!(link_of(&id).as_deref(), Some("focusdiff://open?url=https%3A%2F%2Fgithub.com%2Facme%2Fweb%2Fpull%2F7"));
        assert_eq!(link_of(&identifier(4, None)), None);
        assert_eq!(link_of("someone-else"), None);
    }
}
