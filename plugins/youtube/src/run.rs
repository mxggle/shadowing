//! Running curl and yt-dlp: stdout line by line, stderr kept for error
//! messages, and ended at once when the app cancels.

use crate::{platform, Ctx, CANCELLED};
use std::io::{BufRead, BufReader, Read};
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
    let mut child = platform::hide(&mut command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法运行 {program}：{e}"))?;
    let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
    let (tx, lines) = mpsc::channel::<String>();
    if let Some(stdout) = stdout {
        std::thread::spawn(move || {
            for l in read_lines(stdout) {
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
            for l in read_lines(stderr) {
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

/// Lines without their `\n` or `\r\n`. Not UTF-8 everywhere (a program on Windows may
/// write in the system's code page): such a line is kept with the odd bytes replaced.
fn read_lines(from: impl Read) -> impl Iterator<Item = String> {
    let mut reader = BufReader::new(from);
    std::iter::from_fn(move || {
        let mut buf = Vec::new();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => None,
            Ok(_) => {
                while buf.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
                    buf.pop();
                }
                Some(String::from_utf8_lossy(&buf).into_owned())
            }
        }
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_lines_of_any_encoding() {
        let text: &[u8] = b"SHPROG 1 2 NA\r\nERROR: \xd6\xd0\xce\xc4\nlast";
        let lines: Vec<String> = super::read_lines(text).collect();
        assert_eq!(lines[0], "SHPROG 1 2 NA");
        assert!(lines[1].starts_with("ERROR: ") && lines[1].contains('\u{fffd}'));
        assert_eq!(lines[2], "last");
        assert_eq!(lines.len(), 3);
    }
}
