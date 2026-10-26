//! Owns the cpal output stream on a dedicated thread (streams are not `Send`
//! on every platform). Follows the system default device: reopens when the
//! device errors (e.g. headphones unplugged) or the default changes, and
//! pauses the stream after a few idle seconds so the computer can sleep.

use super::clock::{host_nanos, host_now, ns, trusted};
use super::engine::{Engine, Shared};
use super::EventSink;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, Stream, StreamConfig};
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub enum OutMsg {
    Wake,
}

const IDLE_PAUSE: Duration = Duration::from_secs(5);
const DEVICE_CHECK: Duration = Duration::from_secs(1);

fn err_device() -> &'static str {
    crate::i18n::pick(
        "没有可用的音频输出设备",
        "No audio output device is available",
    )
}

struct Open {
    stream: Stream,
    name: String,
    running: bool,
}

pub fn spawn(
    engine: Arc<Mutex<Engine>>,
    shared: Arc<Shared>,
    sink: Arc<dyn EventSink>,
) -> Sender<OutMsg> {
    let (tx, rx) = mpsc::channel();
    let _ = thread::Builder::new()
        .name("audio-output".into())
        .spawn(move || {
            let host = cpal::default_host();
            let failed = Arc::new(AtomicBool::new(false));
            let mut cur: Option<Open> = None;
            let mut idle_since = Instant::now();
            let mut last_check = Instant::now();
            let mut reported = false;
            loop {
                let wake = match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(OutMsg::Wake) => true,
                    Err(RecvTimeoutError::Timeout) => false,
                    Err(RecvTimeoutError::Disconnected) => return,
                };
                let check_due = last_check.elapsed() >= DEVICE_CHECK;
                let changed = check_due
                    && cur
                        .as_ref()
                        .is_some_and(|o| default_name(&host).is_some_and(|n| n != o.name));
                if check_due {
                    last_check = Instant::now();
                }
                if cur.is_none() && (wake || check_due) || failed.swap(false, Relaxed) || changed {
                    drop(cur.take());
                    match open(&host, &engine, failed.clone()) {
                        Ok(o) => {
                            cur = Some(o);
                            reported = false;
                        }
                        Err(_) => {
                            if !reported && (wake || shared.playing()) {
                                sink.error(None, err_device());
                                reported = true;
                            }
                        }
                    }
                }
                let Some(o) = cur.as_mut() else {
                    // No device: still apply queued commands so state stays coherent.
                    if let Ok(mut e) = engine.try_lock() {
                        e.render(&mut [], 2, 0);
                    }
                    continue;
                };
                if wake || shared.audible.load(Relaxed) {
                    idle_since = Instant::now();
                    if !o.running && o.stream.play().is_ok() {
                        o.running = true;
                    }
                } else if o.running && idle_since.elapsed() > IDLE_PAUSE && o.stream.pause().is_ok()
                {
                    o.running = false;
                }
            }
        });
    tx
}

/// Sample rate of the current default device (48 kHz if none).
pub fn default_rate() -> u32 {
    output_device(&cpal::default_host())
        .and_then(|d| d.default_output_config().ok())
        .map_or(48_000, |c| c.sample_rate().0)
}

/// The system default, or the device named in `SHADOWING_OUTPUT_DEVICE` (manual tests:
/// e.g. the built-in speakers while the default is a pair of headphones).
fn output_device(host: &cpal::Host) -> Option<cpal::Device> {
    if let Ok(name) = std::env::var("SHADOWING_OUTPUT_DEVICE") {
        let found = host
            .output_devices()
            .ok()?
            .find(|d| device_name(d).is_some_and(|n| n.contains(&name)));
        if found.is_some() {
            return found;
        }
    }
    host.default_output_device()
}

/// The device's name, None if it can't be read. On Windows cpal panics instead of failing
/// when the device goes away (unplugged) between being found and being asked.
pub fn device_name(device: &cpal::Device) -> Option<String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| device.name().ok()))
        .ok()
        .flatten()
}

fn default_name(host: &cpal::Host) -> Option<String> {
    output_device(host).and_then(|d| device_name(&d))
}

fn open(
    host: &cpal::Host,
    engine: &Arc<Mutex<Engine>>,
    failed: Arc<AtomicBool>,
) -> Result<Open, String> {
    let device = output_device(host).ok_or(err_device())?;
    let name = device_name(&device).unwrap_or_default();
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let config: StreamConfig = supported.config();
    if let Ok(mut e) = engine.lock() {
        e.set_output(config.sample_rate.0);
    }
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, &config, engine, failed),
        SampleFormat::I16 => build::<i16>(&device, &config, engine, failed),
        SampleFormat::U16 => build::<u16>(&device, &config, engine, failed),
        SampleFormat::I32 => build::<i32>(&device, &config, engine, failed),
        SampleFormat::F64 => build::<f64>(&device, &config, engine, failed),
        other => Err(format!("unsupported sample format {other:?}")),
    }?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(Open {
        stream,
        name,
        running: true,
    })
}

fn build<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    engine: &Arc<Mutex<Engine>>,
    failed: Arc<AtomicBool>,
) -> Result<Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let ch = config.channels as usize;
    let sr = config.sample_rate.0 as f64;
    let engine = engine.clone();
    let mut scratch = vec![0.0f32; 4096 * ch];
    device
        .build_output_stream(
            config,
            move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
                let ts = info.timestamp();
                let lead = ts
                    .playback
                    .duration_since(&ts.callback)
                    .map_or(0.0, |d| d.as_secs_f64());
                let mut pending = (lead * sr) as usize;
                // When this block is heard: the device's time, or the host clock's on
                // Windows when the device's is missing or stale (see clock.rs).
                let heard_at = trusted(
                    host_nanos(&ts.playback),
                    host_now().map(|now| now + ns(lead)),
                );
                let mut done = 0u64;
                // Never block: if the control thread holds the lock (device switch), emit silence.
                let Ok(mut e) = engine.try_lock() else {
                    data.fill(T::EQUILIBRIUM);
                    return;
                };
                for part in data.chunks_mut(scratch.len()) {
                    let buf = &mut scratch[..part.len()];
                    e.render(buf, ch, pending);
                    e.tap(buf, ch, heard_at + done * 1_000_000_000 / sr as u64);
                    if e.muted() {
                        buf.fill(0.0);
                    }
                    for (d, s) in part.iter_mut().zip(buf.iter()) {
                        *d = T::from_sample(*s);
                    }
                    pending += part.len() / ch;
                    done += (part.len() / ch) as u64;
                }
            },
            move |_err| failed.store(true, Relaxed),
            None,
        )
        .map_err(|e| e.to_string())
}
