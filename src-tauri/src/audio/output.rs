//! Owns the cpal output stream on a dedicated thread (streams are not `Send`
//! on every platform). Follows the system default device: reopens when the
//! device errors (e.g. headphones unplugged) or the default changes, and
//! pauses the stream after a few idle seconds so the Mac can sleep.

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

const ERR_DEVICE: &str = "没有可用的音频输出设备";
const IDLE_PAUSE: Duration = Duration::from_secs(5);
const DEVICE_CHECK: Duration = Duration::from_secs(1);

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
                                sink.error(None, ERR_DEVICE);
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
    cpal::default_host()
        .default_output_device()
        .and_then(|d| d.default_output_config().ok())
        .map_or(48_000, |c| c.sample_rate().0)
}

fn default_name(host: &cpal::Host) -> Option<String> {
    host.default_output_device().and_then(|d| d.name().ok())
}

fn open(
    host: &cpal::Host,
    engine: &Arc<Mutex<Engine>>,
    failed: Arc<AtomicBool>,
) -> Result<Open, String> {
    let device = host.default_output_device().ok_or(ERR_DEVICE)?;
    let name = device.name().unwrap_or_default();
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
                // Never block: if the control thread holds the lock (device switch), emit silence.
                let Ok(mut e) = engine.try_lock() else {
                    data.fill(T::EQUILIBRIUM);
                    return;
                };
                for part in data.chunks_mut(scratch.len()) {
                    let buf = &mut scratch[..part.len()];
                    e.render(buf, ch, pending);
                    for (d, s) in part.iter_mut().zip(buf.iter()) {
                        *d = T::from_sample(*s);
                    }
                    pending += part.len() / ch;
                }
            },
            move |_err| failed.store(true, Relaxed),
            None,
        )
        .map_err(|e| e.to_string())
}
