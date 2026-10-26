//! Merging a YouTube video's picture (mp4) and sound (m4a), downloaded separately,
//! into one ordinary mp4: no ffmpeg, no re-encoding. Both come as fragmented DASH
//! files; the merged file has one `moov` with a sample table per track, placed
//! before the data so a player can start without reading to the end, then one
//! `mdat` with the samples copied as they are, interleaved about every half second.
//! See "合成 mp4 的原型（结论）" in docs/video-plan.md.

// Not called by the import yet (a prototype for the video plan's step 3).
#![allow(dead_code)]

mod bytes;
mod read;
mod samples;
mod write;

#[cfg(test)]
mod real_tests;
#[cfg(test)]
mod test_files;
#[cfg(test)]
mod tests;

use read::Track;
use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// Each track goes into the `mdat` in pieces of about this much playing time (seconds).
const CHUNK: f64 = 0.5;

/// A run of one track's samples, next to each other in its file, written as one chunk.
#[derive(Debug)]
struct Chunk {
    track: usize,
    count: u32,
    /// Where its bytes are in the track's file, and how many.
    from: u64,
    len: u64,
    /// When its first sample decodes (seconds).
    at: f64,
}

fn io(e: std::io::Error) -> String {
    format!("合成视频失败：{e}")
}

/// Writes `out` from the first picture track in `video` and the first sound track in
/// `audio`. `progress(done, total)` hears about the bytes written; an error from it
/// (e.g. cancelled) stops the merge. A half-written `out` is removed.
pub fn merge(
    video: &Path,
    audio: &Path,
    out: &Path,
    progress: &mut dyn FnMut(u64, u64) -> Result<(), String>,
) -> Result<(), String> {
    let picture = pick(video, b"vide", "画面")?;
    let sound = pick(audio, b"soun", "声音")?;
    let result = write_file(&[&picture, &sound], &[video, audio], out, progress);
    if result.is_err() {
        let _ = std::fs::remove_file(out);
    }
    result
}

fn pick(path: &Path, handler: &[u8; 4], what: &str) -> Result<Track, String> {
    let tracks = read::tracks(path)?;
    let track = tracks
        .into_iter()
        .find(|t| &t.handler == handler && !t.samples.is_empty());
    track.ok_or_else(|| format!("下载的文件里没有{what}"))
}

/// Cuts each track into chunks and puts them in the order they play.
fn chunks(tracks: &[&Track]) -> Vec<Chunk> {
    let mut all = Vec::new();
    for (i, t) in tracks.iter().enumerate() {
        let limit = (CHUNK * t.timescale as f64) as u64;
        let (mut time, mut start) = (0u64, 0u64);
        let mut current: Option<Chunk> = None;
        for s in &t.samples {
            match &mut current {
                Some(c) if c.from + c.len == s.offset && time - start < limit => {
                    c.count += 1;
                    c.len += s.size as u64;
                }
                _ => {
                    all.extend(current.take());
                    start = time;
                    current = Some(Chunk {
                        track: i,
                        count: 1,
                        from: s.offset,
                        len: s.size as u64,
                        at: time as f64 / t.timescale as f64,
                    });
                }
            }
            time += s.duration as u64;
        }
        all.extend(current);
    }
    // Stable: at the same time, the picture comes first.
    all.sort_by(|a, b| a.at.total_cmp(&b.at));
    all
}

/// Each track's chunks: where they go in the merged file (from `base` on), and their sample counts.
fn place(tracks: usize, chunks: &[Chunk], base: u64) -> Vec<write::Chunks> {
    let mut out = vec![Vec::new(); tracks];
    let mut at = base;
    for c in chunks {
        out[c.track].push((at, c.count));
        at += c.len;
    }
    out
}

fn write_file(
    tracks: &[&Track],
    inputs: &[&Path],
    out: &Path,
    progress: &mut dyn FnMut(u64, u64) -> Result<(), String>,
) -> Result<(), String> {
    let chunks = chunks(tracks);
    let payload: u64 = chunks.iter().map(|c| c.len).sum();
    let ftyp = write::ftyp();
    let mdat_header: u64 = if payload + 8 > u32::MAX as u64 { 16 } else { 8 };
    // The moov's size doesn't depend on the offsets in it, only on how wide they are.
    let moov_len = |wide| write::moov(tracks, &place(tracks.len(), &chunks, 0), wide).len();
    let before = ftyp.len() as u64 + mdat_header;
    let wide = before + moov_len(false) as u64 + payload > u32::MAX as u64;
    let base = before + moov_len(wide) as u64;
    let moov = write::moov(tracks, &place(tracks.len(), &chunks, base), wide);

    let mut files = Vec::new();
    for path in inputs {
        files.push(File::open(path).map_err(io)?);
    }
    let mut w = BufWriter::with_capacity(1 << 20, File::create(out).map_err(io)?);
    w.write_all(&ftyp).map_err(io)?;
    w.write_all(&moov).map_err(io)?;
    if mdat_header == 16 {
        w.write_all(&1u32.to_be_bytes()).map_err(io)?;
        w.write_all(b"mdat").map_err(io)?;
        w.write_all(&(payload + 16).to_be_bytes()).map_err(io)?;
    } else {
        w.write_all(&(payload as u32 + 8).to_be_bytes())
            .map_err(io)?;
        w.write_all(b"mdat").map_err(io)?;
    }
    let mut done = 0;
    for c in &chunks {
        progress(done, payload)?;
        let file = &mut files[c.track];
        file.seek(SeekFrom::Start(c.from)).map_err(io)?;
        let copied = std::io::copy(&mut file.take(c.len), &mut w).map_err(io)?;
        if copied != c.len {
            return Err(io(std::io::ErrorKind::UnexpectedEof.into()));
        }
        done += c.len;
    }
    w.into_inner().map_err(|e| io(e.into_error()))?;
    progress(payload, payload)
}
