//! The WAV files takes and readings are kept in: 16-bit at `RATE`. One
//! channel when the original and you come one after the other (听完再说,
//! 自己读), so the file is half the size; two (left the original, right you)
//! when they overlap (边听边说, 跟着原文读). Read back, a one-channel file
//! gives the same samples for both lanes, and each voice is played from where
//! it is in the file.

use super::take::RATE;

/// Lanes `l` (the original) and `r` (you) as a file: their sum in one channel
/// when `apart` (they never overlap), else stereo.
pub fn encode(l: &[f32], r: &[f32], apart: bool) -> Vec<u8> {
    if apart {
        let sum: Vec<f32> = (0..l.len().max(r.len()))
            .map(|i| l.get(i).unwrap_or(&0.0) + r.get(i).unwrap_or(&0.0))
            .collect();
        pcm(&[&sum])
    } else {
        stereo_wav(l, r)
    }
}

/// 16-bit stereo WAV at `RATE`: left `l`, right `r` (the shorter one padded).
pub fn stereo_wav(l: &[f32], r: &[f32]) -> Vec<u8> {
    pcm(&[l, r])
}

fn pcm(channels: &[&[f32]]) -> Vec<u8> {
    let ch = channels.len() as u32;
    let frames = channels.iter().map(|c| c.len()).max().unwrap_or(0);
    let data_len = frames as u32 * 2 * ch;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&(ch as u16).to_le_bytes());
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2 * ch).to_le_bytes());
    out.extend_from_slice(&(2 * ch as u16).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    let sample = |x: Option<&f32>| {
        ((x.copied().unwrap_or(0.0).clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes()
    };
    for i in 0..frames {
        for c in channels {
            out.extend_from_slice(&sample(c.get(i)));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::decode::Decoder;

    fn decode(bytes: &[u8]) -> (usize, Vec<f32>) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.wav");
        std::fs::write(&path, bytes).unwrap();
        let mut d = Decoder::open(&path).unwrap();
        assert_eq!(d.sample_rate, RATE);
        let mut buf = vec![0.0; 64 * d.channels];
        let n = d.read(&mut buf).unwrap();
        buf.truncate(n * d.channels);
        (d.channels, buf)
    }

    #[test]
    fn one_after_the_other_is_one_channel() {
        let (l, r) = ([0.5, 0.5, 0.0, 0.0], [0.0, 0.0, -0.25, -0.25]);
        let mono = encode(&l, &r, true);
        let (ch, s) = decode(&mono);
        assert_eq!(ch, 1);
        assert!((s[0] - 0.5).abs() < 1e-3 && (s[3] + 0.25).abs() < 1e-3);
        let (ch, s) = decode(&encode(&l, &r, false));
        assert_eq!(ch, 2);
        assert!((s[0] - 0.5).abs() < 1e-3 && s[1].abs() < 1e-3 && (s[7] + 0.25).abs() < 1e-3);
        assert_eq!(
            mono.len() - 44,
            (encode(&l, &r, false).len() - 44) / 2,
            "half the size"
        );
    }
}
