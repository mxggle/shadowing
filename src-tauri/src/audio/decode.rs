//! Symphonia decoder: probe, sample-accurate seek, interleaved f32 output
//! (mono stays mono, everything else is mixed to stereo). Streams packet by
//! packet, so hour-long files never sit in memory. Never panics on bad input:
//! symphonia calls are wrapped in `catch_unwind` and turned into errors.

use std::fs::File;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{self, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::TimeBase;

pub const ERR_OPEN: &str = "无法打开此文件";
pub const ERR_FORMAT: &str = "无法识别此音频文件";
pub const ERR_CODEC: &str = "无法解码此文件";

/// Decoded-but-discarded lead-in before a seek target, so MDCT codecs (AAC,
/// MP3) have warmed up by the time the requested frame comes out.
const SEEK_PREROLL_SECS: f64 = 0.25;
const MAX_BAD_PACKETS: u32 = 64;

pub struct Decoder {
    path: PathBuf,
    format: Box<dyn FormatReader>,
    codec: Box<dyn codecs::Decoder>,
    track_id: u32,
    time_base: Option<TimeBase>,
    pub sample_rate: u32,
    /// Output channels (1 or 2).
    pub channels: usize,
    /// Duration in frames, if the container knows it.
    pub frames: Option<u64>,
    pending: Vec<f32>,
    pending_off: usize,
    /// Source frame of `pending[pending_off]`.
    next_frame: u64,
    resync: bool,
    sample_buf: Option<SampleBuffer<f32>>,
    eof: bool,
}

fn guard<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| Err(ERR_CODEC.to_string()))
}

impl Decoder {
    pub fn open(path: &Path) -> Result<Self, String> {
        guard(|| Self::open_inner(path))
    }

    fn open_inner(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|_| ERR_OPEN.to_string())?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let opts = FormatOptions {
            enable_gapless: true,
            ..Default::default()
        };
        let format = symphonia::default::get_probe()
            .format(&hint, mss, &opts, &MetadataOptions::default())
            .map_err(|_| ERR_FORMAT.to_string())?
            .format;
        let track = format
            .tracks()
            .iter()
            .find(|t| {
                t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_some()
            })
            .ok_or_else(|| ERR_FORMAT.to_string())?;
        let params = track.codec_params.clone();
        let track_id = track.id;
        let codec = symphonia::default::get_codecs()
            .make(&params, &DecoderOptions::default())
            .map_err(|_| ERR_CODEC.to_string())?;
        let sample_rate = params.sample_rate.unwrap_or(0);
        if sample_rate == 0 {
            return Err(ERR_FORMAT.to_string());
        }
        let mut dec = Decoder {
            path: path.to_path_buf(),
            format,
            codec,
            track_id,
            time_base: params.time_base,
            sample_rate,
            channels: 0, // set from the first decoded packet
            frames: None,
            pending: Vec::new(),
            pending_off: 0,
            next_frame: 0,
            resync: true,
            sample_buf: None,
            eof: false,
        };
        dec.frames = params.n_frames.map(|n| dec.ts_to_frame(n));
        // Decode the first packet now: proves the codec works and pins the real
        // channel count before anyone sizes buffers from it.
        if !dec.decode_next()? {
            return Err(ERR_CODEC.to_string());
        }
        Ok(dec)
    }

    fn ts_to_frame(&self, ts: u64) -> u64 {
        match self.time_base {
            Some(tb) if tb.denom != 0 => {
                (ts as u128 * tb.numer as u128 * self.sample_rate as u128 / tb.denom as u128) as u64
            }
            _ => ts,
        }
    }

    fn frame_to_ts(&self, frame: u64) -> u64 {
        match self.time_base {
            Some(tb) if tb.numer != 0 => {
                (frame as u128 * tb.denom as u128 / (tb.numer as u128 * self.sample_rate as u128))
                    as u64
            }
            _ => frame,
        }
    }

    fn pending_frames(&self) -> usize {
        (self.pending.len() / self.channels.max(1)).saturating_sub(self.pending_off)
    }

    /// Decodes the next packet into `pending`. Ok(false) at end of stream.
    fn decode_next(&mut self) -> Result<bool, String> {
        let mut bad = 0;
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(Error::IoError(_)) | Err(Error::ResetRequired) => {
                    self.eof = true;
                    return Ok(false);
                }
                Err(_) => {
                    bad += 1;
                    if bad > MAX_BAD_PACKETS {
                        return Err(ERR_CODEC.to_string());
                    }
                    continue;
                }
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            let start = self.ts_to_frame(packet.ts());
            let decoded = match self.codec.decode(&packet) {
                Ok(buf) => buf,
                Err(Error::DecodeError(_)) | Err(Error::IoError(_)) => {
                    bad += 1;
                    if bad > MAX_BAD_PACKETS {
                        return Err(ERR_CODEC.to_string());
                    }
                    continue;
                }
                Err(_) => return Err(ERR_CODEC.to_string()),
            };
            let spec = *decoded.spec();
            let n = decoded.frames();
            if n == 0 {
                continue;
            }
            if self
                .sample_buf
                .as_ref()
                .is_none_or(|b| b.capacity() < n * spec.channels.count())
            {
                self.sample_buf = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
            }
            let sb = self.sample_buf.as_mut().expect("allocated above");
            sb.copy_interleaved_ref(decoded);
            let src_ch = spec.channels.count().max(1);
            if self.channels == 0 {
                self.channels = src_ch.min(2);
            }
            if self.pending_off > 0 {
                self.pending.drain(..self.pending_off * self.channels);
                self.pending_off = 0;
            }
            if self.resync {
                self.next_frame = start;
                self.resync = false;
            }
            downmix(
                &sb.samples()[..n * src_ch],
                src_ch,
                self.channels,
                &mut self.pending,
            );
            return Ok(true);
        }
    }

    /// Fills `out` (interleaved, `channels`) and returns frames written; fewer
    /// than requested only at end of stream.
    pub fn read(&mut self, out: &mut [f32]) -> Result<usize, String> {
        guard(|| {
            let want = out.len() / self.channels;
            let mut done = 0;
            while done < want {
                if self.pending_frames() == 0 {
                    self.pending.clear();
                    self.pending_off = 0;
                    if self.eof || !self.decode_next()? {
                        break;
                    }
                    continue;
                }
                let k = (want - done).min(self.pending_frames());
                let src = self.pending_off * self.channels;
                out[done * self.channels..(done + k) * self.channels]
                    .copy_from_slice(&self.pending[src..src + k * self.channels]);
                self.pending_off += k;
                self.next_frame += k as u64;
                done += k;
            }
            Ok(done)
        })
    }

    /// Positions the decoder so the next `read` returns exactly frame `target`.
    pub fn seek(&mut self, target: u64) -> Result<(), String> {
        guard(|| self.seek_inner(target))
    }

    fn seek_inner(&mut self, target: u64) -> Result<(), String> {
        // Accurate mode everywhere: MP3 coarse seeks estimate timestamps from
        // byte offsets and land up to a frame (CBR) or tens of ms (VBR) off.
        let preroll = (self.sample_rate as f64 * SEEK_PREROLL_SECS) as u64;
        let to = SeekTo::TimeStamp {
            ts: self.frame_to_ts(target.saturating_sub(preroll)),
            track_id: self.track_id,
        };
        let landed = self
            .format
            .seek(SeekMode::Accurate, to)
            .ok()
            .map(|s| self.ts_to_frame(s.actual_ts));
        self.codec.reset();
        self.pending.clear();
        self.pending_off = 0;
        self.eof = false;
        self.resync = true;
        if landed.is_none_or(|l| l > target) {
            // Seek unsupported or overshot: decode forward from the very start.
            *self = Self::open_inner(&self.path.clone())?;
        }
        // Decode and discard up to the exact frame.
        loop {
            if self.pending_frames() == 0 {
                self.pending.clear();
                self.pending_off = 0;
                if !self.decode_next()? {
                    return Ok(()); // target beyond the end: reads return EOF
                }
            }
            let end = self.next_frame + self.pending_frames() as u64;
            if end > target {
                let skip = target.saturating_sub(self.next_frame) as usize;
                self.pending_off += skip;
                self.next_frame += skip as u64;
                return Ok(());
            }
            self.next_frame = end;
            self.pending_off += self.pending_frames();
        }
    }
}

/// Appends `src` (interleaved, `src_ch`) as `out_ch` (1 or 2) channels.
fn downmix(src: &[f32], src_ch: usize, out_ch: usize, out: &mut Vec<f32>) {
    match (src_ch, out_ch) {
        (a, b) if a == b => out.extend_from_slice(src),
        (1, _) => src.iter().for_each(|&s| out.extend_from_slice(&[s, s])),
        (_, 1) => out.extend(
            src.chunks(src_ch)
                .map(|f| f.iter().sum::<f32>() / src_ch as f32),
        ),
        _ => {
            // FL, FR, FC, ... (symphonia channel order): keep dialogue from the centre.
            for f in src.chunks(src_ch) {
                let c = f[2] * std::f32::consts::FRAC_1_SQRT_2;
                let norm = 1.0 / (1.0 + std::f32::consts::FRAC_1_SQRT_2);
                out.extend_from_slice(&[(f[0] + c) * norm, (f[1] + c) * norm]);
            }
        }
    }
}
