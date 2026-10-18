//! The link on the clipboard, for ⌘V / Ctrl+V outside a text field and the ＋ menu.
//! macOS: `pbpaste`. Windows: the clipboard's Unicode text, read directly (no
//! program started, so nothing flashes and no code page mangles the text).

/// The clipboard's text when it is one web link.
pub fn link() -> Option<String> {
    as_link(&text()?)
}

#[cfg(not(windows))]
fn text() -> Option<String> {
    let out = std::process::Command::new("/usr/bin/pbpaste")
        .output()
        .ok()?;
    String::from_utf8(out.stdout).ok()
}

#[cfg(windows)]
fn text() -> Option<String> {
    use std::time::Duration;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

    let format = u32::from(CF_UNICODETEXT);
    // SAFETY: plain Win32 calls; the data is only read between GlobalLock and
    // GlobalUnlock, within the size Windows reports, while the clipboard is open.
    unsafe {
        if IsClipboardFormatAvailable(format) == 0 {
            return None;
        }
        // Another program may have it open for a moment.
        let mut open = false;
        for _ in 0..10 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                open = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if !open {
            return None;
        }
        let mut text = None;
        let data = GetClipboardData(format);
        if !data.is_null() {
            let units = GlobalSize(data) / 2;
            let start = GlobalLock(data) as *const u16;
            if !start.is_null() {
                let all = std::slice::from_raw_parts(start, units);
                let end = all.iter().position(|&u| u == 0).unwrap_or(units);
                text = Some(String::from_utf16_lossy(&all[..end]));
                GlobalUnlock(data);
            }
        }
        CloseClipboard();
        text
    }
}

/// One web link and nothing else (a copied paragraph that mentions a link isn't one).
fn as_link(text: &str) -> Option<String> {
    let text = text.trim();
    let link = (text.starts_with("https://") || text.starts_with("http://"))
        && text.len() < 2048
        && !text.contains(char::is_whitespace);
    link.then(|| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::as_link;

    #[test]
    fn only_a_lone_link_counts() {
        let url = "https://youtu.be/FFMoTdeD1aM?si=x";
        assert_eq!(as_link(&format!("  {url}\n")).as_deref(), Some(url));
        // Windows ends copied lines with \r\n.
        assert_eq!(as_link(&format!("{url}\r\n")).as_deref(), Some(url));
        assert_eq!(as_link("see https://youtu.be/x"), None);
        assert_eq!(as_link("https://youtu.be/x and more"), None);
        assert_eq!(as_link("youtu.be/x"), None);
        assert_eq!(as_link(""), None);
    }
}
