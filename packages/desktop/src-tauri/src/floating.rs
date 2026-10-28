//! The panel as a menu bar extra's window: a non-activating NSPanel, which takes the keyboard and
//! the pointer's hover without making Focus Diff the active app, as Spotlight's does. macOS turns
//! down activating the app from a click on the tray icon (Tauri hands the click on a moment later,
//! no longer as the click), so a regular window there shows up but stays unfocused until clicked.
//!
//! Tauri makes the window; this changes its class to an NSPanel subclass in place, and back before
//! it's closed so it's torn down as the window Tauri made.

use objc2::runtime::{AnyClass, AnyObject};
use objc2::{define_class, ClassType, MainThreadOnly};
use objc2_app_kit::{NSPanel, NSResponder, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
use objc2_foundation::NSObject;
use std::sync::Mutex;
use crate::sync::Locked;

define_class!(
    #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "FocusDiffFloatingPanel"]
    struct Floating;

    impl Floating {
        // A borderless panel can't take the keyboard unless it says so.
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool {
            false
        }
    }
);

/// The class Tauri gave the window, to put back before it's closed.
static ORIGINAL: Mutex<Option<&'static AnyClass>> = Mutex::new(None);

/// Makes the window a non-activating panel. Only when an NSPanel is laid out like an NSWindow (it
/// adds no fields of its own), so the change can't misread the window's memory.
///
/// # Safety
/// `window` is a live NSWindow made by Tauri; call on the main thread.
pub unsafe fn make(window: &NSWindow) {
    let object: &AnyObject = window;
    let original = object.class();
    if original == Floating::class() {
        return;
    }
    // Tauri's window is tao's NSWindow subclass, which keeps its own state after NSWindow's. NSPanel
    // and Floating add nothing to NSWindow's, so as a Floating everything AppKit reads is where it
    // was, and tao's state stays in place untouched (tao reads it by offset; its overrides are
    // the key/main ones Floating gives, and a drag-by-background the panel doesn't use).
    if NSPanel::class().instance_size() != NSWindow::class().instance_size()
        || Floating::class().instance_size() != NSWindow::class().instance_size()
        || original.instance_size() < NSWindow::class().instance_size()
    {
        return;
    }
    // SAFETY: as above. objc2's set_class insists on equal sizes, which tao's extra state rules
    // out, so the runtime's own call.
    unsafe { objc2::ffi::object_setClass(object as *const AnyObject as *mut AnyObject, Floating::class()) };
    *ORIGINAL.held() = Some(original);
    window.setStyleMask(window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    // SAFETY: it's an NSPanel now.
    let panel = unsafe { &*(window as *const NSWindow as *const NSPanel) };
    panel.setFloatingPanel(true);
    panel.setHidesOnDeactivate(false);
    // Over a full-screen app too, on whichever Space is showing.
    window.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
}

/// Shows the panel with the keyboard, without activating the app.
pub fn show(window: &NSWindow) {
    window.makeKeyAndOrderFront(None);
}

/// Puts back the class Tauri made the window with, before it's closed.
///
/// # Safety
/// As for `make`.
pub unsafe fn unmake(window: &NSWindow) {
    let object: &AnyObject = window;
    if object.class() != Floating::class() {
        return;
    }
    if let Some(original) = ORIGINAL.held().take() {
        // SAFETY: the class it had before `make`, so tao's own dealloc frees its state.
        unsafe { objc2::ffi::object_setClass(object as *const AnyObject as *mut AnyObject, original) };
    }
}
