//! Reading the tracks of one file: a fragmented one (YouTube's DASH files: empty
//! tables in `moov`, the samples in `moof` + `mdat` pairs) or an ordinary one
//! (the tables in `stbl`). What describes a track (`hdlr`, `vmhd` / `smhd`, `dinf`,
//! `stsd` with the codec's setup) is kept as it is; the samples become a list.

use super::bytes::{bad, boxes, find, need, rescale, Bx, Cur};
use super::samples::{entries, fragment, table};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// The biggest `moov` / `moof` read into memory (a 10-minute DASH file's are a few KB).
const MAX_HEADER: u64 = 64 << 20;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    /// Where its bytes are in the file.
    pub offset: u64,
    pub size: u32,
    /// In the track's timescale.
    pub duration: u32,
    /// Presentation time minus decode time.
    pub cto: i32,
    pub sync: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Edit {
    /// In the file's movie timescale; 0 = to the end of the media.
    pub duration: u64,
    /// In the track's timescale; -1 = nothing plays (an empty edit).
    pub media_time: i64,
    pub rate: u32,
}

#[derive(Debug)]
pub struct Track {
    pub id: u32,
    pub handler: [u8; 4],
    pub tkhd_flags: u32,
    /// `tkhd` from the reserved bytes after the duration on: layer, volume, matrix, width, height.
    pub tkhd_tail: Vec<u8>,
    pub timescale: u32,
    pub language: u16,
    /// `hdlr` and whatever else `mdia` has besides `mdhd` and `minf`.
    pub mdia_rest: Vec<u8>,
    /// `vmhd` / `smhd` and `dinf`: everything in `minf` but `stbl`.
    pub minf_rest: Vec<u8>,
    pub stsd: Vec<u8>,
    /// The file's movie timescale, which the edits' durations are in.
    pub movie_timescale: u32,
    pub edits: Vec<Edit>,
    pub samples: Vec<Sample>,
    /// For fragments (`trex`): description index, duration, size, flags.
    pub(super) defaults: [u32; 4],
    /// Decode time of the first sample, and of the end of the last one.
    start: Option<u64>,
    pub(super) end: u64,
}

impl Track {
    pub fn media_duration(&self) -> u64 {
        self.samples.iter().map(|s| s.duration as u64).sum()
    }

    /// A fragment says when its first sample decodes.
    pub(super) fn decode_from(&mut self, at: u64) {
        if self.start.is_none() {
            self.start = Some(at);
        } else if let Some(last) = self.samples.last_mut() {
            // A gap (or an overlap) between fragments: the sample before lasts until the next starts.
            let d = last.duration as i64 + at as i64 - self.end as i64;
            last.duration = d.clamp(0, u32::MAX as i64) as u32;
        }
        self.end = at;
    }

    /// The merged file's samples start at 0: one that started later keeps playing at the same time.
    fn finish(&mut self) {
        let start = self.start.unwrap_or(0);
        if start == 0 {
            return;
        }
        if self.edits.is_empty() {
            let wait = rescale(start, self.timescale, self.movie_timescale);
            let edit = |duration, media_time| Edit {
                duration,
                media_time,
                rate: 1 << 16,
            };
            self.edits = vec![edit(wait, -1), edit(0, 0)];
        } else {
            for e in self.edits.iter_mut().filter(|e| e.media_time >= 0) {
                e.media_time = (e.media_time - start as i64).max(0);
            }
        }
    }
}

fn io(e: std::io::Error) -> String {
    format!("读不了视频文件：{e}")
}

pub fn tracks(path: &Path) -> Result<Vec<Track>, String> {
    let mut file = File::open(path).map_err(io)?;
    let len = file.metadata().map_err(io)?.len();
    let mut tracks: Option<Vec<Track>> = None;
    let mut pos = 0;
    while pos + 8 <= len {
        let (typ, header, size) = header_at(&mut file, pos, len)?;
        if &typ == b"moov" || &typ == b"moof" {
            if size - header > MAX_HEADER {
                return Err(bad("盒子太大"));
            }
            let mut body = vec![0; (size - header) as usize];
            file.read_exact(&mut body).map_err(io)?;
            match (&typ, &mut tracks) {
                (b"moov", _) => tracks = Some(moov(&body)?),
                (_, Some(tracks)) => fragment(&body, pos, tracks)?,
                (_, None) => return Err(bad("moof 在 moov 前面")),
            }
        }
        pos += size;
    }
    let mut tracks = tracks.ok_or_else(|| bad("没有 moov"))?;
    for t in &mut tracks {
        if t.samples
            .iter()
            .any(|s| s.offset.saturating_add(s.size as u64) > len)
        {
            return Err(bad("文件不完整"));
        }
        t.finish();
    }
    Ok(tracks)
}

/// A box's type, header length and size, at `pos` in the file.
fn header_at(file: &mut File, pos: u64, len: u64) -> Result<([u8; 4], u64, u64), String> {
    let mut h = [0; 16];
    let n = (len - pos).min(16) as usize;
    file.seek(SeekFrom::Start(pos)).map_err(io)?;
    file.read_exact(&mut h[..n]).map_err(io)?;
    let mut c = Cur::new(&h[..n]);
    let small = c.u32()?;
    let typ = c.take(4)?.try_into().unwrap();
    let (header, size) = match small {
        0 => (8, len - pos),
        1 => (16, c.u64()?),
        n => (8, n as u64),
    };
    if size < header || size > len - pos {
        return Err(bad("盒子的大小不对"));
    }
    file.seek(SeekFrom::Start(pos + header)).map_err(io)?;
    Ok((typ, header, size))
}

fn moov(body: &[u8]) -> Result<Vec<Track>, String> {
    let kids = boxes(body)?;
    let mut c = Cur::new(need(&kids, b"mvhd")?.body);
    let (v, _) = c.version_flags()?;
    c.skip(if v == 1 { 16 } else { 8 })?;
    let movie_timescale = c.u32()?;
    let mut tracks = kids
        .iter()
        .filter(|b| &b.typ == b"trak")
        .map(|b| trak(b.body, movie_timescale))
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(mvex) = find(&kids, b"mvex") {
        for trex in boxes(mvex.body)?.iter().filter(|b| &b.typ == b"trex") {
            let mut c = Cur::new(trex.body);
            c.version_flags()?;
            let id = c.u32()?;
            let defaults = [c.u32()?, c.u32()?, c.u32()?, c.u32()?];
            if let Some(t) = tracks.iter_mut().find(|t| t.id == id) {
                t.defaults = defaults;
            }
        }
    }
    Ok(tracks)
}

fn trak(body: &[u8], movie_timescale: u32) -> Result<Track, String> {
    let kids = boxes(body)?;
    let mut c = Cur::new(need(&kids, b"tkhd")?.body);
    let (v, tkhd_flags) = c.version_flags()?;
    c.skip(if v == 1 { 16 } else { 8 })?;
    let id = c.u32()?;
    c.skip(4)?;
    c.sized(v)?;
    let tkhd_tail = c.take(60)?.to_vec();
    let edits = match find(&kids, b"edts") {
        Some(edts) => edit_list(edts.body)?,
        None => Vec::new(),
    };
    let mdia = boxes(need(&kids, b"mdia")?.body)?;
    let mut c = Cur::new(need(&mdia, b"mdhd")?.body);
    let (v, _) = c.version_flags()?;
    c.skip(if v == 1 { 16 } else { 8 })?;
    let timescale = c.u32()?;
    c.sized(v)?;
    let language = c.u16()?;
    if timescale == 0 {
        return Err(bad("timescale 是 0"));
    }
    let mut c = Cur::new(need(&mdia, b"hdlr")?.body);
    c.skip(8)?;
    let handler = c.take(4)?.try_into().unwrap();
    let minf = boxes(need(&mdia, b"minf")?.body)?;
    let stbl = boxes(need(&minf, b"stbl")?.body)?;
    let samples = table(&stbl)?;
    Ok(Track {
        id,
        handler,
        tkhd_flags,
        tkhd_tail,
        timescale,
        language,
        mdia_rest: all_but(&mdia, &[b"mdhd", b"minf"]),
        minf_rest: all_but(&minf, &[b"stbl"]),
        stsd: need(&stbl, b"stsd")?.raw.to_vec(),
        movie_timescale,
        edits,
        defaults: [1, 0, 0, 0],
        start: (!samples.is_empty()).then_some(0),
        end: samples.iter().map(|s| s.duration as u64).sum(),
        samples,
    })
}

fn all_but(kids: &[Bx], leave: &[&[u8; 4]]) -> Vec<u8> {
    let kept = kids.iter().filter(|b| !leave.contains(&&b.typ));
    kept.flat_map(|b| b.raw.iter().copied()).collect()
}

fn edit_list(edts: &[u8]) -> Result<Vec<Edit>, String> {
    let kids = boxes(edts)?;
    let Some(elst) = find(&kids, b"elst") else {
        return Ok(Vec::new());
    };
    entries(elst, |c, v| {
        Ok(Edit {
            duration: c.sized(v)?,
            media_time: if v == 1 {
                c.u64()? as i64
            } else {
                c.u32()? as i32 as i64
            },
            rate: c.u32()?,
        })
    })
}
