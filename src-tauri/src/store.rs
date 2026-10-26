//! Small JSON file holding everything the app remembers between launches.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub rate: f64,
    /// What happens when a track plays to its end.
    pub play_mode: PlayMode,
    /// Read from files written before `play_mode` existed; never written back.
    #[serde(skip_serializing)]
    auto_advance: Option<bool>,
    /// Seconds jumped by ← → and the rewind/forward buttons.
    pub seek_step: f64,
    /// Last language picked for transcription ("" = detect).
    pub transcribe_language: String,
    /// Daily practice goal, as changes over time (the frontend reads it per day,
    /// so a new goal never rewrites past days). Empty = the default goal.
    pub daily_goals: Vec<GoalChange>,
    /// 跟读录音: hear the sentence then say it, or say it along with the original.
    pub record_mode: crate::record::Mode,
    /// Play a take back against the original as soon as it's recorded.
    pub record_replay: bool,
    /// A whole paragraph: read it on your own, or along with the original.
    pub paragraph_mode: crate::record::Mode,
    /// 整段录音 picked 逐句跟读 instead (sentence by sentence). A field of its own,
    /// not a third `paragraph_mode`: an older version can't read a mode it doesn't
    /// know and would start this file fresh, but skips a field it doesn't know.
    pub paragraph_drill: bool,
    /// 逐句跟读: times each sentence is said before the next (the frontend keeps it to 1–20).
    pub drill_rounds: u32,
    /// Light the playing sentence up a character (a word) at a time as it's
    /// said, where transcription timed them; off lights it whole.
    pub word_highlight: bool,
    /// Height of a video's picture above the sentences, in CSS pixels (dragged by the bar under it).
    pub picture_height: f64,
    /// Interface language: "" follows the Mac, "zh" or "en" (see i18n.rs). Settings saved
    /// before it existed stay Chinese, the only language those versions had.
    #[serde(default = "chinese")]
    pub ui_language: String,
}

fn chinese() -> String {
    "zh".into()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalChange {
    /// First practice day ("2026-10-11") this goal applies to.
    pub since: String,
    /// Minutes a day; 0 = no goal.
    pub minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            rate: 1.0,
            play_mode: PlayMode::Next,
            auto_advance: None,
            seek_step: 5.0,
            transcribe_language: String::new(),
            daily_goals: Vec::new(),
            record_mode: crate::record::Mode::Listen,
            record_replay: true,
            paragraph_mode: crate::record::Mode::Read,
            paragraph_drill: false,
            drill_rounds: 3,
            word_highlight: true,
            picture_height: 300.0,
            ui_language: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayMode {
    /// Stop at the end of the track.
    Once,
    /// Play the folder in order, stop after the last track.
    Next,
    /// Play the folder in order, then start over.
    List,
    /// Repeat the current track.
    One,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub position: f64,
    pub duration: f64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Persisted {
    pub folder: Option<PathBuf>,
    pub last_track: Option<String>,
    pub settings: Settings,
    /// Keyed by absolute track path.
    pub progress: HashMap<String, Progress>,
    pub ai: crate::ai::AiConfig,
    pub guide: crate::guide::Guide,
}

impl Persisted {
    /// Missing or unreadable files start fresh; a corrupt file is kept aside, not deleted.
    pub fn load(path: &Path) -> Self {
        let Ok(text) = fs::read_to_string(path) else {
            return Self::default();
        };
        let mut state: Self = serde_json::from_str(&text).unwrap_or_else(|err| {
            eprintln!("state file unreadable ({err}); starting fresh");
            let _ = fs::rename(path, path.with_extension("corrupt.json"));
            Self::default()
        });
        // The old on/off "continuous play" switch: off meant stop after each track.
        if state.settings.auto_advance.take() == Some(false) {
            state.settings.play_mode = PlayMode::Once;
        }
        state
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        write_atomic(path, &serde_json::to_vec_pretty(self)?)
    }
}

/// Writes numbered snapshots of a JSON file to disk, either right away (`now`, so the
/// caller sees errors) or on a background thread (`later`, for frequent small changes
/// such as playback progress). An older snapshot never overwrites a newer one.
pub struct Saver<T = Persisted> {
    disk: Arc<Disk>,
    later: mpsc::Sender<(u64, T)>,
}

struct Disk {
    path: PathBuf,
    written: Mutex<u64>,
}

impl Disk {
    fn write<T: Serialize>(&self, version: u64, data: &T) -> std::io::Result<()> {
        let mut written = self.written.lock().unwrap();
        if version <= *written {
            return Ok(());
        }
        write_atomic(&self.path, &serde_json::to_vec_pretty(data)?)?;
        *written = version;
        Ok(())
    }
}

impl<T: Serialize + Send + 'static> Saver<T> {
    pub fn new(path: PathBuf) -> Self {
        let disk = Arc::new(Disk {
            path,
            written: Mutex::new(0),
        });
        let (later, queue) = mpsc::channel::<(u64, T)>();
        let d = disk.clone();
        // If the thread can't start, `later` falls back to writing in place.
        let _ = std::thread::Builder::new()
            .name("state-saver".into())
            .spawn(move || {
                while let Ok(mut next) = queue.recv() {
                    while let Ok(newer) = queue.try_recv() {
                        next = newer; // only the latest matters
                    }
                    if let Err(e) = d.write(next.0, &next.1) {
                        eprintln!("{} not saved: {e}", d.path.display());
                    }
                }
            });
        Self { disk, later }
    }

    pub fn now(&self, version: u64, data: &T) -> std::io::Result<()> {
        self.disk.write(version, data)
    }

    pub fn later(&self, version: u64, data: T) {
        if let Err(mpsc::SendError((version, data))) = self.later.send((version, data)) {
            if let Err(e) = self.disk.write(version, &data) {
                eprintln!("{} not saved: {e}", self.disk.path.display());
            }
        }
    }
}

/// Temp file + fsync + rename, so a crash or power loss never leaves half a file
/// (or an empty one). Each write has its own temp name, so two writers to the
/// same file can't install each other's partial bytes.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("tmp-{}-{n}", std::process::id()));
    let written = File::create(&tmp).and_then(|mut f| {
        f.write_all(bytes)?;
        f.sync_all()
    });
    let renamed = written.and_then(|()| replace(&tmp, path));
    if renamed.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    renamed
}

/// `rename`, which replaces `to`. On Windows that fails with "access denied" or a sharing
/// violation while someone else has `to` open without sharing it (a virus scanner, the
/// search indexer, another write landing at the same moment): try again for a little while.
pub fn replace(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut wait = std::time::Duration::from_millis(5);
    loop {
        match fs::rename(from, to) {
            Err(e) if busy(&e) && wait.as_millis() <= 640 => {
                std::thread::sleep(wait);
                wait *= 2;
            }
            done => return done,
        }
    }
}

fn busy(e: &std::io::Error) -> bool {
    /// ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
    const IN_USE: [i32; 2] = [32, 33];
    cfg!(windows)
        && (e.kind() == std::io::ErrorKind::PermissionDenied
            || e.raw_os_error().is_some_and(|code| IN_USE.contains(&code)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drilling_still_writes_a_paragraph_mode_older_versions_know() {
        let settings = Settings {
            paragraph_drill: true,
            ..Settings::default()
        };
        let json = serde_json::to_value(&settings).unwrap();
        assert_eq!(json["paragraphMode"], "read");
        assert_eq!(json["paragraphDrill"], true);
    }

    #[test]
    fn round_trip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        assert_eq!(Persisted::load(&path).settings.rate, 1.0);

        let mut s = Persisted::default();
        s.settings.rate = 0.8;
        s.progress.insert(
            "/a.mp3".into(),
            Progress {
                position: 12.5,
                duration: 60.0,
                updated_at: 1,
            },
        );
        s.save(&path).unwrap();
        let loaded = Persisted::load(&path);
        assert_eq!(loaded.settings.rate, 0.8);
        assert_eq!(loaded.progress["/a.mp3"].position, 12.5);
    }

    #[test]
    fn older_files_get_new_setting_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, r#"{"settings":{"rate":0.8}}"#).unwrap();
        let s = Persisted::load(&path).settings;
        assert_eq!(
            (s.rate, s.play_mode, s.seek_step),
            (0.8, PlayMode::Next, 5.0)
        );
        assert!(s.daily_goals.is_empty());
    }

    #[test]
    fn only_a_fresh_start_follows_the_system_language() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        assert_eq!(Persisted::load(&path).settings.ui_language, "");
        fs::write(&path, r#"{"settings":{"rate":0.8}}"#).unwrap();
        assert_eq!(Persisted::load(&path).settings.ui_language, "zh");
    }

    #[test]
    fn old_continuous_play_switch_becomes_a_play_mode() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, r#"{"settings":{"autoAdvance":false}}"#).unwrap();
        let loaded = Persisted::load(&path);
        assert_eq!(loaded.settings.play_mode, PlayMode::Once);
        // Saved back without the old field.
        loaded.save(&path).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains(r#""playMode": "once""#) && !text.contains("autoAdvance"));
        fs::write(
            &path,
            r#"{"settings":{"autoAdvance":true,"playMode":"one"}}"#,
        )
        .unwrap();
        assert_eq!(Persisted::load(&path).settings.play_mode, PlayMode::One);
    }

    #[test]
    fn concurrent_atomic_writes_leave_one_whole_file_and_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.json");
        let writers: Vec<_> = (0..8u8)
            .map(|i| {
                let path = path.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        write_atomic(&path, &vec![b'a' + i; 64 * 1024]).unwrap();
                    }
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap();
        }
        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 64 * 1024);
        assert!(bytes.iter().all(|&b| b == bytes[0]), "mixed writers");
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["t.json"]);
    }

    #[test]
    fn saver_never_lets_an_older_snapshot_win() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let saver = Saver::new(path.clone());
        let with_rate = |rate| {
            let mut p = Persisted::default();
            p.settings.rate = rate;
            p
        };
        for v in 1..=50u64 {
            saver.later(v, with_rate(v as f64 / 100.0));
        }
        saver.now(51, &with_rate(0.75)).unwrap();
        saver.later(40, with_rate(0.1)); // late arrival of an old snapshot
        saver.now(51, &with_rate(0.75)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert_eq!(Persisted::load(&path).settings.rate, 0.75);
    }

    #[test]
    fn corrupt_file_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, "{not json").unwrap();
        assert!(Persisted::load(&path).folder.is_none());
        assert!(dir.path().join("state.corrupt.json").exists());
    }
}
