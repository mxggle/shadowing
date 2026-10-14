use super::*;
use crate::audio::tap::Mark;
use crate::record::Sentence;
use crate::transcribe::pcm::Pcm16k;
use std::path::PathBuf;

const MIC: u32 = 48_000;

fn sample() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("samples/ja/ごんぎつね.mp3")
}

/// The sample's speech, `from`..`to` seconds, at `rate`.
fn speech(from: f64, to: f64, rate: u32) -> Vec<f32> {
    let mut pcm = Pcm16k::open(&sample()).unwrap();
    let mut buf = Vec::new();
    while pcm.read_into(&mut buf).unwrap() && buf.len() < (to * 16_000.0) as usize {}
    convert(
        &buf[(from * 16_000.0) as usize..(to * 16_000.0) as usize],
        16_000,
        rate,
    )
}

fn meta(mode: Mode, sentences: &[(f64, f64)]) -> Meta {
    Meta {
        audio: sample().to_string_lossy().into(),
        start: sentences[0].0,
        end: sentences[sentences.len() - 1].1,
        text: String::new(),
        mode,
        rate: 1.0,
        sentences: sentences
            .iter()
            .map(|&(start, end)| Sentence {
                start,
                end,
                text: format!("{start}"),
            })
            .collect(),
    }
}

fn raw(mic: Vec<f32>, marks: Vec<Mark>, played: Vec<f32>) -> Raw {
    Raw {
        mic,
        mic_rate: MIC,
        mic_at: 1_000_000_000,
        marks,
        played,
        turn: 0,
        hints: vec![],
    }
}

#[test]
fn reading_on_your_own_is_cut_into_its_sentences() {
    // Three stretches of the sample's speech "read" with pauses between them, quieter than the original.
    let spans = [(1.0, 3.0), (3.0, 4.5), (4.5, 7.0)];
    let mut mic = vec![0.0f32; MIC as usize / 2];
    let mut said = Vec::new();
    for &(a, b) in &spans {
        let start = mic.len();
        mic.extend(speech(a, b, MIC).iter().map(|v| v * 0.4));
        said.push((start as f64 / MIC as f64, mic.len() as f64 / MIC as f64));
        mic.extend(vec![0.0; MIC as usize * 7 / 10]);
    }
    // A little room noise, so the silence isn't digital.
    mic.iter_mut()
        .enumerate()
        .for_each(|(i, v)| *v += ((i * 7919) % 200) as f32 * 1e-6);
    // The sample has its own quiet at the edges of these stretches: expect the voice, not the stretch.
    let voiced = vad::voiced(&take::levels(&convert(&mic, MIC, RATE)));
    let said: Vec<(f64, f64)> = said
        .iter()
        .map(|&(a, b)| {
            let (fa, fb) = ((a / FRAME_SECS) as usize, (b / FRAME_SECS) as usize);
            let first = (fa..fb).find(|&i| voiced[i]).unwrap();
            let last = (fa..fb).rev().find(|&i| voiced[i]).unwrap() + 1;
            (first as f64 * FRAME_SECS, last as f64 * FRAME_SECS)
        })
        .collect();
    let built = build(
        &raw(mic, vec![], vec![]),
        &meta(Mode::Read, &spans),
        &sample(),
        "r",
        5,
    )
    .unwrap();
    assert_eq!(built.takes.len(), 3);
    assert_eq!(built.reading.parts.len(), 3);
    for (i, p) in built.reading.parts.iter().enumerate() {
        // Where it was found, against where it was said (the whole file starts 0.25 s before the first word).
        let off = said[0].0 - LEAD_SECS - MARGIN_SECS;
        assert!(
            (p.mine.0 + off - said[i].0).abs() < 0.05,
            "sentence {i} starts {} vs {}",
            p.mine.0 + off,
            said[i].0
        );
        assert!(
            (p.mine.1 + off - said[i].1).abs() < 0.05,
            "sentence {i} ends {} vs {}",
            p.mine.1 + off,
            said[i].1
        );
        assert_eq!(p.take.as_deref(), Some(format!("r-{i}").as_str()));
    }
    // Each sentence's take: the original from the file first, then you, with the text kept.
    let (t, (l, r)) = &built.takes[1];
    assert_eq!(t.group.as_deref(), Some("r"));
    assert_eq!(t.text, "3");
    assert!((t.original.1 - t.original.0 - 1.5).abs() < 0.01);
    assert!(t.mine.0 > t.original.1);
    assert_eq!(l.len(), r.len());
    assert!((built.reading.original_secs - 6.0).abs() < 0.01);
}

#[test]
fn shadowing_a_paragraph_follows_the_original() {
    // The original (three sentences, 1–7 s of the sample) played from 0.5 s on the mic's
    // timeline; you say the same words 0.4 s behind, its echo also on the mic.
    let spans = [(1.0, 3.0), (3.0, 4.5), (4.5, 7.0)];
    let original = speech(1.0, 7.0, MIC);
    let mic_at = 1_000_000_000u64;
    let start = MIC as usize / 2;
    let marks: Vec<Mark> = original
        .chunks(512)
        .enumerate()
        .map(|(i, c)| Mark {
            at: mic_at + 500_000_000 + i as u64 * 512 * 1_000_000_000 / MIC as u64,
            frames: c.len() as u32,
            rate: MIC,
        })
        .collect();
    let lag = MIC as usize * 4 / 10;
    let mut mic = vec![0.0f32; start + original.len() + MIC as usize * 2];
    for (i, v) in original.iter().enumerate() {
        mic[start + 1200 + i] += v * 0.3;
        mic[start + lag + i] += v * 0.25;
    }
    let built = build(
        &raw(mic, marks, original),
        &meta(Mode::Shadow, &spans),
        &sample(),
        "s",
        5,
    )
    .unwrap();
    assert_eq!(built.takes.len(), 3);
    let lag_ms = built.reading.lag_ms.unwrap();
    assert!((lag_ms - 400).abs() <= 30, "lag {lag_ms}");
    for (t, _) in &built.takes {
        // Your part of each sentence starts about the lag after its original part.
        let behind = (t.mine.0 + LEAD_SECS) - t.original.0;
        assert!(
            behind > 0.1 && behind < 0.8,
            "{}: you {behind:.2} s behind",
            t.text
        );
    }
    assert!((built.reading.original_secs - 6.0).abs() < 0.01);
    assert_eq!(built.whole.0.len(), built.whole.1.len());
}
