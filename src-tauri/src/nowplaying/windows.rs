//! Windows: the window's SystemMediaTransportControls. Media keys and a headset's buttons come to
//! them, and the media flyout (by the volume, or in Quick Settings) shows the track. Windows has
//! no ⏯ of its own: it asks for play or pause by what `PlaybackStatus` says.

use super::{press, Button, Playing};
use std::cell::RefCell;
use tauri::{AppHandle, Manager};
use windows::core::{factory, Ref, HSTRING};
use windows::Foundation::TypedEventHandler;
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

thread_local! {
    /// The window's controls and the token of the buttons' handler (only touched on the main thread).
    static CONTROLS: RefCell<Option<(SystemMediaTransportControls, i64)>> = const { RefCell::new(None) };
}

pub fn show(app: &AppHandle, playing: Option<&Playing>) {
    let result = CONTROLS.with_borrow_mut(|controls| -> Result<(), String> {
        match playing {
            Some(p) => {
                if controls.is_none() {
                    *controls = Some(open(app)?);
                }
                if let Some((smtc, _)) = controls {
                    update(smtc, p).map_err(|e| e.to_string())?;
                }
            }
            None => {
                if let Some((smtc, token)) = controls.take() {
                    close(&smtc, token).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    });
    if let Err(e) = result {
        eprintln!("media controls: {e}");
    }
}

fn open(app: &AppHandle) -> Result<(SystemMediaTransportControls, i64), String> {
    let window = app.get_webview_window("main").ok_or("no main window")?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    attach(app, hwnd).map_err(|e| e.to_string())
}

fn attach(
    app: &AppHandle,
    hwnd: HWND,
) -> windows::core::Result<(SystemMediaTransportControls, i64)> {
    let interop = factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
    // SAFETY: the app's own window, alive as long as the app.
    let smtc: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
    smtc.SetIsPlayEnabled(true)?;
    smtc.SetIsPauseEnabled(true)?;
    smtc.SetIsNextEnabled(true)?;
    smtc.SetIsPreviousEnabled(true)?;
    let app = app.clone();
    let handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
            let button = match args.ok()?.Button()? {
                SystemMediaTransportControlsButton::Play => Button::Play,
                SystemMediaTransportControlsButton::Pause => Button::Pause,
                SystemMediaTransportControlsButton::Next => Button::Next,
                SystemMediaTransportControlsButton::Previous => Button::Previous,
                _ => return Ok(()),
            };
            press(&app, button);
            Ok(())
        },
    );
    let token = smtc.ButtonPressed(&handler)?;
    smtc.SetIsEnabled(true)?;
    Ok((smtc, token))
}

fn update(smtc: &SystemMediaTransportControls, p: &Playing) -> windows::core::Result<()> {
    let display = smtc.DisplayUpdater()?;
    display.SetType(MediaPlaybackType::Music)?;
    let music = display.MusicProperties()?;
    music.SetTitle(&HSTRING::from(&p.title))?;
    music.SetArtist(&HSTRING::from(&p.artist))?;
    display.Update()?;
    smtc.SetPlaybackStatus(if p.playing {
        MediaPlaybackStatus::Playing
    } else {
        MediaPlaybackStatus::Paused
    })
}

fn close(smtc: &SystemMediaTransportControls, token: i64) -> windows::core::Result<()> {
    smtc.RemoveButtonPressed(token)?;
    smtc.DisplayUpdater()?.ClearAll()?;
    smtc.SetIsEnabled(false)
}
