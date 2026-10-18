//! whisper.cpp on this Mac (GPU via Metal). Produces the same Whisper-style
//! output as the cloud APIs, with words built from token times, so the same
//! sentence builder works for both. Token times come from DTW over the
//! model's alignment heads (as the cloud APIs do): plain token times put the
//! first word of a turn where the previous one ended, up to a second early.

use crate::transcribe::pcm::RATE;
use crate::transcribe::sentences::{Segment, Verbose, Word};
use crate::transcribe::{cancelled_error, Piece, PieceProgress, Transcriber};
use std::ffi::c_void;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use whisper_rs::{
    DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext,
    WhisperContextParameters, WhisperState,
};

pub struct Whisper {
    ctx: WhisperContext,
}

impl Whisper {
    /// `model`: its id in `models.rs`, which picks the alignment heads for DTW.
    pub fn load(file: &Path, model: &str) -> Result<Self, String> {
        // Route whisper.cpp's chatty logging away from stdout/stderr.
        whisper_rs::install_logging_hooks();
        let preset = match model {
            m if m.starts_with("large-v3-turbo") => Some(DtwModelPreset::LargeV3Turbo),
            m if m.starts_with("large-v3") => Some(DtwModelPreset::LargeV3),
            m if m.starts_with("small") => Some(DtwModelPreset::Small),
            _ => None,
        };
        let params = WhisperContextParameters {
            use_gpu: true,
            // whisper.cpp can't do DTW with flash attention; ~25% slower, but
            // sentence loops start where the speech does.
            flash_attn: preset.is_none(),
            dtw_parameters: DtwParameters {
                mode: preset.map_or(DtwMode::None, |model_preset| DtwMode::ModelPreset {
                    model_preset,
                }),
                ..Default::default()
            },
            ..Default::default()
        };
        let ctx = WhisperContext::new_with_params(file, params)
            .map_err(|e| {
                tr!(
                    "无法加载转写模型（文件可能已损坏，可以删除后重新下载）：{e}",
                    "Couldn't load the transcription model (the file may be damaged; delete it and download it again): {e}"
                )
            })?;
        Ok(Self { ctx })
    }
}

fn threads() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get().min(8) as i32)
        .unwrap_or(4)
}

impl Transcriber for Whisper {
    fn transcribe(&mut self, piece: &Piece, progress: PieceProgress) -> Result<Verbose, String> {
        let mut state = self.ctx.create_state().map_err(|e| e.to_string())?;
        // Beam search is what whisper.cpp's own CLI uses; noticeably better for Japanese than greedy.
        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: 5,
            patience: -1.0,
        });
        params.set_language(Some(piece.language.unwrap_or("auto")));
        params.set_n_threads(threads());
        params.set_token_timestamps(true);
        // Context is carried by the prompt between pieces; inside a piece it feeds repetition loops.
        params.set_no_context(true);
        params.set_suppress_nst(true);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        if !piece.prompt.is_empty() {
            params.set_initial_prompt(piece.prompt);
        }
        params.set_progress_callback_safe(move |pct: i32| progress(f64::from(pct) / 100.0));
        // Not `set_abort_callback_safe`: in whisper-rs 0.16 its trampoline reads the
        // boxed closure as the wrong type and whisper.cpp aborts every encode.
        // SAFETY: the flag lives in the job's Arc, which outlives `state.full` below.
        unsafe {
            params.set_abort_callback(Some(should_abort));
            params.set_abort_callback_user_data(Arc::as_ptr(piece.cancel).cast_mut().cast());
        }

        let result = state.full(params, piece.samples);
        if piece.cancel.load(Ordering::Relaxed) {
            return Err(cancelled_error());
        }
        result.map_err(|e| tr!("本机转写失败：{e}", "Transcription on this Mac failed: {e}"))?;
        collect(&self.ctx, &state)
    }

    fn detect_language(&mut self, samples: &[f32]) -> Option<String> {
        // Whisper listens to the first 30 s to decide.
        let head = &samples[..samples.len().min(30 * RATE as usize)];
        let mut state = self.ctx.create_state().ok()?;
        state.pcm_to_mel(head, threads() as usize).ok()?;
        let (id, _) = state.lang_detect(0, threads() as usize).ok()?;
        whisper_rs::get_lang_str(id).map(str::to_string)
    }
}

unsafe extern "C" fn should_abort(flag: *mut c_void) -> bool {
    // SAFETY: set above to point at the job's AtomicBool.
    unsafe { (*(flag as *const AtomicBool)).load(Ordering::Relaxed) }
}

/// whisper.cpp times are in centiseconds.
fn secs(t: i64) -> f64 {
    t as f64 / 100.0
}

fn collect(ctx: &WhisperContext, state: &WhisperState) -> Result<Verbose, String> {
    let eot = ctx.token_eot();
    let mut out = Verbose::default();
    for i in 0..state.full_n_segments() {
        let seg = state.get_segment(i).ok_or(crate::i18n::pick(
            "本机转写结果不完整",
            "The transcription on this Mac came back incomplete.",
        ))?;
        let mut tokens = Vec::new();
        let mut logprob = 0.0;
        for k in 0..seg.n_tokens() {
            let Some(tok) = seg.get_token(k) else {
                continue;
            };
            // Ids from end-of-text up are timestamps and other special tokens.
            if tok.token_id() >= eot {
                continue;
            }
            let data = tok.token_data();
            logprob += f64::from(data.plog);
            let bytes = tok.to_bytes().map_err(|e| e.to_string())?.to_vec();
            // -1 when DTW is off for this model.
            let at = if data.t_dtw >= 0 { data.t_dtw } else { data.t0 };
            tokens.push(Token {
                bytes,
                at,
                p: data.p,
            });
        }
        let n = tokens.len();
        out.words
            .extend(words_from_tokens(tokens, seg.end_timestamp()));
        out.segments.push(Segment {
            start: secs(seg.start_timestamp()),
            end: secs(seg.end_timestamp()),
            text: seg.to_str_lossy().map_err(|e| e.to_string())?.into_owned(),
            avg_logprob: (n > 0).then(|| logprob / n as f64),
            no_speech_prob: Some(f64::from(seg.no_speech_probability())),
        });
    }
    Ok(out)
}

struct Token {
    bytes: Vec<u8>,
    /// Where it starts, in centiseconds.
    at: i64,
    /// How sure the model was of it, 0–1.
    p: f32,
}

/// Tokens → words lasting until the next one starts (the last until the
/// segment ends), as sure as their least sure token. Tokens can split a character
/// (most CJK characters are 3 bytes): bytes are glued together until they form valid text.
fn words_from_tokens(tokens: Vec<Token>, segment_end: i64) -> Vec<Word> {
    let mut words = Vec::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut start = 0;
    let mut last = 0;
    let mut p = 1.0f32;
    for (k, token) in tokens.iter().enumerate() {
        if pending.is_empty() {
            start = token.at.max(last);
            p = 1.0;
        }
        pending.extend_from_slice(&token.bytes);
        p = p.min(token.p);
        if let Ok(text) = std::str::from_utf8(&pending) {
            let end = tokens
                .get(k + 1)
                .map_or(segment_end, |next| next.at)
                .max(start);
            words.push(Word {
                word: text.to_string(),
                start: secs(start),
                end: secs(end),
                probability: Some(f64::from(p)),
            });
            last = end;
            pending.clear();
        }
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_characters_are_glued_back_together() {
        let ni = "日".as_bytes(); // 3 bytes, split across two tokens
        let token = |bytes: &[u8], at, p| Token {
            bytes: bytes.to_vec(),
            at,
            p,
        };
        let tokens = vec![
            token(b" Hello", 10, 0.9),
            token(&ni[..2], 50, 0.8),
            token(&ni[2..], 60, 0.3),
            token("本".as_bytes(), 70, 1.0),
        ];
        let words = words_from_tokens(tokens, 80);
        let got: Vec<_> = words
            .iter()
            .map(|w| {
                (
                    w.word.as_str(),
                    w.start,
                    w.end,
                    w.probability.unwrap() as f32,
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                (" Hello", 0.1, 0.5, 0.9),
                ("日", 0.5, 0.7, 0.3),
                ("本", 0.7, 0.8, 1.0)
            ]
        );
    }
}
