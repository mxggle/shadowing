//! The default input device as mono samples in a lock-free ring, with the host
//! time of the first one (the same clock the output tap uses). The stream is
//! not `Send` on every platform, so it lives on the recorder's thread.

use crate::audio::output::host_nanos;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig};
use rtrb::{Producer, RingBuffer};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Arc;

pub const ERR_NO_MIC: &str = "没有找到麦克风";

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
    let device = input_device(&cpal::default_host()).ok_or(ERR_NO_MIC)?;
    let name = device.name().unwrap_or_default();
    let supported = device
        .default_input_config()
        .map_err(|_| ERR_NO_MIC.to_string())?;
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
        other => Err(format!("不支持的麦克风格式 {other:?}")),
    }?;
    stream.play().map_err(|e| format!("麦克风打不开：{e}"))?;
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
            .find(|d| d.name().is_ok_and(|n| n.contains(&name)));
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
        .map_err(|e| format!("麦克风打不开：{e}"))
}
