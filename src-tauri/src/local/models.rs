//! The Whisper models the app offers, pinned to one Hugging Face commit with
//! their SHA-256, and how well each suits this Mac.

use serde::Serialize;

/// ggerganov/whisper.cpp at a fixed commit, so files never change under us.
const REPO: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: &'static str,
    pub name: &'static str,
    #[serde(skip)]
    pub file: &'static str,
    /// Bytes on disk.
    pub size: u64,
    #[serde(skip)]
    pub sha256: &'static str,
    /// Rough memory while transcribing, in GB.
    pub memory_gb: f64,
    pub note: &'static str,
}

impl Model {
    pub fn url(&self) -> String {
        format!("{REPO}/{}", self.file)
    }
}

pub const MODELS: &[Model] = &[
    Model {
        id: "large-v3-turbo-q5_0",
        name: "Large v3 Turbo（压缩）",
        file: "ggml-large-v3-turbo-q5_0.bin",
        size: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        memory_gb: 1.0,
        note: "速度和准确度平衡，日语、英语都不错",
    },
    Model {
        id: "large-v3-turbo-q8_0",
        name: "Large v3 Turbo",
        file: "ggml-large-v3-turbo-q8_0.bin",
        size: 874_188_075,
        sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
        memory_gb: 1.3,
        note: "比压缩版略准一点，速度差不多",
    },
    Model {
        id: "large-v3",
        name: "Large v3",
        file: "ggml-large-v3.bin",
        size: 3_095_033_483,
        sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
        memory_gb: 3.9,
        note: "最准（尤其日语），但慢很多",
    },
    Model {
        id: "small-q5_1",
        name: "Small",
        file: "ggml-small-q5_1.bin",
        size: 190_085_487,
        sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
        memory_gb: 0.6,
        note: "很快、很小，但日语错误较多，适合先试试",
    },
];

pub fn find(id: &str) -> Option<&'static Model> {
    MODELS.iter().find(|m| m.id == id)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Fit {
    Good,
    /// Runs, but squeezes memory alongside other apps.
    Tight,
    TooBig,
}

pub fn fit(model: &Model, ram_gb: f64) -> Fit {
    if model.memory_gb <= ram_gb * 0.25 {
        Fit::Good
    } else if model.memory_gb <= ram_gb * 0.45 {
        Fit::Tight
    } else {
        Fit::TooBig
    }
}

/// The one model to suggest first: accurate enough for Japanese, quick, fits.
pub fn recommended(ram_gb: f64) -> &'static str {
    if ram_gb >= 12.0 {
        "large-v3-turbo-q8_0"
    } else {
        "large-v3-turbo-q5_0"
    }
}

/// Local transcription is offered on Apple Silicon only; on Intel it is far too slow.
pub fn supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}

/// Physical memory in GB.
pub fn ram_gb() -> f64 {
    let mut bytes: u64 = 0;
    let mut len = std::mem::size_of::<u64>();
    // SAFETY: hw.memsize is a u64; the buffer and its length match.
    let rc = unsafe {
        libc::sysctlbyname(
            c"hw.memsize".as_ptr(),
            (&mut bytes as *mut u64).cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc == 0 {
        bytes as f64 / 1_073_741_824.0
    } else {
        8.0
    }
}

/// Free bytes on the volume holding `path` (or its nearest existing parent).
pub fn free_bytes(path: &std::path::Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let existing = path.ancestors().find(|p| p.exists())?;
    let c = std::ffi::CString::new(existing.as_os_str().as_bytes()).ok()?;
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: valid C string and an out-pointer to a zeroed statfs.
    (unsafe { libc::statfs(c.as_ptr(), &mut st) } == 0).then(|| st.f_bavail * u64::from(st.f_bsize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_well_formed() {
        for m in MODELS {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(
                m.file.starts_with("ggml-") && m.file.ends_with(".bin"),
                "{}",
                m.id
            );
            assert!(m.url().starts_with("https://huggingface.co/"), "{}", m.id);
        }
        assert!(find(recommended(8.0)).is_some() && find(recommended(64.0)).is_some());
    }

    #[test]
    fn fit_depends_on_memory() {
        let large = find("large-v3").unwrap();
        let turbo = find("large-v3-turbo-q5_0").unwrap();
        assert_eq!(fit(turbo, 8.0), Fit::Good);
        assert_eq!(fit(large, 8.0), Fit::TooBig);
        assert_eq!(fit(large, 12.0), Fit::Tight);
        assert_eq!(fit(large, 16.0), Fit::Good);
        assert_eq!(recommended(8.0), "large-v3-turbo-q5_0");
        assert_eq!(recommended(16.0), "large-v3-turbo-q8_0");
    }

    #[test]
    fn reads_this_machine() {
        assert!(ram_gb() >= 1.0);
        assert!(free_bytes(std::path::Path::new("/tmp/does/not/exist")).unwrap() > 0);
    }
}
