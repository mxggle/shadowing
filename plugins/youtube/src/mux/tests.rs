//! The merge, on small DASH files built the way YouTube writes them, and on
//! two tiny ones ffmpeg made (fixtures/: a 2-second test picture with B-frames,
//! and 2 seconds of a sine in AAC), opened afterwards the way the app opens audio:
//!
//! ffmpeg -f lavfi -i testsrc=size=64x36:rate=30:duration=2 -c:v libx264 -profile:v high -pix_fmt yuv420p -g 15 -x264-params bframes=2:b-adapt=0:scenecut=0 -crf 40 -movflags dash+frag_keyframe+empty_moov+default_base_moof -f mp4 dash-video.mp4
//! ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=2 -ac 2 -c:a aac -b:a 32k -movflags dash+frag_keyframe+empty_moov+default_base_moof -frag_duration 500000 -f mp4 dash-audio.m4a

use super::bytes::{boxes, rescale};
use super::read::{self, Edit};
use super::test_files::{dash, picture, sound};
use super::*;
use std::fs;
use std::path::PathBuf;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

fn save(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap();
    path
}

fn no_progress(_: u64, _: u64) -> Result<(), String> {
    Ok(())
}

#[test]
fn reads_youtube_fragments() {
    let dir = tempfile::tempdir().unwrap();
    let fragments = [
        (0, vec![(5, 1024, true), (3, 0, false), (4, 512, false)]),
        (1536, vec![(6, 1024, true), (2, 0, false)]),
    ];
    let bytes = dash(b"vide", 15360, 512, Some((10000, 1024)), &fragments);
    let tracks = read::tracks(&save(dir.path(), "v.mp4", &bytes)).unwrap();
    let t = &tracks[0];
    assert_eq!(
        (&t.handler, t.timescale, t.movie_timescale),
        (b"vide", 15360, 15360)
    );
    let edit = Edit {
        duration: 10000,
        media_time: 1024,
        rate: 0x10000,
    };
    assert_eq!(t.edits, [edit]);
    let got: Vec<_> = t
        .samples
        .iter()
        .map(|s| (s.size, s.duration, s.cto, s.sync))
        .collect();
    let want = [
        (5, 1024, true),
        (3, 0, false),
        (4, 512, false),
        (6, 1024, true),
        (2, 0, false),
    ];
    assert_eq!(got, want.map(|(size, cto, sync)| (size, 512, cto, sync)));
    for (k, s) in t.samples.iter().enumerate() {
        let data = &bytes[s.offset as usize..][..s.size as usize];
        assert!(data.iter().all(|b| *b == k as u8), "sample {k}");
    }
}

#[test]
fn fills_gaps_and_keeps_a_late_start() {
    let dir = tempfile::tempdir().unwrap();
    // Starts 2048 in, and the second fragment comes 1024 after the first one ends.
    let frames = vec![(4, 0, true); 3];
    let bytes = dash(
        b"soun",
        44100,
        1024,
        None,
        &[(2048, frames.clone()), (6144, frames)],
    );
    let t = &read::tracks(&save(dir.path(), "a.m4a", &bytes)).unwrap()[0];
    let durations: Vec<u32> = t.samples.iter().map(|s| s.duration).collect();
    assert_eq!(durations, [1024, 1024, 2048, 1024, 1024, 1024]);
    let edit = |duration, media_time| Edit {
        duration,
        media_time,
        rate: 0x10000,
    };
    assert_eq!(t.edits, [edit(2048, -1), edit(0, 0)]);
}

#[test]
fn merges_into_one_ordinary_mp4() {
    let dir = tempfile::tempdir().unwrap();
    let (video, audio) = (picture(3), sound(2));
    let v = save(dir.path(), "video.mp4", &video);
    let a = save(dir.path(), "audio.m4a", &audio);
    let out = dir.path().join("merged.mp4");
    merge(&v, &a, &out, &mut no_progress).unwrap();

    let merged = fs::read(&out).unwrap();
    let top = boxes(&merged).unwrap();
    let types: Vec<_> = top.iter().map(|b| &b.typ).collect();
    assert_eq!(types, [b"ftyp", b"moov", b"mdat"]);
    assert!(boxes(top[1].body)
        .unwrap()
        .iter()
        .all(|b| &b.typ != b"mvex"));

    let tracks = read::tracks(&out).unwrap();
    assert_eq!(tracks.len(), 2);
    let originals = [(&v, &video), (&a, &audio)];
    for (i, (m, (path, bytes))) in tracks.iter().zip(originals).enumerate() {
        let o = &read::tracks(path).unwrap()[0];
        assert_eq!(m.id, i as u32 + 1);
        assert_eq!(
            (m.handler, m.timescale, m.language),
            (o.handler, o.timescale, o.language)
        );
        assert_eq!(
            (&m.stsd, &m.minf_rest, &m.mdia_rest),
            (&o.stsd, &o.minf_rest, &o.mdia_rest)
        );
        assert_eq!(m.tkhd_tail, o.tkhd_tail);
        assert_eq!(m.samples.len(), o.samples.len());
        for (ms, os) in m.samples.iter().zip(&o.samples) {
            assert_eq!(
                (ms.size, ms.duration, ms.cto, ms.sync),
                (os.size, os.duration, os.cto, os.sync)
            );
            let at =
                |b: &[u8], s: &read::Sample| b[s.offset as usize..][..s.size as usize].to_vec();
            assert_eq!(at(&merged, ms), at(bytes, os));
        }
    }
    // The picture's edit (skipping the B-frames' delay) is kept, in the new timescale.
    let edit = Edit {
        duration: rescale(15 * 512 * 3, 15360, 1000),
        media_time: 1024,
        rate: 0x10000,
    };
    assert_eq!(tracks[0].edits, [edit]);
    assert_eq!(tracks[0].movie_timescale, 1000);
    assert!(tracks[1].edits.is_empty());
}

#[test]
fn interleaves_about_every_half_second() {
    let dir = tempfile::tempdir().unwrap();
    let v = read::tracks(&save(dir.path(), "v.mp4", &picture(4))).unwrap();
    let a = read::tracks(&save(dir.path(), "a.m4a", &sound(3))).unwrap();
    let order = chunks(&[&v[0], &a[0]]);
    assert!(order.windows(2).all(|w| w[0].at <= w[1].at));
    // Picture, sound, picture, sound… (a fragment of either is about half a second).
    let tracks: Vec<usize> = order.iter().map(|c| c.track).collect();
    assert_eq!(tracks, [0, 1, 0, 1, 0, 1, 0]);
    let counts: Vec<u32> = order.iter().map(|c| c.count).collect();
    assert_eq!(counts, [15, 22, 15, 22, 15, 22, 15]);
}

#[test]
fn refuses_what_it_cannot_merge() {
    let dir = tempfile::tempdir().unwrap();
    let v = save(dir.path(), "video.mp4", &picture(2));
    let a = save(dir.path(), "audio.m4a", &sound(2));
    let out = dir.path().join("merged.mp4");
    assert!(merge(&a, &a, &out, &mut no_progress)
        .unwrap_err()
        .contains("画面"));
    assert!(merge(&v, &v, &out, &mut no_progress)
        .unwrap_err()
        .contains("声音"));
    let junk = save(dir.path(), "junk.m4a", b"\0\0\0\x30moovnot really");
    assert!(merge(&v, &junk, &out, &mut no_progress)
        .unwrap_err()
        .contains("看不懂"));
    let whole = fs::read(&a).unwrap();
    let cut = save(dir.path(), "cut.m4a", &whole[..whole.len() - 10]);
    assert!(merge(&v, &cut, &out, &mut no_progress)
        .unwrap_err()
        .contains("看不懂"));
    assert!(!out.exists());
    // Cancelled halfway: nothing is left behind.
    let mut cancel = |done: u64, _| {
        if done > 0 {
            Err(crate::CANCELLED.to_string())
        } else {
            Ok(())
        }
    };
    assert_eq!(
        merge(&v, &a, &out, &mut cancel).unwrap_err(),
        crate::CANCELLED
    );
    assert!(!out.exists());
}

#[test]
fn wide_offsets_past_4_gb() {
    let dir = tempfile::tempdir().unwrap();
    let t = &read::tracks(&save(dir.path(), "a.m4a", &sound(1))).unwrap()[0];
    let moov = write::moov(&[t], &[vec![(5_000_000_000, 22)]], true);
    let mut body: &[u8] = &moov;
    for typ in [b"moov", b"trak", b"mdia", b"minf", b"stbl", b"co64"] {
        let kids = boxes(body).unwrap();
        body = kids.iter().find(|b| &b.typ == typ).unwrap().body;
    }
    assert_eq!(body[4..8], 1u32.to_be_bytes());
    assert_eq!(body[8..], 5_000_000_000u64.to_be_bytes());
}

/// Opens `path` the way the app does (src-tauri/src/audio/decode.rs: the first track
/// with a sample rate): the reader, that track's id, and a decoder for it.
fn open(path: &Path) -> (Box<dyn FormatReader>, u32, Box<dyn Decoder>) {
    let mss = MediaSourceStream::new(Box::new(File::open(path).unwrap()), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(path.extension().unwrap().to_str().unwrap());
    let opts = FormatOptions {
        enable_gapless: true,
        ..Default::default()
    };
    let probed = symphonia::default::get_probe().format(&hint, mss, &opts, &Default::default());
    let format = probed.unwrap().format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_some())
        .unwrap();
    let codecs = symphonia::default::get_codecs();
    let (id, decoder) = (
        track.id,
        codecs.make(&track.codec_params, &DecoderOptions::default()),
    );
    (format, id, decoder.unwrap())
}

/// Decodes all the sound: (track id, sample rate, frames).
pub(super) fn decode(path: &Path) -> (u32, u32, u64) {
    let (mut format, id, mut decoder) = open(path);
    let mut frames = 0;
    loop {
        match format.next_packet() {
            Ok(p) if p.track_id() == id => frames += decoder.decode(&p).unwrap().frames() as u64,
            Ok(_) => {}
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => panic!("{e}"),
        }
    }
    (id, decoder.codec_params().sample_rate.unwrap(), frames)
}

/// Seeks the way the app does and decodes from there: the second it landed on.
pub(super) fn seek(path: &Path, seconds: f64) -> f64 {
    let (mut format, id, mut decoder) = open(path);
    let to = SeekTo::Time {
        time: Time::from(seconds),
        track_id: Some(id),
    };
    let landed = format.seek(SeekMode::Accurate, to).unwrap();
    decoder.reset();
    let packet = std::iter::from_fn(|| format.next_packet().ok()).find(|p| p.track_id() == id);
    assert!(decoder.decode(&packet.unwrap()).unwrap().frames() > 0);
    landed.actual_ts as f64 / decoder.codec_params().sample_rate.unwrap() as f64
}

#[test]
fn merged_fixtures_play_in_the_apps_decoder() {
    let dir = tempfile::tempdir().unwrap();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    let (v, a) = (
        fixtures.join("dash-video.mp4"),
        fixtures.join("dash-audio.m4a"),
    );
    let out = dir.path().join("merged.mp4");
    merge(&v, &a, &out, &mut no_progress).unwrap();
    let tracks = read::tracks(&out).unwrap();
    let counts: Vec<_> = tracks.iter().map(|t| t.samples.len()).collect();
    assert_eq!(counts, [60, 88]);
    // The app's decoder skips the picture and takes the sound (symphonia counts tracks from 0).
    let (id, rate, frames) = decode(&out);
    assert_eq!((id, rate), (1, 44100));
    assert_eq!(frames, decode(&a).2);
    assert!(
        (frames as f64 / 44100.0 - 2.0).abs() < 0.1,
        "{frames} frames"
    );
    assert!((seek(&out, 1.2) - 1.2).abs() < 0.03);
}
