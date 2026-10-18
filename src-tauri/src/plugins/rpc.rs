//! Talking to a plugin: its program runs as a child process and exchanges one
//! JSON-RPC 2.0 message per line on stdin / stdout. Cancelling asks first
//! (`$/cancel`), then ends the process.

use crate::i18n::pick;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const CANCELLED: &str = "已取消";
/// How long a plugin gets to stop by itself after `$/cancel`.
const CANCEL_GRACE: Duration = Duration::from_secs(2);
const STDERR_LINES: usize = 20;

/// Passed through so a plugin can reach the network the way the app does.
const PASS_ENV: &[&str] = &[
    "HOME",
    "TMPDIR",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
];

pub struct Process {
    child: Child,
    stdin: ChildStdin,
    messages: Receiver<Value>,
    stderr: Arc<Mutex<VecDeque<String>>>,
    next_id: u64,
}

impl Process {
    /// Runs `program` in `cwd` with a clean environment (system PATH, HOME, proxies).
    pub fn spawn(program: &Path, cwd: &Path) -> Result<Self, String> {
        let mut command = Command::new(program);
        command
            .current_dir(cwd)
            .env_clear()
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .env("LANG", "en_US.UTF-8")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for key in PASS_ENV {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        let mut child = command
            .spawn()
            .map_err(|e| crate::tr!("插件程序启动不了：{e}", "The plugin couldn’t start: {e}"))?;
        let (stdin, stdout, stderr) =
            match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
                (Some(i), Some(o), Some(e)) => (i, o, e),
                _ => return Err(pick("插件程序启动不了", "The plugin couldn’t start").into()),
            };

        let (tx, messages) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                match serde_json::from_str::<Value>(&line) {
                    Ok(msg) => {
                        if tx.send(msg).is_err() {
                            break;
                        }
                    }
                    Err(_) if cfg!(debug_assertions) => println!("[plugin stdout] {line}"),
                    Err(_) => {}
                }
            }
        });
        let lines = Arc::new(Mutex::new(VecDeque::new()));
        let kept = lines.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                if cfg!(debug_assertions) {
                    eprintln!("[plugin] {line}");
                }
                let mut kept = kept.lock().unwrap();
                if kept.len() == STDERR_LINES {
                    kept.pop_front();
                }
                kept.push_back(line);
            }
        });
        Ok(Process {
            child,
            stdin,
            messages,
            stderr: lines,
            next_id: 1,
        })
    }

    fn send(&mut self, msg: Value) -> Result<(), String> {
        let mut line = msg.to_string();
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|_| self.gone())
    }

    fn ended(&mut self, cancelled: bool) -> String {
        if cancelled {
            CANCELLED.into()
        } else {
            self.gone()
        }
    }

    /// What to say when the plugin stopped answering: its last words on stderr.
    fn gone(&mut self) -> String {
        // Give the stderr reader a moment to collect what was said on the way out.
        let _ = self.child.wait();
        std::thread::sleep(Duration::from_millis(50));
        let last = self.stderr.lock().unwrap().back().cloned();
        match last {
            Some(line) => crate::tr!(
                "插件意外退出：{line}",
                "The plugin quit unexpectedly: {line}"
            ),
            None => pick("插件意外退出", "The plugin quit unexpectedly").into(),
        }
    }

    /// Sends a request and waits for its answer. Notifications that arrive
    /// meanwhile (`progress`, `log`) go to `notify`. When `cancel` is set the
    /// plugin is asked to stop; after a grace period it is ended.
    pub fn call(
        &mut self,
        method: &str,
        params: Value,
        cancel: &AtomicBool,
        notify: &mut dyn FnMut(&str, &Value),
    ) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let mut asked_to_stop: Option<Instant> = None;
        // When the program ended. Its stdout may not close at the same moment (a
        // process started meanwhile can hold a copy of the pipe), so this is checked too.
        let mut exited: Option<Instant> = None;
        loop {
            if cancel.load(Ordering::Relaxed) {
                match asked_to_stop {
                    None => {
                        asked_to_stop = Some(Instant::now());
                        let note = json!({ "jsonrpc": "2.0", "method": "$/cancel", "params": { "id": id } });
                        if self.send(note).is_err() {
                            return Err(CANCELLED.into());
                        }
                    }
                    Some(at) if at.elapsed() > CANCEL_GRACE => {
                        let _ = self.child.kill();
                        return Err(CANCELLED.into());
                    }
                    Some(_) => {}
                }
            }
            match self.messages.recv_timeout(Duration::from_millis(100)) {
                Ok(msg) if msg.get("id").and_then(Value::as_u64) == Some(id) => {
                    if asked_to_stop.is_some() {
                        return Err(CANCELLED.into());
                    }
                    if let Some(error) = msg.get("error") {
                        let message = error.get("message").and_then(Value::as_str);
                        return Err(message
                            .unwrap_or(pick("插件出错了", "The plugin failed"))
                            .to_string());
                    }
                    return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
                }
                Ok(msg) => {
                    if let Some(method) = msg.get("method").and_then(Value::as_str) {
                        notify(method, msg.get("params").unwrap_or(&Value::Null));
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if exited.is_none() && self.child.try_wait().is_ok_and(|s| s.is_some()) {
                        exited = Some(Instant::now());
                    }
                    // Long enough for its last lines to come through the reader.
                    if exited.is_some_and(|at| at.elapsed() > Duration::from_millis(300)) {
                        return Err(self.ended(asked_to_stop.is_some()));
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(self.ended(asked_to_stop.is_some()));
                }
            }
        }
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
#[path = "rpc_tests.rs"]
mod tests;
