//! In-app updates: reads `latest.json` from the newest GitHub Release (endpoint and public key in
//! tauri.conf.json), downloads the signed `Shadowing.app.tar.gz`, swaps it in for the running app and
//! relaunches. On Windows the download is the signed installer, which the updater starts and then
//! quits the app itself. The download is checked against the public key before anything is replaced.
//! Requests go out from Rust like every other one; the webview only calls these commands.
//! The app menu with 检查更新… / 新功能… is macOS only: Windows has no app menu, and Settings has both.

use serde::Serialize;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, State};
#[cfg(target_os = "macos")]
use tauri::{Manager, Wry};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

/// The update found by the last check, kept for `update_install`.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    version: String,
    current: String,
    /// The release's notes (its CHANGELOG section), Markdown.
    notes: Option<String>,
}

/// `update:progress` events while downloading; bytes, `total` None when the server doesn't say.
#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: Option<u64>,
}

#[cfg(target_os = "macos")]
const MENU_CHECK: &str = "update-check";
#[cfg(target_os = "macos")]
const MENU_NEWS: &str = "whats-new";

/// None when this is the newest version, or the newest release has no build for this
/// platform (yet: Windows builds come later than the Mac ones).
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    pending: State<'_, Pending>,
) -> Result<Option<Available>, String> {
    // On Windows the updater ends the process itself once the installer is started, without
    // the exit event: save state.json and the practice log first (the hook replaces the
    // plugin's own, so its cleanup runs here too).
    let handle = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || {
            crate::save_all(&handle);
            handle.cleanup_before_exit();
        })
        .build()
        .map_err(message)?;
    let update = match updater.check().await {
        Err(Error::TargetNotFound(_) | Error::TargetsNotFound(_)) => None,
        checked => checked.map_err(message)?,
    };
    let available = update.as_ref().map(|u| Available {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
    });
    *pending.0.lock().unwrap() = update;
    Ok(available)
}

/// Downloads and installs the update found by `update_check`, then relaunches (state is saved
/// on the way out, as on quit). Only returns on failure.
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if translocated(&std::env::current_exe().map_err(message)?.to_string_lossy()) {
        return Err(crate::i18n::pick(
            "应用是从“下载”文件夹直接打开的，系统不允许它替换自己。请先把 Shadowing 拖进“应用程序”文件夹，从那里打开后再更新。",
            "Shadowing was opened straight from the Downloads folder, where macOS doesn't let it replace itself. Drag Shadowing to the Applications folder, open it from there, and then update.",
        )
        .into());
    }
    let update = pending.0.lock().unwrap().clone().ok_or(crate::i18n::pick(
        "没有可安装的更新，请重新检查",
        "There's no update to install. Check for updates again.",
    ))?;
    let mut done = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                done += chunk as u64;
                let _ = app.emit("update:progress", Progress { done, total });
            },
            || {},
        )
        .await
        .map_err(message)?;
    // Through the exit event, so state.json and the practice log are written first.
    // (Not reached on Windows: the installer has taken over and relaunches the app.)
    app.request_restart();
    Ok(())
}

/// The default menu with “检查更新…” and “新功能…” under the app name; they emit
/// `update:check` and `news:open`.
#[cfg(target_os = "macos")]
pub fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    if let Some(app_menu) = menu.items()?.first().and_then(|i| i.as_submenu().cloned()) {
        // About, —, 检查更新…, 新功能…, —, Services…: in their own group under “About”, as in most Mac apps.
        let check = MenuItem::with_id(app, MENU_CHECK, check_text(), true, None::<&str>)?;
        let news = MenuItem::with_id(app, MENU_NEWS, news_text(), true, None::<&str>)?;
        app_menu.insert(&check, 2)?;
        app_menu.insert(&news, 3)?;
        app_menu.insert(&PredefinedMenuItem::separator(app)?, 4)?;
    }
    Ok(menu)
}

#[cfg(target_os = "macos")]
fn check_text() -> &'static str {
    crate::i18n::pick("检查更新…", "Check for Updates…")
}

#[cfg(target_os = "macos")]
fn news_text() -> &'static str {
    crate::i18n::pick("新功能…", "What's New…")
}

/// Puts our menu items in the interface language (the menu is built before settings are read).
#[cfg(target_os = "macos")]
pub fn retitle_menu(app: &AppHandle) {
    let Some(app_menu) = app
        .menu()
        .and_then(|m| m.items().ok())
        .and_then(|items| items.first().and_then(|i| i.as_submenu().cloned()))
    else {
        return;
    };
    for (id, text) in [(MENU_CHECK, check_text()), (MENU_NEWS, news_text())] {
        if let Some(item) = app_menu.get(id).and_then(|i| i.as_menuitem().cloned()) {
            let _ = item.set_text(text);
        }
    }
}

/// No app menu on other platforms.
#[cfg(not(target_os = "macos"))]
pub fn retitle_menu(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
pub fn on_menu(app: &AppHandle, id: &str) {
    let event = match id {
        MENU_CHECK => "update:check",
        MENU_NEWS => "news:open",
        _ => return,
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    let _ = app.emit(event, ());
}

/// macOS runs a quarantined app opened in place from a random read-only copy (App Translocation);
/// it can't be replaced there.
#[cfg(target_os = "macos")]
fn translocated(exe: &str) -> bool {
    exe.contains("/AppTranslocation/")
}

fn message(e: impl std::fmt::Display) -> String {
    let e = e.to_string();
    let lower = e.to_lowercase();
    if lower.contains("signature") {
        tr!(
            "下载的更新没有通过签名校验，已放弃安装（{e}）",
            "The downloaded update failed its signature check, so it wasn't installed ({e})"
        )
    } else if lower.contains("network")
        || lower.contains("connect")
        || lower.contains("dns")
        || lower.contains("timed out")
        || lower.contains("error sending request")
    {
        crate::i18n::pick(
            "连不上更新服务器，请检查网络后再试",
            "Couldn't reach the update server. Check your network and try again.",
        )
        .into()
    } else {
        tr!("更新失败：{e}", "Update failed: {e}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn spots_translocated_apps() {
        assert!(translocated(
            "/private/var/folders/x/T/AppTranslocation/1A2B/d/Shadowing.app/Contents/MacOS/shadowing"
        ));
        assert!(!translocated(
            "/Applications/Shadowing.app/Contents/MacOS/shadowing"
        ));
    }

    #[test]
    fn explains_failures_in_chinese() {
        assert_eq!(
            message("error sending request for url (https://github.com/...)"),
            "连不上更新服务器，请检查网络后再试"
        );
        assert!(message("signature verification failed").starts_with("下载的更新没有通过签名校验"));
        assert!(message("boom").starts_with("更新失败："));
    }
}
