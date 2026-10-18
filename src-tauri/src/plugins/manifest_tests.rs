use super::*;

fn manifest(json: &str) -> Manifest {
    serde_json::from_str(json).unwrap()
}

fn youtube() -> Manifest {
    manifest(&format!(
        r#"{{"id":"youtube","name":"YouTube 导入","version":"0.1.0","protocol":1,
        "main":{{"{}":"bin/shadowing-youtube"}},
        "contributes":{{"importers":[{{"id":"video","title":"YouTube",
          "match":["https://*.youtube.com/watch?*","https://youtu.be/*","https://*.youtube.com/shorts/*"]}}]}}}}"#,
        platform()
    ))
}

#[test]
fn matches_youtube_links_and_nothing_else() {
    let m = youtube();
    for url in [
        "https://www.youtube.com/watch?v=FFMoTdeD1aM",
        "https://youtube.com/watch?v=FFMoTdeD1aM&t=30s",
        "https://m.youtube.com/watch?v=FFMoTdeD1aM",
        "https://music.youtube.com/watch?v=x",
        "https://youtu.be/FFMoTdeD1aM?si=abc",
        "https://www.youtube.com/shorts/abc",
        "  https://WWW.YouTube.com/watch?v=x  ",
    ] {
        assert!(m.importer_for(url).is_some(), "{url}");
    }
    for url in [
        "https://www.youtube.com/",
        "https://www.youtube.com/playlist?list=x",
        "https://notyoutube.com/watch?v=x",
        "https://youtube.com.evil.example/watch?v=x",
        "https://evil.example/https://youtu.be/x",
        "ftp://youtu.be/x",
        "youtu.be/x",
        "",
    ] {
        assert!(m.importer_for(url).is_none(), "{url}");
    }
}

#[test]
fn glob_handles_several_stars() {
    assert!(glob("/a*b*c", "/aXXbYYc"));
    assert!(glob("/*", "/"));
    assert!(glob("*", ""));
    assert!(!glob("/a*b", "/aXXc"));
    assert!(glob("/watch?*", "/watch?v=1"));
    assert!(!glob("/watch?*", "/watchv=1"));
}

#[test]
fn checks_id_protocol_version_and_program() {
    let app = "0.8.1";
    assert!(youtube().check(app).is_ok());

    let mut m = youtube();
    m.id = "../evil".into();
    assert!(m.check(app).unwrap_err().contains("id"));

    let mut m = youtube();
    m.protocol = 2;
    assert!(m.check(app).unwrap_err().contains("协议"));

    let mut m = youtube();
    m.min_app_version = Some("0.9.0".into());
    assert!(m.check(app).unwrap_err().contains("0.9.0"));
    m.min_app_version = Some("0.8.1".into());
    assert!(m.check(app).is_ok());

    for bad in ["../bin/x", "/usr/bin/true", ""] {
        let mut m = youtube();
        m.main.insert(platform().into(), bad.into());
        assert!(m.check(app).unwrap_err().contains("路径"), "{bad}");
    }

    let mut m = youtube();
    m.main.clear();
    assert!(m.check(app).unwrap_err().contains("不支持"));

    let mut m = youtube();
    m.contributes.importers[0].matches = vec!["youtube.com/*".into()];
    assert!(m.check(app).unwrap_err().contains("https://"));
}

#[test]
fn compares_versions() {
    assert!(older("0.8.1", "0.9.0"));
    assert!(older("0.8.1", "0.8.10"));
    assert!(!older("0.10.0", "0.9.9"));
    assert!(!older("1.0", "1.0.0"));
    assert!(!older("0.9.0-beta", "0.9.0"));
}

#[test]
fn platform_keys_and_the_x64_fallback_on_windows_arm() {
    assert_eq!(platforms_for("macos", "aarch64"), ["darwin-arm64"]);
    assert_eq!(platforms_for("macos", "x86_64"), ["darwin-x86_64"]);
    assert_eq!(platforms_for("windows", "x86_64"), ["windows-x86_64"]);
    assert_eq!(
        platforms_for("windows", "aarch64"),
        ["windows-arm64", "windows-x86_64"]
    );
    assert!(platforms_for("linux", "x86_64").is_empty());

    let main = |keys: &[(&str, &str)]| -> HashMap<String, String> {
        keys.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    };
    let arm = platforms_for("windows", "aarch64");
    let x64_only = main(&[("windows-x86_64", "bin/p.exe"), ("darwin-arm64", "bin/p")]);
    assert_eq!(program_for(&x64_only, arm).unwrap(), "bin/p.exe");
    let both = main(&[
        ("windows-x86_64", "bin/x64.exe"),
        ("windows-arm64", "bin/arm.exe"),
    ]);
    assert_eq!(program_for(&both, arm).unwrap(), "bin/arm.exe");
    // A Mac doesn't fall back to the Intel program (nor a PC to a Mac one).
    let intel = main(&[("darwin-x86_64", "bin/p")]);
    assert!(program_for(&intel, platforms_for("macos", "aarch64")).is_none());
    assert!(program_for(&intel, platforms_for("windows", "x86_64")).is_none());
}

#[test]
fn a_windows_program_is_an_exe_inside_the_folder() {
    let mut m = youtube();
    m.main
        .insert(platform().into(), "bin/shadowing-youtube.exe".into());
    assert_eq!(
        m.program_path().unwrap(),
        PathBuf::from("bin/shadowing-youtube.exe")
    );
    m.main
        .insert(platform().into(), "C:/Windows/notepad.exe".into());
    assert!(m.program_path().is_err());
}
