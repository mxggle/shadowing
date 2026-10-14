//! Tauri commands for 跟读录音. Takes are stored per track in app data; the
//! track must be one the webview may use.

use super::playback::{self, Playing, What};
use super::{replay, saved, Finished, Level, Meta, Reading, Recorder, Signals, Stop, Take};
use crate::audio::Player;
use crate::practice::{Doing, Practice};
use crate::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// Returns the name of the microphone recording.
#[tauri::command]
pub fn record_begin(
    app: AppHandle,
    state: State<'_, AppState>,
    player: State<'_, Player>,
    recorder: State<'_, Recorder>,
    meta: Meta,
) -> Result<String, String> {
    let file = state.audio(&meta.audio)?;
    let out = Live {
        app,
        audio: meta.audio.clone(),
    };
    recorder.begin(out, &player, meta, file)
}

/// A take's signals, to the webview and the practice clock (recording is practice).
struct Live {
    app: AppHandle,
    audio: String,
}

impl Live {
    fn practice(&self, doing: Doing) {
        if let Some(p) = self.app.try_state::<Arc<Practice>>() {
            p.busy(&self.audio, doing);
        }
    }
}

impl Signals for Live {
    fn level(&self, level: &Level) {
        self.practice(Doing::Recording);
        self.app.level(level);
    }
    fn auto(&self, stop: Stop) {
        self.app.auto(stop);
    }
    fn sentence(&self, index: usize) {
        self.app.sentence(index);
    }
    fn error(&self, message: &str) {
        self.app.error(message);
    }
    fn ended(&self) {
        self.practice(Doing::Paused);
    }
}

#[tauri::command]
pub fn record_turn(recorder: State<'_, Recorder>) {
    recorder.turn();
}

#[tauri::command]
pub fn record_cancel(player: State<'_, Player>, recorder: State<'_, Recorder>) {
    recorder.cancel(&player);
}

/// Stops and keeps the take (off the main thread: removing the echo takes a moment).
#[tauri::command]
pub async fn record_finish(app: AppHandle) -> Result<Finished, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let (state, player, recorder) = (
            app.state::<AppState>(),
            app.state::<Player>(),
            app.state::<Recorder>(),
        );
        recorder.finish(&player, &state.data_dir())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reading a paragraph on your own: on to the next (+1) / back to the previous (−1) sentence.
#[tauri::command]
pub fn record_step(recorder: State<'_, Recorder>, by: i32) {
    recorder.step(by);
}

#[tauri::command]
pub fn record_readings(state: State<'_, AppState>, audio: String) -> Vec<Reading> {
    saved::readings(&state.data_dir(), &audio)
}

/// Deletes a paragraph reading and the sentence takes cut from it.
#[tauri::command]
pub fn record_delete_reading(
    state: State<'_, AppState>,
    audio: String,
    id: String,
) -> Result<(), String> {
    saved::delete_reading(&state.data_dir(), &audio, &id)
}

#[tauri::command]
pub fn record_play_reading(
    app: AppHandle,
    state: State<'_, AppState>,
    player: State<'_, Player>,
    audio: String,
    id: String,
    what: replay::ReadingPart,
) -> Result<replay::ReadingPlaying, String> {
    replay::play_reading(app.clone(), &player, &state.data_dir(), &audio, &id, what)
}

#[tauri::command]
pub fn record_takes(state: State<'_, AppState>, audio: String) -> Vec<Take> {
    saved::list(&state.data_dir(), &audio)
}

#[tauri::command]
pub fn record_delete(state: State<'_, AppState>, audio: String, id: String) -> Result<(), String> {
    saved::delete(&state.data_dir(), &audio, &id)
}

#[tauri::command]
pub fn record_play(
    app: AppHandle,
    state: State<'_, AppState>,
    player: State<'_, Player>,
    audio: String,
    id: String,
    what: What,
) -> Result<Playing, String> {
    playback::play(app.clone(), &player, &state.data_dir(), &audio, &id, what)
}

#[tauri::command]
pub fn record_stop(player: State<'_, Player>) -> Result<(), String> {
    player.stop_clip()
}

/// How much room recordings take, and how much of it is for audio that's gone.
#[tauri::command]
pub async fn record_space(app: AppHandle) -> super::space::Space {
    tauri::async_runtime::spawn_blocking(move || {
        super::space::space(&app.state::<AppState>().data_dir())
    })
    .await
    .unwrap_or_default()
}

/// Deletes the recordings of audio files that are gone (moved or deleted).
#[tauri::command]
pub async fn record_clear_missing(app: AppHandle) -> Result<super::space::Space, String> {
    tauri::async_runtime::spawn_blocking(move || {
        super::space::clear_missing(&app.state::<AppState>().data_dir())
    })
    .await
    .map_err(|e| e.to_string())?
}
