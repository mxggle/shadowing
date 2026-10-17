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
    let mode = fs::metadata(installed.join("bin/run"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o755, 0o755);
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
