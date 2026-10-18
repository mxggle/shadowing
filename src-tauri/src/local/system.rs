//! What the computer has, for suggesting a model and checking a download fits:
//! the chip's name, memory and free disk space. macOS asks sysctl / statfs,
//! Windows the Win32 calls; elsewhere there are safe defaults.

use std::path::Path;

/// Shown in place of a chip name that can't be read.
fn this_computer() -> String {
    crate::i18n::pick(
        crate::i18n::os("这台 Mac", "这台电脑"),
        crate::i18n::os("This Mac", "This PC"),
    )
    .into()
}

/// The chip's name, like "Apple M2 Pro".
#[cfg(target_os = "macos")]
pub fn chip() -> String {
    let mut buf = [0u8; 128];
    let mut len = buf.len();
    // SAFETY: the buffer and its length match; sysctl writes at most `len` bytes.
    let rc = unsafe {
        libc::sysctlbyname(
            c"machdep.cpu.brand_string".as_ptr(),
            buf.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    let name = if rc == 0 {
        String::from_utf8_lossy(&buf[..len])
            .trim_end_matches('\0')
            .trim()
            .to_string()
    } else {
        String::new()
    };
    if name.is_empty() {
        this_computer()
    } else {
        name
    }
}

/// Local transcription isn't offered here, so the chip is never named.
#[cfg(not(target_os = "macos"))]
pub fn chip() -> String {
    this_computer()
}

/// Physical memory in GB.
#[cfg(target_os = "macos")]
pub fn ram_gb() -> f64 {
    let mut bytes: u64 = 0;
    let mut len = std::mem::size_of::<u64>();
    // SAFETY: hw.memsize is a u64; the buffer and its length match.
    let rc = unsafe {
        libc::sysctlbyname(
            c"hw.memsize".as_ptr(),
            (&mut bytes as *mut u64).cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc == 0 {
        bytes as f64 / 1_073_741_824.0
    } else {
        8.0
    }
}

/// Physical memory in GB.
#[cfg(windows)]
pub fn ram_gb() -> f64 {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: a zeroed MEMORYSTATUSEX with its length set, as the call requires.
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 {
        status.ullTotalPhys as f64 / 1_073_741_824.0
    } else {
        8.0
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn ram_gb() -> f64 {
    8.0
}

/// Free bytes on the volume holding `path` (or its nearest existing parent).
#[cfg(target_os = "macos")]
pub fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let existing = path.ancestors().find(|p| p.exists())?;
    let c = std::ffi::CString::new(existing.as_os_str().as_bytes()).ok()?;
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: valid C string and an out-pointer to a zeroed statfs.
    (unsafe { libc::statfs(c.as_ptr(), &mut st) } == 0).then(|| st.f_bavail * u64::from(st.f_bsize))
}

/// Free bytes on the volume holding `path` (or its nearest existing parent), as far as
/// this user may use them (disk quotas count).
#[cfg(windows)]
pub fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let existing = path.ancestors().find(|p| p.exists())?;
    let wide: Vec<u16> = existing.as_os_str().encode_wide().chain([0]).collect();
    let mut available = 0u64;
    // SAFETY: a NUL-terminated UTF-16 path; the totals we don't need may be null.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0).then_some(available)
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn free_bytes(_path: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_this_machine() {
        assert!(ram_gb() >= 1.0);
        assert!(!chip().is_empty());
        let missing = std::env::temp_dir().join("shadowing-does-not-exist/x");
        if cfg!(any(target_os = "macos", windows)) {
            assert!(free_bytes(&missing).unwrap() > 0);
        }
    }
}
