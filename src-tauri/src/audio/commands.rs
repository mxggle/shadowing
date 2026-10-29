//! Tauri commands for the native player. All synchronous (run in order on the
//! main thread) and cheap: they validate, queue a command and return.
//! Commands that move the playhead return the resulting status, so the
//! frontend can discard older `player:status` events still in flight.

use super::{Player, Status};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn player_load(
    state: State<'_, AppState>,
    player: State<'_, Player>,
    path: String,
    start_at: f64,
    autoplay: bool,
) -> Result<Status, String> {
    let loaded = state
        .audio(&path)
        .and_then(|file| player.load(path, file, start_at, autoplay));
    if let Err(e) = loaded {
        // Stop the previous track too: the window now shows the one that failed,
        // so anything still playing could no longer be seen or paused.
        player.unload()?;
        return Err(e);
    }
    Ok(player.status())
}

#[tauri::command]
pub fn player_play(player: State<'_, Player>) -> Result<Status, String> {
    player.play()?;
    Ok(player.status())
}

#[tauri::command]
pub fn player_pause(player: State<'_, Player>) -> Result<Status, String> {
    player.pause()?;
    Ok(player.status())
}

#[tauri::command]
pub fn player_toggle(player: State<'_, Player>) -> Result<Status, String> {
    player.toggle()?;
    Ok(player.status())
}

#[tauri::command]
pub fn player_seek(player: State<'_, Player>, time: f64) -> Result<Status, String> {
    player.seek(time)?;
    Ok(player.status())
}

/// Plays `a`..`b` once and pauses at `b` (the original before you say it).
#[tauri::command]
pub fn player_play_range(player: State<'_, Player>, a: f64, b: f64) -> Result<Status, String> {
    player.play_range(a, b)?;
    Ok(player.status())
}

/// Forgets a range: the track plays on past where it would have stopped (跟读停顿 turned off).
#[tauri::command]
pub fn player_end_range(player: State<'_, Player>) -> Result<(), String> {
    player.end_range()
}

#[tauri::command]
pub fn player_set_rate(player: State<'_, Player>, rate: f64) -> Result<(), String> {
    player.set_rate(rate)
}

#[tauri::command]
pub fn player_set_loop(
    player: State<'_, Player>,
    a: Option<f64>,
    b: Option<f64>,
) -> Result<(), String> {
    player.set_loop(a, b)
}

#[tauri::command]
pub fn player_set_volume(player: State<'_, Player>, volume: f64) -> Result<(), String> {
    player.set_volume(volume)
}

#[tauri::command]
pub fn player_unload(player: State<'_, Player>) -> Result<(), String> {
    player.unload()
}

#[tauri::command]
pub fn player_status(player: State<'_, Player>) -> Result<Status, String> {
    Ok(player.status())
}
