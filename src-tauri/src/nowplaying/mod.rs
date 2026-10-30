//! 媒体键: the keyboard's ⏯ ⏮ ⏭ and a headset's buttons (AirPods: press once, twice, three
//! times) reach the app through the system's Now Playing (macOS, mac.rs) or the window's media
//! controls (Windows, windows.rs), which also show the track being practised. The frontend says
//! what is playing and decides what each button does (src/lib/mediaKeys.ts); this only carries
//! them across, on the main thread.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
use mac as platform;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use self::windows as platform;

/// What the system shows, sent again whenever it changes (`stale` in src/lib/mediaKeys.ts).
/// Windows shows the title and play / pause only: a position in its flyout would need sending
/// every few seconds.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(windows, allow(dead_code))]
pub struct Playing {
    pub title: String,
    /// The folder, under the title.
    pub artist: String,
    pub duration: f64,
    pub position: f64,
    /// How fast `position` moves (0 while paused): the system moves it on by itself.
    pub rate: f64,
    /// The deck's play key is going (a recording or a playback too): the system shows pause.
    pub playing: bool,
}

/// A button, as the frontend names it (`media:button`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Button {
    /// macOS only: Windows asks for play or pause by what it was told is going on.
    #[cfg_attr(windows, allow(dead_code))]
    Toggle,
    Play,
    Pause,
    Next,
    Previous,
}

#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
fn press(app: &AppHandle, button: Button) {
    let _ = app.emit("media:button", button);
}

/// Shows `playing`, taking the buttons the first time; with nothing (媒体键 turned off, no track
/// open) lets go of them, so they go back to other apps.
#[tauri::command]
pub fn now_playing(app: AppHandle, playing: Option<Playing>) {
    #[cfg(any(target_os = "macos", windows))]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || platform::show(&handle, playing.as_ref()));
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = (app, playing);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_are_named_as_the_frontend_expects() {
        let names: Vec<_> = [
            Button::Toggle,
            Button::Play,
            Button::Pause,
            Button::Next,
            Button::Previous,
        ]
        .iter()
        .map(|b| serde_json::to_string(b).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                r#""toggle""#,
                r#""play""#,
                r#""pause""#,
                r#""next""#,
                r#""previous""#
            ]
        );
    }

    #[test]
    fn reads_what_the_frontend_sends() {
        let p: Playing = serde_json::from_str(
            r#"{"title":"02 天気の話","artist":"日本語ポッドキャスト","duration":200,"position":12.5,"rate":0.85,"playing":true}"#,
        )
        .unwrap();
        assert_eq!(
            (p.title.as_str(), p.rate, p.playing),
            ("02 天気の話", 0.85, true)
        );
    }
}
