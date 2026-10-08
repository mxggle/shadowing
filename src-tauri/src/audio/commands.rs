//! Tauri commands for the native player. All synchronous (run in order on the
//! main thread) and cheap: they validate, queue a command and return.
//! Commands that move the playhead return the resulting status, so the
//! frontend can discard older `player:status` events still in flight.

use super::{Player, Status};
use crate::{library, AppState};
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn player_load(
    state: State<'_, AppState>,
    player: State<'_, Player>,
    path: String,
    start_at: f64,
    autoplay: bool,
) -> Result<Status, String> {
    let root = state.root().ok_or("尚未选择文件夹")?;
    let file = library::resolve_inside(&root, Path::new(&path))
        .filter(|p| library::is_audio(p))
        .ok_or("无法访问此文件")?;
    player.load(path, file, start_at, autoplay)?;
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
