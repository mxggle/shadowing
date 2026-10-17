//! Running curl and yt-dlp: stdout line by line, stderr kept for error
//! messages, and ended at once when the app cancels.

use crate::{Ctx, CANCELLED};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub struct Output {
    pub ok: bool,
    pub stderr: Vec<String>,
}

/// Runs `command`, calling `line` with each stdout line and `tick` about every 100 ms.
pub fn run(
    ctx: &Ctx,
    mut command: Command,
    line: &mut dyn FnMut(&str),
    tick: &mut dyn FnMut(),
) -> Result<Output, String> {
    let program = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法运行 {program}：{e}"))?;
    let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
    let (tx, lines) = mpsc::channel::<String>();
    if let Some(stdout) = stdout {
        std::thread::spawn(move || {
            for l in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(l).is_err() {
                    break;
                }
            }
        });
    }
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(stderr) = stderr {
        let errors = errors.clone();
        std::thread::spawn(move || {
            for l in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("{l}");
                errors.lock().unwrap().push(l);
            }
        });
    }

    let mut exited: Option<Instant> = None;
    loop {
        if ctx.cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CANCELLED.into());
        }
        match lines.recv_timeout(Duration::from_millis(100)) {
            Ok(l) => line(&l),
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                tick();
                if exited.is_none() && child.try_wait().is_ok_and(|s| s.is_some()) {
                    exited = Some(Instant::now());
                }
                if exited.is_some_and(|at| at.elapsed() > Duration::from_millis(300)) {
                    break;
                }
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    // Let the stderr reader catch up with the last lines.
    std::thread::sleep(Duration::from_millis(30));
    let stderr = errors.lock().unwrap().clone();
    Ok(Output {
        ok: status.success(),
        stderr,
    })
}
