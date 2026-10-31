//! 句子本: sentences you got stuck on, from any audio, to shadow again tomorrow, in a week and in
//! a month (the schedule is the frontend's, src/lib/book.ts). Kept whole in app data's book.json.
//! Only text and times: playing one opens its audio the usual way, through the folder's checks.

use crate::store::write_atomic;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Entry {
    pub id: String,
    /// The audio it's from, as the folder listing names it.
    pub audio: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    /// Practice day it was added ("2026-10-31").
    pub added: String,
    /// Practice day it comes back; "" once it's been said well each time.
    pub due: String,
    /// Times said well in a row.
    pub step: u32,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Book {
    entries: Vec<Entry>,
}

fn file(state: &AppState) -> PathBuf {
    state.data_dir().join("book.json")
}

/// What's in the book; nothing when the file is missing or damaged.
fn load(path: &Path) -> Vec<Entry> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Book>(&bytes).ok())
        .map(|book| book.entries)
        .unwrap_or_default()
}

fn save(path: &Path, entries: Vec<Entry>) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&Book { entries }).map_err(|e| e.to_string())?;
    write_atomic(path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn book_get(state: State<AppState>) -> Vec<Entry> {
    load(&file(&state))
}

#[tauri::command]
pub fn book_save(state: State<AppState>, entries: Vec<Entry>) -> Result<(), String> {
    save(&file(&state), entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_what_was_saved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.json");
        let entry = Entry {
            id: "a".into(),
            audio: "/m/02.mp3".into(),
            start: 1.5,
            end: 3.0,
            text: "今日は天気の話をしましょう。".into(),
            added: "2026-10-31".into(),
            due: "2026-11-01".into(),
            step: 0,
        };
        save(&path, vec![entry.clone()]).unwrap();
        assert_eq!(load(&path), vec![entry]);
    }

    #[test]
    fn a_missing_or_damaged_book_is_empty_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.json");
        assert!(load(&path).is_empty());
        std::fs::write(&path, "{not json").unwrap();
        assert!(load(&path).is_empty());
    }
}
