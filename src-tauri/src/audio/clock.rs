//! The host clock that lines the microphone up with the output tap. Both
//! streams' callbacks carry device times on it (mach absolute time on macOS,
//! QueryPerformanceCounter on Windows). Some Windows devices report a stale or
//! zero time (the remote desktop's audio did): the tap then lands seconds away
//! from the recording and the take looks as if the original never played. On
//! Windows a device time is checked against the counter itself.

/// Host time in ns of a cpal instant.
pub fn host_nanos(t: &cpal::StreamInstant) -> u64 {
    t.duration_since(&cpal::StreamInstant::new(0, 0))
        .map_or(0, |d| d.as_nanos() as u64)
}

/// The host clock now, in `host_nanos` units. None where device times are trusted as they are.
#[cfg(windows)]
pub fn host_now() -> Option<u64> {
    use windows_sys::Win32::System::Performance::{
        QueryPerformanceCounter, QueryPerformanceFrequency,
    };
    let (mut count, mut freq) = (0i64, 0i64);
    // SAFETY: both arguments are plain out-pointers to locals.
    let ok = unsafe {
        QueryPerformanceCounter(&mut count) != 0 && QueryPerformanceFrequency(&mut freq) != 0
    };
    (ok && freq > 0).then(|| (count as i128 * 1_000_000_000 / freq as i128) as u64)
}

#[cfg(not(windows))]
pub fn host_now() -> Option<u64> {
    None
}

/// Further than this from the host clock, a device time is wrong rather than late.
const OFF_NS: u64 = 1_000_000_000;

/// `reported`, unless it is missing or more than a second from `expected` (what the
/// host clock says it should be); then `expected`.
pub fn trusted(reported: u64, expected: Option<u64>) -> u64 {
    match expected {
        Some(e) if reported == 0 || reported.abs_diff(e) > OFF_NS => e.max(1),
        _ => reported,
    }
}

/// Seconds as ns.
pub fn ns(secs: f64) -> u64 {
    (secs.max(0.0) * 1e9) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_times_are_kept_unless_missing_or_far_off() {
        let now = 5_000_000_000_000;
        // Close to the host clock (a device's own latency estimate): kept.
        assert_eq!(trusted(now + 40_000_000, Some(now)), now + 40_000_000);
        assert_eq!(trusted(now - 900_000_000, Some(now)), now - 900_000_000);
        // Zero or stale by seconds: the host clock instead.
        assert_eq!(trusted(0, Some(now)), now);
        assert_eq!(trusted(now - 30_000_000_000, Some(now)), now);
        assert_eq!(trusted(now + 2_000_000_000, Some(now)), now);
        // No host clock to compare with (macOS): always the device's.
        assert_eq!(trusted(0, None), 0);
        assert_eq!(trusted(123, None), 123);
    }

    #[test]
    fn seconds_to_nanoseconds() {
        assert_eq!(ns(0.25), 250_000_000);
        assert_eq!(ns(-1.0), 0);
    }
}
