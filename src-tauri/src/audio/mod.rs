//! Native audio playback. The webview only sends commands and renders
//! `player:*` events; decoding, speed, A–B looping and output happen here.
//!
//! Threads and data flow:
//! - command handlers (`commands.rs`, Tauri main thread) → `Player` builds a
//!   `Session` (decoder, DSP state, all allocations) and queues `Cmd`s into a
//!   lock-free ring.
//! - `audio-decode` (one per track) streams decoded frames into a ring
//!   (`feed.rs`); seeks are requests answered with marker-tagged data.
//! - `audio-loop-loader` decodes the A–B region into RAM (`region.rs`).
//! - `audio-output` owns the cpal stream; its callback runs `Engine::render`
//!   (`engine.rs`): reader (loop splice, `reader.rs`) → stretch/bypass
//!   (`stretch.rs`) → resample (`resample.rs`) → device.
//! - `audio-status` frees retired buffers and emits status at ~30 Hz.

pub(crate) mod clip;
pub mod commands;
pub(crate) mod decode;
mod engine;
mod feed;
mod fifo;
pub(crate) mod output;
mod player;
mod reader;
mod region;
pub(crate) mod resample;
mod session;
mod status;
mod stretch;
pub(crate) mod tap;
#[cfg(test)]
mod tests;

pub use player::Player;
use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub path: Option<String>,
    /// Source seconds of what is audible now.
    pub time: f64,
    pub duration: f64,
    pub playing: bool,
    /// Passes the current A–B loop has completed (0 without a loop).
    pub repeats: u32,
    /// Increases with every snapshot; events can arrive out of order, so the
    /// frontend drops any status older than one it has already applied.
    pub seq: u64,
}

/// Where player events go (Tauri in the app, a recorder in tests).
pub trait EventSink: Send + Sync + 'static {
    fn status(&self, status: &Status);
    fn ended(&self, path: &str);
    fn error(&self, path: Option<&str>, message: &str);
}

pub struct TauriSink(pub tauri::AppHandle);

#[derive(Clone, Serialize)]
struct EndedPayload<'a> {
    path: &'a str,
}

#[derive(Clone, Serialize)]
struct ErrorPayload<'a> {
    path: Option<&'a str>,
    message: &'a str,
}

impl EventSink for TauriSink {
    fn status(&self, status: &Status) {
        let _ = self.0.emit("player:status", status);
    }
    fn ended(&self, path: &str) {
        let _ = self.0.emit("player:ended", EndedPayload { path });
    }
    fn error(&self, path: Option<&str>, message: &str) {
        let _ = self.0.emit("player:error", ErrorPayload { path, message });
    }
}
