use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

/// A fake plugin: a shell script answering requests 1, 2, … in order.
fn script(dir: &Path, body: &str) -> PathBuf {
    let path = dir.join("plugin.sh");
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn no_notes() -> impl FnMut(&str, &Value) {
    |_: &str, _: &Value| {}
}

#[test]
fn answers_requests_and_passes_notifications_on() {
    let dir = tempfile::tempdir().unwrap();
    let program = script(
        dir.path(),
        r#"read line
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"name":"fake"}}'
read line
printf '%s\n' 'not json, ignored'
printf '%s\n' '{"jsonrpc":"2.0","method":"progress","params":{"message":"下载","done":1,"total":2}}'
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"title":"ok"}}'"#,
    );
    let mut p = Process::spawn(&program, dir.path()).unwrap();
    let never = AtomicBool::new(false);
    let first = p
        .call("initialize", json!({}), &never, &mut no_notes())
        .unwrap();
    assert_eq!(first["name"], "fake");

    let mut notes = Vec::new();
    let second = p
        .call(
            "import/run",
            json!({}),
            &never,
            &mut |m: &str, v: &Value| notes.push((m.to_string(), v.clone())),
        )
        .unwrap();
    assert_eq!(second["title"], "ok");
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].0, "progress");
    assert_eq!(notes[0].1["total"], 2);
}

#[test]
fn an_error_answer_becomes_its_message() {
    let dir = tempfile::tempdir().unwrap();
    let program = script(
        dir.path(),
        r#"read line
printf '%s\n' '{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"视频不存在"}}'"#,
    );
    let mut p = Process::spawn(&program, dir.path()).unwrap();
    let err = p
        .call(
            "import/resolve",
            json!({}),
            &AtomicBool::new(false),
            &mut no_notes(),
        )
        .unwrap_err();
    assert_eq!(err, "视频不存在");
}

#[test]
fn a_crash_reports_the_last_stderr_line() {
    let dir = tempfile::tempdir().unwrap();
    let program = script(
        dir.path(),
        "read line\necho 'boom: out of luck' >&2\nexit 3",
    );
    let mut p = Process::spawn(&program, dir.path()).unwrap();
    let err = p
        .call(
            "initialize",
            json!({}),
            &AtomicBool::new(false),
            &mut no_notes(),
        )
        .unwrap_err();
    assert!(err.contains("boom: out of luck"), "{err}");
}

#[test]
fn cancel_asks_then_ends_a_plugin_that_does_not_listen() {
    let dir = tempfile::tempdir().unwrap();
    let program = script(dir.path(), "read line\nexec sleep 30");
    let mut p = Process::spawn(&program, dir.path()).unwrap();
    let cancel = AtomicBool::new(true);
    let started = Instant::now();
    let err = p
        .call("import/run", json!({}), &cancel, &mut no_notes())
        .unwrap_err();
    assert_eq!(err, CANCELLED);
    assert!(started.elapsed() < CANCEL_GRACE + Duration::from_secs(1));
    // Ended, not left running: waiting returns at once.
    assert!(p.child.wait().is_ok());
}

#[test]
fn a_plugin_that_stops_on_cancel_is_not_ended() {
    let dir = tempfile::tempdir().unwrap();
    // Reads the request, then the $/cancel, and leaves.
    let program = script(dir.path(), "read line\nread cancel\nexit 0");
    let mut p = Process::spawn(&program, dir.path()).unwrap();
    let err = p
        .call(
            "import/run",
            json!({}),
            &AtomicBool::new(true),
            &mut no_notes(),
        )
        .unwrap_err();
    assert_eq!(err, CANCELLED);
    // It left by itself (exit 0), so the grace period never ran out and nothing ended it.
    // (Not timed: the first run of a freshly built test can be slow on a busy Mac.)
    assert!(p.child.wait().unwrap().success());
}

#[test]
fn the_environment_is_clean() {
    let dir = tempfile::tempdir().unwrap();
    let program = script(
        dir.path(),
        r#"read line
printf '{"jsonrpc":"2.0","id":1,"result":{"path":"%s","cwd":"%s","secret":"%s"}}\n' "$PATH" "$(pwd -P)" "$CARGO_PKG_NAME""#,
    );
    let mut p = Process::spawn(&program, dir.path()).unwrap();
    let env = p
        .call(
            "initialize",
            json!({}),
            &AtomicBool::new(false),
            &mut no_notes(),
        )
        .unwrap();
    assert_eq!(env["path"], "/usr/bin:/bin:/usr/sbin:/sbin");
    assert_eq!(env["secret"], "");
    let cwd = dir.path().canonicalize().unwrap();
    assert_eq!(env["cwd"], cwd.to_string_lossy().as_ref());
}
