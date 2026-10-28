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

static ORIGINAL: Mutex<Option<&'static AnyClass>> = Mutex::new(None);

pub unsafe fn make(window: &NSWindow) {
    let object: &AnyObject = window;
    let original = object.class();
    if original == Floating::class() {
        return;
    }
    if NSPanel::class().instance_size() != NSWindow::class().instance_size()
        || Floating::class().instance_size() != NSWindow::class().instance_size()
        || original.instance_size() < NSWindow::class().instance_size()
    {
        return;
    }
    // SAFETY: as above. objc2's set_class insists on equal sizes, which tao's extra state rules
    unsafe { objc2::ffi::object_setClass(object as *const AnyObject as *mut AnyObject, Floating::class()) };
    *ORIGINAL.held() = Some(original);
    window.setStyleMask(window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    // SAFETY: it's an NSPanel now.
    let panel = unsafe { &*(window as *const NSWindow as *const NSPanel) };
    panel.setFloatingPanel(true);
    panel.setHidesOnDeactivate(false);
    window.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
}

pub fn show(window: &NSWindow) {
    window.makeKeyAndOrderFront(None);
}

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
