//! The default input device as mono samples in a lock-free ring, with the host
//! time of the first one (the same clock the output tap uses). The stream is
//! not `Send` on every platform, so it lives on the recorder's thread.

use crate::audio::output::{device_name, host_nanos};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig};
use rtrb::{Producer, RingBuffer};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Arc;

fn no_mic() -> &'static str {
    crate::i18n::pick("没有找到麦克风", "No microphone found")
}

/// Why the microphone didn't open. Windows refuses with "access denied" (0x80070005) when
/// desktop apps aren't allowed the microphone in its privacy settings; say where to allow it.
fn open_failed(e: impl std::fmt::Display) -> String {
    let e = e.to_string();
    if e.contains("80070005") {
        crate::i18n::pick(
            "Windows 不允许应用使用麦克风：请在“设置 → 隐私和安全性 → 麦克风”里打开“麦克风访问权限”和“允许桌面应用访问你的麦克风”，再试一次",
            "Windows isn't letting apps use the microphone. In Settings → Privacy & security → Microphone, turn on “Microphone access” and “Let desktop apps access your microphone”, then try again.",
        )
        .into()
    } else {
        tr!("麦克风打不开：{e}", "Couldn't open the microphone: {e}")
    }
}

pub struct Mic {
    pub stream: Stream,
    pub name: String,
    pub rate: u32,
    pub samples: rtrb::Consumer<f32>,
    /// Host time (ns) of the first sample; 0 until it arrives.
    pub first_at: Arc<AtomicU64>,
    pub failed: Arc<AtomicBool>,
}

/// Opens and starts the default microphone, with room for `secs` between drains.
pub fn open(secs: f64) -> Result<Mic, String> {
    let device = input_device(&cpal::default_host()).ok_or(no_mic())?;
    let name = device_name(&device).unwrap_or_default();
    let supported = device.default_input_config().map_err(|e| {
        let e = e.to_string();
        if e.contains("80070005") {
            open_failed(e)
        } else {
            no_mic().to_string()
        }
    })?;
    let config: StreamConfig = supported.config();
    let rate = config.sample_rate.0;
    let (tx, samples) = RingBuffer::new((secs * rate as f64) as usize);
    let first_at = Arc::new(AtomicU64::new(0));
    let failed = Arc::new(AtomicBool::new(false));
    let (f, x) = (first_at.clone(), failed.clone());
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, &config, tx, f, x),
        SampleFormat::I16 => build::<i16>(&device, &config, tx, f, x),
        SampleFormat::I32 => build::<i32>(&device, &config, tx, f, x),
        SampleFormat::U16 => build::<u16>(&device, &config, tx, f, x),
        other => Err(tr!(
            "不支持的麦克风格式 {other:?}",
            "Unsupported microphone format {other:?}"
        )),
    }?;
    stream.play().map_err(open_failed)?;
    Ok(Mic {
        stream,
        name,
        rate,
        samples,
        first_at,
        failed,
    })
}

/// The default input, or the one `devices::preferred_input` names.
fn input_device(host: &cpal::Host) -> Option<cpal::Device> {
    if let Some(name) = super::devices::preferred_input() {
        let found = host
            .input_devices()
            .ok()?
            .find(|d| device_name(d).is_some_and(|n| n.contains(&name)));
        if found.is_some() {
            return found;
        }
    }
    host.default_input_device()
}

fn build<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut tx: Producer<f32>,
    first_at: Arc<AtomicU64>,
    failed: Arc<AtomicBool>,
) -> Result<Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let ch = config.channels as usize;
    device
        .build_input_stream(
            config,
            move |data: &[T], info: &cpal::InputCallbackInfo| {
                if first_at.load(Relaxed) == 0 {
                    first_at.store(host_nanos(&info.timestamp().capture).max(1), Relaxed);
                }
                let frames = data.len() / ch.max(1);
                let Ok(chunk) = tx.write_chunk_uninit(frames.min(tx.slots())) else {
                    return;
                };
                // Mono: the first channel (a second one is often unused or the same mic).
                chunk.fill_from_iter(data.chunks(ch).map(|f| f32::from_sample(f[0])));
            },
            move |_err| failed.store(true, Relaxed),
            None,
        )
        .map_err(open_failed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_microphone_blocked_in_windows_privacy_settings_says_where_to_allow_it() {
        let blocked = open_failed("Access is denied. (0x80070005)");
        assert!(blocked.contains("隐私和安全性"), "{blocked}");
        // The message part is in the system's language; only the code is matched.
        assert!(open_failed("拒绝访问。 (0x80070005)").contains("麦克风访问权限"));
        assert_eq!(
            open_failed("The device is busy"),
            "麦克风打不开：The device is busy"
        );
    }
}
