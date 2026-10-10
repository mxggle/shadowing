use std::process::Command;

fn main() {
    // whisper.cpp's Metal code checks the macOS version at run time (`@available`) for APIs
    // newer than the deployment target (11.0, see tauri.conf.json). Clang implements that
    // check in its own runtime library, which rustc doesn't link: without it the release
    // build fails with an undefined `___isPlatformVersionAtLeast`.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        match clang_runtime() {
            Some(lib) => println!("cargo:rustc-link-arg={lib}"),
            None => println!("cargo:warning=clang runtime library not found; linking may fail"),
        }
    }
    tauri_build::build()
}

/// `…/clang/<version>/lib/darwin/libclang_rt.osx.a` of the active toolchain.
fn clang_runtime() -> Option<String> {
    let out = Command::new("xcrun")
        .args(["clang", "--print-runtime-dir"])
        .output()
        .ok()?;
    let dir = String::from_utf8(out.stdout).ok()?;
    let lib = std::path::Path::new(dir.trim()).join("libclang_rt.osx.a");
    lib.is_file().then(|| lib.to_string_lossy().into_owned())
}
