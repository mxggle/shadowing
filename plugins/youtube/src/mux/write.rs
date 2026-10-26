//! The merged file's `ftyp` and `moov`: one `trak` per track, each with a sample
//! table pointing into the `mdat` that follows.

use super::bytes::{bx, full, rescale, Put};
use super::read::Track;

/// The merged file's movie timescale (ffmpeg's too).
pub const MOVIE_TIMESCALE: u32 = 1000;

/// Where a track's chunks went: offset in the merged file, and how many samples each holds.
pub type Chunks = Vec<(u64, u32)>;

const MATRIX: [u32; 9] = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000];

pub fn ftyp() -> Vec<u8> {
    let mut b = Vec::new();
    b.put(b"isom").u32(0x200).put(b"isomiso2avc1mp41");
    bx(b"ftyp", &b)
}

/// `wide`: chunk offsets in 64 bits (`co64`), for files over 4 GB.
pub fn moov(tracks: &[&Track], chunks: &[Chunks], wide: bool) -> Vec<u8> {
    let lengths: Vec<u64> = tracks.iter().map(|t| movie_duration(t)).collect();
    let longest = lengths.iter().copied().max().unwrap_or(0);
    let mut body = mvhd(longest, tracks.len() as u32 + 1);
    for (i, t) in tracks.iter().enumerate() {
        body.put(&trak(t, i as u32 + 1, lengths[i], &chunks[i], wide));
    }
    bx(b"moov", &body)
}

/// Each edit's duration in the movie timescale (0 in the original: to the end of the media).
fn edit_durations(t: &Track) -> Vec<u64> {
    let media = t.media_duration();
    let duration = |e: &super::read::Edit| match e.duration {
        0 => {
            let rest = media.saturating_sub(e.media_time.max(0) as u64);
            rescale(rest, t.timescale, MOVIE_TIMESCALE)
        }
        d => rescale(d, t.movie_timescale, MOVIE_TIMESCALE),
    };
    t.edits.iter().map(duration).collect()
}

fn movie_duration(t: &Track) -> u64 {
    if t.edits.is_empty() {
        rescale(t.media_duration(), t.timescale, MOVIE_TIMESCALE)
    } else {
        edit_durations(t).iter().sum()
    }
}

/// Version 1 (64-bit times) only when a duration needs it.
fn version(duration: u64) -> u8 {
    u8::from(duration > u32::MAX as u64)
}

/// Creation and modification times (left at 0), then `timescale` and `duration`.
fn times(b: &mut Vec<u8>, v: u8, timescale: u32, duration: u64) {
    b.put(if v == 1 { &[0; 16] } else { &[0; 8] })
        .u32(timescale);
    match v {
        1 => b.u64(duration),
        _ => b.u32(duration as u32),
    };
}

fn mvhd(duration: u64, next_id: u32) -> Vec<u8> {
    let v = version(duration);
    let mut b = Vec::new();
    times(&mut b, v, MOVIE_TIMESCALE, duration);
    b.u32(0x10000).u16(0x100).put(&[0; 10]);
    for m in MATRIX {
        b.u32(m);
    }
    b.put(&[0; 24]).u32(next_id);
    full(b"mvhd", v, 0, &b)
}

fn trak(t: &Track, id: u32, duration: u64, chunks: &Chunks, wide: bool) -> Vec<u8> {
    let v = version(duration);
    let mut tkhd = Vec::new();
    tkhd.put(if v == 1 { &[0; 16] } else { &[0; 8] })
        .u32(id)
        .u32(0);
    match v {
        1 => tkhd.u64(duration),
        _ => tkhd.u32(duration as u32),
    };
    tkhd.put(&t.tkhd_tail);
    // Enabled and in the movie, whatever the original said.
    let mut body = full(b"tkhd", v, t.tkhd_flags | 0x3, &tkhd);
    if !t.edits.is_empty() {
        body.put(&edts(t));
    }
    body.put(&mdia(t, chunks, wide));
    bx(b"trak", &body)
}

fn edts(t: &Track) -> Vec<u8> {
    let durations = edit_durations(t);
    let v = u8::from(
        durations.iter().any(|d| *d > u32::MAX as u64)
            || t.edits.iter().any(|e| e.media_time > i32::MAX as i64),
    );
    let mut b = Vec::new();
    b.u32(t.edits.len() as u32);
    for (e, d) in t.edits.iter().zip(durations) {
        match v {
            1 => b.u64(d).u64(e.media_time as u64),
            _ => b.u32(d as u32).u32(e.media_time as i32 as u32),
        };
        b.u32(e.rate);
    }
    bx(b"edts", &full(b"elst", v, 0, &b))
}

fn mdia(t: &Track, chunks: &Chunks, wide: bool) -> Vec<u8> {
    let duration = t.media_duration();
    let v = version(duration);
    let mut mdhd = Vec::new();
    times(&mut mdhd, v, t.timescale, duration);
    mdhd.u16(t.language).u16(0);
    let mut body = full(b"mdhd", v, 0, &mdhd);
    body.put(&t.mdia_rest);
    let mut minf = t.minf_rest.clone();
    minf.put(&stbl(t, chunks, wide));
    body.put(&bx(b"minf", &minf));
    bx(b"mdia", &body)
}

/// (count, value) runs of equal values, one after another.
fn runs(values: impl Iterator<Item = u32>) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    for v in values {
        match out.len() {
            n if n >= 2 && out[n - 1] == v => out[n - 2] += 1,
            _ => out.extend([1, v]),
        }
    }
    out
}

/// A full box that is a count and then that many entries of `width` values.
fn table(typ: &[u8; 4], version: u8, width: usize, values: &[u32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(4 + values.len() * 4);
    b.u32((values.len() / width) as u32);
    for v in values {
        b.u32(*v);
    }
    full(typ, version, 0, &b)
}

fn stbl(t: &Track, chunks: &Chunks, wide: bool) -> Vec<u8> {
    let s = &t.samples;
    let mut b = t.stsd.clone();
    b.put(&table(b"stts", 0, 2, &runs(s.iter().map(|s| s.duration))));
    if s.iter().any(|s| s.cto != 0) {
        // Version 1 when an offset is negative.
        let v = u8::from(s.iter().any(|s| s.cto < 0));
        b.put(&table(b"ctts", v, 2, &runs(s.iter().map(|s| s.cto as u32))));
    }
    if s.iter().any(|s| !s.sync) {
        let numbers = (1..).zip(s).filter(|(_, s)| s.sync);
        let stss: Vec<u32> = numbers.map(|(n, _)| n).collect();
        b.put(&table(b"stss", 0, 1, &stss));
    }
    // A new entry only where the number of samples per chunk changes.
    let mut stsc: Vec<u32> = Vec::new();
    for (i, &(_, n)) in chunks.iter().enumerate() {
        if stsc.len() < 3 || stsc[stsc.len() - 2] != n {
            stsc.extend([i as u32 + 1, n, 1]);
        }
    }
    b.put(&table(b"stsc", 0, 3, &stsc));
    let mut stsz = Vec::with_capacity(8 + s.len() * 4);
    match s.first() {
        Some(first) if s.iter().all(|x| x.size == first.size) => {
            stsz.u32(first.size).u32(s.len() as u32);
        }
        _ => {
            stsz.u32(0).u32(s.len() as u32);
            for x in s {
                stsz.u32(x.size);
            }
        }
    }
    b.put(&full(b"stsz", 0, 0, &stsz));
    let mut co = Vec::with_capacity(4 + chunks.len() * 8);
    co.u32(chunks.len() as u32);
    for &(at, _) in chunks {
        match wide {
            true => co.u64(at),
            false => co.u32(at as u32),
        };
    }
    b.put(&full(if wide { b"co64" } else { b"stco" }, 0, 0, &co));
    bx(b"stbl", &b)
}
