use super::super::{manifest, scan};
use super::*;

fn plugin_folder(dir: &Path, version: &str) {
    fs::create_dir_all(dir.join("bin")).unwrap();
    fs::create_dir_all(dir.join("data")).unwrap();
    fs::create_dir_all(dir.join(".git")).unwrap();
    fs::write(dir.join("bin/run"), "#!/bin/sh\n").unwrap();
    fs::write(dir.join("data/dev-cache"), "x").unwrap();
    fs::write(
        dir.join("manifest.json"),
        format!(
            r#"{{"id":"fake","name":"Fake","version":"{version}","protocol":1,"main":{{"{}":"bin/run"}}}}"#,
            manifest::platform()
        ),
    )
    .unwrap();
}

#[test]
fn installing_copies_the_plugin_and_an_update_keeps_its_data() {
    let tmp = tempfile::tempdir().unwrap();
    let (source, root) = (tmp.path().join("src"), tmp.path().join("plugins"));
    plugin_folder(&source, "0.1.0");
    fs::create_dir_all(&root).unwrap();

    let m = Manifest::read(&source).unwrap();
    copy_in(&source, &root, &m).unwrap();
    let installed = root.join("fake");
    assert!(installed.join("manifest.json").is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(installed.join("bin/run"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o755, 0o755);
    }
    // The source's own data and hidden folders stay behind.
    assert!(!installed.join("data").exists());
    assert!(!installed.join(".git").exists());

    // What the plugin downloaded survives an update.
    fs::create_dir_all(installed.join("data")).unwrap();
    fs::write(installed.join("data/yt-dlp"), "tool").unwrap();
    plugin_folder(&source, "0.2.0");
    let m = Manifest::read(&source).unwrap();
    copy_in(&source, &root, &m).unwrap();
    assert_eq!(Manifest::read(&installed).unwrap().version, "0.2.0");
    assert_eq!(
        fs::read_to_string(installed.join("data/yt-dlp")).unwrap(),
        "tool"
    );
    assert!(!root.join(".install-fake").exists());

    // A folder whose name isn't its id is listed as a problem, not used.
    fs::rename(&installed, root.join("other")).unwrap();
    let found = scan(&root);
    assert_eq!(found.len(), 1);
    assert!(found[0].2.as_ref().unwrap_err().contains("fake"));
}

#[test]
fn installing_the_installed_folder_itself_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("plugins");
    plugin_folder(&root.join("fake"), "0.1.0");
    let m = Manifest::read(&root.join("fake")).unwrap();
    assert!(copy_in(&root.join("fake"), &root, &m).is_err());
    assert!(root.join("fake/manifest.json").is_file());
}

#[test]
fn picking_the_folder_around_one_plugin_finds_it() {
    let tmp = tempfile::tempdir().unwrap();
    let dist = tmp.path().join("dist");
    plugin_folder(&dist.join("fake"), "0.1.0");
    assert_eq!(super::plugin_folder(dist.clone()), dist.join("fake"));
    assert_eq!(super::plugin_folder(dist.join("fake")), dist.join("fake"));
    // Two plugins inside: which one is meant isn't clear, so nothing is guessed.
    plugin_folder(&dist.join("other"), "0.1.0");
    assert_eq!(super::plugin_folder(dist.clone()), dist);
}

#[cfg(target_os = "macos")]
#[test]
fn installing_clears_the_download_quarantine() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let tmp = tempfile::tempdir().unwrap();
    let (source, root) = (tmp.path().join("src"), tmp.path().join("plugins"));
    plugin_folder(&source, "0.1.0");
    fs::create_dir_all(&root).unwrap();
    let name = c"com.apple.quarantine";
    let mark = b"0083;6ad41e38;Safari;";
    let has_mark = |p: &Path| {
        let p = CString::new(p.as_os_str().as_bytes()).unwrap();
        // SAFETY: NUL-terminated strings; a null buffer only asks for the size.
        unsafe { libc::getxattr(p.as_ptr(), name.as_ptr(), std::ptr::null_mut(), 0, 0, 0) >= 0 }
    };
    let program = source.join("bin/run");
    let p = CString::new(program.as_os_str().as_bytes()).unwrap();
    // SAFETY: as above; `mark` outlives the call.
    let set = unsafe {
        libc::setxattr(
            p.as_ptr(),
            name.as_ptr(),
            mark.as_ptr().cast(),
            mark.len(),
            0,
            0,
        )
    };
    assert_eq!(set, 0);
    assert!(has_mark(&program));
    // A plain copy keeps the mark: clearing it is what makes the difference.
    fs::copy(&program, tmp.path().join("plain")).unwrap();
    assert!(has_mark(&tmp.path().join("plain")));

    copy_in(&source, &root, &Manifest::read(&source).unwrap()).unwrap();
    assert!(!has_mark(&root.join("fake/bin/run")));
    assert!(!has_mark(&root.join("fake/manifest.json")));
}

#[cfg(windows)]
#[test]
fn installing_clears_the_mark_of_the_web() {
    let tmp = tempfile::tempdir().unwrap();
    let (source, root) = (tmp.path().join("src"), tmp.path().join("plugins"));
    plugin_folder(&source, "0.1.0");
    fs::create_dir_all(&root).unwrap();
    let has_mark = |p: &Path| fs::metadata(os::zone_identifier(p)).is_ok();
    let program = source.join("bin/run");
    fs::write(
        os::zone_identifier(&program),
        "[ZoneTransfer]\r\nZoneId=3\r\n",
    )
    .unwrap();
    assert!(has_mark(&program));
    // A plain copy keeps the mark: clearing it is what makes the difference.
    fs::copy(&program, tmp.path().join("plain")).unwrap();
    assert!(has_mark(&tmp.path().join("plain")));

    copy_in(&source, &root, &Manifest::read(&source).unwrap()).unwrap();
    assert!(!has_mark(&root.join("fake/bin/run")));
    assert!(fs::metadata(root.join("fake/bin/run")).is_ok());
}
