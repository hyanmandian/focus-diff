use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

pub(crate) trait Locked<T> {
    fn held(&self) -> MutexGuard<'_, T>;
}

impl<T> Locked<T> for Mutex<T> {
    fn held(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) fn back_off<T>(wake: &Condvar, held: MutexGuard<'_, T>, failures: u32, longest: Duration, woken: impl Fn(&T) -> bool) {
    if failures == 0 || woken(&held) {
        return;
    }
    let wait = Duration::from_secs(1 << (failures.min(6) - 1)).min(longest);
    drop(wake.wait_timeout_while(held, wait, |q| !woken(q)).unwrap_or_else(PoisonError::into_inner));
}

#[cfg(test)]
mod tests {
    use super::{back_off, Locked};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    #[test]
    fn a_lock_poisoned_by_a_panic_still_opens() {
        let lock = Arc::new(Mutex::new(1));
        let shared = lock.clone();
        let _ = std::thread::spawn(move || {
            let _guard = shared.held();
            panic!("while holding it");
        })
        .join();
        assert!(lock.is_poisoned());
        *lock.held() += 1;
        assert_eq!(*lock.held(), 2);
    }

    #[test]
    fn backs_off_only_after_a_failure_and_until_woken() {
        let (lock, wake) = (Mutex::new(false), Condvar::new());
        let started = Instant::now();
        back_off(&wake, lock.held(), 0, Duration::from_secs(5), |woken| *woken);
        *lock.held() = true;
        back_off(&wake, lock.held(), 3, Duration::from_secs(5), |woken| *woken);
        assert!(started.elapsed() < Duration::from_secs(1));
        *lock.held() = false;
        back_off(&wake, lock.held(), 3, Duration::from_millis(30), |woken| *woken);
        assert!(started.elapsed() >= Duration::from_millis(30));
    }
}
