use std::sync::{Mutex, MutexGuard, PoisonError};

pub(crate) trait Locked<T> {
    fn held(&self) -> MutexGuard<'_, T>;
}

impl<T> Locked<T> for Mutex<T> {
    fn held(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::Locked;
    use std::sync::{Arc, Mutex};

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
}
