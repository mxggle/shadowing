//! whisper.cpp on this Mac (GPU via Metal). Produces the same Whisper-style
//! output as the cloud APIs, with words built from token times, so the same
//! sentence builder works for both.

use crate::transcribe::sentences::{Segment, Verbose, Word};
use crate::transcribe::{Piece, PieceProgress, Transcriber, CANCELLED};
use std::ffi::c_void;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

pub struct Whisper {
    ctx: WhisperContext,
}

impl Whisper {
    pub fn load(file: &Path) -> Result<Self, String> {
        // Route whisper.cpp's chatty logging away from stdout/stderr.
        whisper_rs::install_logging_hooks();
        let params = WhisperContextParameters {
            use_gpu: true,
            flash_attn: true,
            ..Default::default()
        };
        let ctx = WhisperContext::new_with_params(file, params)
            .map_err(|e| format!("无法加载转写模型（文件可能已损坏，可以删除后重新下载）：{e}"))?;
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
            return Err(CANCELLED.into());
        }
        result.map_err(|e| format!("本机转写失败：{e}"))?;
        collect(&self.ctx, &state)
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
        let seg = state.get_segment(i).ok_or("本机转写结果不完整")?;
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
            tokens.push((bytes, data.t0, data.t1));
        }
        let n = tokens.len();
        out.words.extend(words_from_tokens(tokens));
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

/// Tokens can split a character (most CJK characters are 3 bytes); glue bytes
/// together until they form valid text, timing the result from first to last token.
fn words_from_tokens(tokens: Vec<(Vec<u8>, i64, i64)>) -> Vec<Word> {
    let mut words = Vec::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut start = 0;
    for (bytes, t0, t1) in tokens {
        if pending.is_empty() {
            start = t0;
        }
        pending.extend_from_slice(&bytes);
        if let Ok(text) = std::str::from_utf8(&pending) {
            words.push(Word {
                word: text.to_string(),
                start: secs(start),
                end: secs(t1.max(start)),
            });
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
        let tokens = vec![
            (b" Hello".to_vec(), 10, 40),
            (ni[..2].to_vec(), 50, 60),
            (ni[2..].to_vec(), 60, 70),
            ("本".as_bytes().to_vec(), 70, 80),
        ];
        let words = words_from_tokens(tokens);
        let got: Vec<_> = words
            .iter()
            .map(|w| (w.word.as_str(), w.start, w.end))
            .collect();
        assert_eq!(
            got,
            [(" Hello", 0.1, 0.4), ("日", 0.5, 0.7), ("本", 0.7, 0.8)]
        );
    }
}
