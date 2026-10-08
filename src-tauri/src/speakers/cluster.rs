//! Voice fingerprints → speakers. Longer sentences are grouped bottom-up
//! (average linkage on cosine similarity); every sentence then goes to the
//! closest group. Groups with too little speech are noise, not speakers.

/// Two groups whose average similarity is at least this are one voice. Tuned on
/// Japanese textbook dialogues: the same voice scores about 0.6–0.85, a man and
/// a woman 0.1–0.4, two men or two women 0.3–0.5.
const SAME_VOICE: f32 = 0.5;
/// Shorter sentences give shaky fingerprints: they join a group but don't form one.
const RELIABLE_SECS: f64 = 2.0;
/// A group needs this much speech to be a speaker of its own.
const MIN_SPEAKER_SECS: f64 = 4.0;
const MIN_SPEAKER_SHARE: f64 = 0.02;
/// Grouping is cubic; beyond this many sentences an even sample is grouped.
const MAX_GROUPED: usize = 400;

/// One fingerprint (or none, for a sentence too short to measure) and the
/// length in seconds per sentence → a speaker per sentence, numbered by first
/// appearance. All `None` when only one voice is heard.
pub fn assign(voices: &[Option<Vec<f32>>], secs: &[f64]) -> Vec<Option<u8>> {
    let voices: Vec<Option<Vec<f32>>> = voices.iter().map(|v| v.as_deref().map(unit)).collect();
    let reliable: Vec<usize> = (0..voices.len())
        .filter(|&i| voices[i].is_some() && secs[i] >= RELIABLE_SECS)
        .collect();
    let stride = reliable.len().div_ceil(MAX_GROUPED).max(1);
    let sample: Vec<usize> = reliable.into_iter().step_by(stride).collect();
    let fingerprints: Vec<&[f32]> = sample
        .iter()
        .map(|&i| voices[i].as_deref().unwrap())
        .collect();

    let groups = group(&fingerprints, SAME_VOICE);
    let speech = |g: &Vec<usize>| g.iter().map(|&k| secs[sample[k]]).sum::<f64>();
    let total: f64 = groups.iter().map(speech).sum();
    let centres: Vec<Vec<f32>> = groups
        .iter()
        .filter(|g| speech(g) >= MIN_SPEAKER_SECS.max(MIN_SPEAKER_SHARE * total))
        .map(|g| {
            let mut sum = vec![0f32; fingerprints[0].len()];
            for &k in g {
                sum.iter_mut()
                    .zip(fingerprints[k])
                    .for_each(|(s, v)| *s += v);
            }
            unit(&sum)
        })
        .collect();
    if centres.len() < 2 {
        return vec![None; voices.len()];
    }

    let closest: Vec<Option<usize>> = voices
        .iter()
        .map(|v| {
            let v = v.as_deref()?;
            (0..centres.len()).max_by(|&a, &b| dot(v, &centres[a]).total_cmp(&dot(v, &centres[b])))
        })
        .collect();
    // Too short to measure: most likely whoever spoke just before (or just after).
    let filled: Vec<Option<usize>> = (0..closest.len())
        .map(|i| {
            closest[i]
                .or_else(|| closest[..i].iter().rev().find_map(|c| *c))
                .or_else(|| closest[i..].iter().find_map(|c| *c))
        })
        .collect();

    let mut order: Vec<usize> = Vec::new();
    for c in filled.iter().flatten() {
        if !order.contains(c) {
            order.push(*c);
        }
    }
    if order.len() < 2 {
        return vec![None; voices.len()];
    }
    filled
        .iter()
        .map(|c| {
            c.and_then(|c| order.iter().position(|&o| o == c))
                .map(|n| n as u8)
        })
        .collect()
}

/// Agglomerative grouping: keep merging the most similar pair of groups
/// (average pairwise similarity) while it is at least `threshold`.
fn group(v: &[&[f32]], threshold: f32) -> Vec<Vec<usize>> {
    let n = v.len();
    let mut sim: Vec<Vec<f32>> = (0..n)
        .map(|i| (0..n).map(|j| dot(v[i], v[j])).collect())
        .collect();
    let mut members: Vec<Vec<usize>> = (0..n).map(|i| vec![i]).collect();
    loop {
        let mut best: Option<(usize, usize)> = None;
        let mut best_sim = threshold;
        for i in 0..n {
            if members[i].is_empty() {
                continue;
            }
            for j in i + 1..n {
                if !members[j].is_empty() && sim[i][j] >= best_sim {
                    best_sim = sim[i][j];
                    best = Some((i, j));
                }
            }
        }
        let Some((i, j)) = best else { break };
        let (wi, wj) = (members[i].len() as f32, members[j].len() as f32);
        let merged: Vec<f32> = sim[i]
            .iter()
            .zip(&sim[j])
            .map(|(a, b)| (wi * a + wj * b) / (wi + wj))
            .collect();
        for (k, s) in merged.into_iter().enumerate() {
            sim[i][k] = s;
            sim[k][i] = s;
        }
        let moved = std::mem::take(&mut members[j]);
        members[i].extend(moved);
    }
    members.into_iter().filter(|m| !m.is_empty()).collect()
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn unit(v: &[f32]) -> Vec<f32> {
    let norm = dot(v, v).sqrt().max(1e-9);
    v.iter().map(|x| x / norm).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A voice: a direction, plus a little per-sentence wobble.
    fn voice(base: usize, wobble: usize) -> Option<Vec<f32>> {
        let mut v = vec![0.0; 8];
        v[base] = 1.0;
        v[4 + wobble % 4] = 0.3;
        Some(v)
    }

    #[test]
    fn a_dialogue_alternates_between_two_speakers() {
        let voices = [
            voice(1, 0),
            voice(0, 1),
            voice(1, 2),
            voice(0, 3),
            voice(1, 4),
        ];
        let secs = [3.0; 5];
        assert_eq!(
            assign(&voices, &secs),
            [Some(0), Some(1), Some(0), Some(1), Some(0)]
        );
    }

    #[test]
    fn one_voice_means_no_labels() {
        let voices = [voice(2, 0), voice(2, 1), voice(2, 2)];
        assert_eq!(assign(&voices, &[3.0; 3]), [None, None, None]);
    }

    #[test]
    fn short_sentences_join_a_speaker_without_forming_one() {
        // The 0.5 s sentence sounds a bit like the first voice, mostly like nobody:
        // too short to be a new speaker.
        let odd = Some(vec![0.5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
        let voices = [
            voice(0, 0),
            voice(1, 0),
            odd,
            voice(0, 1),
            None,
            voice(1, 1),
        ];
        let secs = [3.0, 3.0, 0.5, 3.0, 0.2, 3.0];
        assert_eq!(
            assign(&voices, &secs),
            [Some(0), Some(1), Some(0), Some(0), Some(0), Some(1)]
        );
    }

    #[test]
    fn a_voice_heard_for_a_moment_is_not_a_speaker() {
        // Three seconds of a third voice in a minute of dialogue: below MIN_SPEAKER_SECS.
        let mut voices = vec![];
        let mut secs = vec![];
        for k in 0..10 {
            voices.push(voice(k % 2, k));
            secs.push(6.0);
        }
        voices.push(voice(2, 0));
        secs.push(3.0);
        let got = assign(&voices, &secs);
        assert_eq!(got.iter().flatten().max(), Some(&1));
    }
}
