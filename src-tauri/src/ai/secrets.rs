//! API keys and tokens live in the system's secret store, one item per provider: the
//! Keychain on macOS, Credential Manager on Windows (where a long value takes several
//! entries, see `pieces.rs`). Tests and smoke runs use an in-memory store so they never
//! touch the real one.

use std::collections::HashMap;
use std::sync::Mutex;

pub trait SecretStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<String>, String>;
    fn set(&self, id: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<(), String>;
}

pub struct Secrets(pub Box<dyn SecretStore>);

/// The item name macOS shows when it asks about the Keychain (on Windows, entries are
/// named `<provider>.Shadowing`).
const SERVICE: &str = "Shadowing";
/// Before 0.5.1 the items were named after the bundle identifier, which read like a “dev” build.
/// Read once and copied to `SERVICE`; the old item is left alone, since removing it could ask again.
#[cfg(target_os = "macos")]
const OLD_SERVICE: &str = "dev.shadowing.app";
/// Longest value of one Credential Manager entry: 2560 bytes, as UTF-16.
#[cfg(windows)]
const ENTRY_UNITS: usize = 2560 / 2;

/// The system's store: the Keychain on macOS, Credential Manager on Windows.
pub struct Keychain;

impl Keychain {
    pub fn new() -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        let store = apple_native_keyring_store::keychain::Store::new().map_err(fail)?;
        #[cfg(windows)]
        let store = windows_native_keyring_store::Store::new().map_err(fail)?;
        #[cfg(any(target_os = "macos", windows))]
        {
            keyring_core::set_default_store(store);
            Ok(Self)
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        Err(fail(keyring_core::Error::NoDefaultStore))
    }
}

fn fail(e: keyring_core::Error) -> String {
    let store = crate::i18n::pick(
        crate::i18n::os("钥匙串", "Windows 凭据管理器"),
        crate::i18n::os("the Keychain", "Windows Credential Manager"),
    );
    tr!("无法访问{store}：{e}", "Couldn't access {store}: {e}")
}

fn entry(service: &str, id: &str) -> Result<keyring_core::Entry, String> {
    keyring_core::Entry::new(service, id).map_err(fail)
}

/// One entry per id, in one service: the store as the system sees it.
struct Entries(&'static str);

impl SecretStore for Entries {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match entry(self.0, id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(fail(e)),
        }
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        entry(self.0, id)?.set_password(secret).map_err(fail)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        match entry(self.0, id)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(fail(e)),
        }
    }
}

#[cfg(target_os = "macos")]
impl SecretStore for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        if let Some(secret) = Entries(SERVICE).get(id)? {
            return Ok(Some(secret));
        }
        let Some(secret) = Entries(OLD_SERVICE).get(id)? else {
            return Ok(None);
        };
        // Saved by an older version: keep a copy under the new name (still usable if that fails).
        if let Err(e) = self.set(id, &secret) {
            eprintln!("{e}");
        }
        Ok(Some(secret))
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        Entries(SERVICE).set(id, secret)
    }

    /// Both names, so signing out or clearing a key leaves no copy behind.
    fn delete(&self, id: &str) -> Result<(), String> {
        Entries(SERVICE).delete(id)?;
        Entries(OLD_SERVICE).delete(id)
    }
}

#[cfg(not(target_os = "macos"))]
impl SecretStore for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        super::pieces::get(&Entries(SERVICE), id)
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        #[cfg(windows)]
        let limit = ENTRY_UNITS;
        #[cfg(not(windows))]
        let limit = usize::MAX;
        super::pieces::set(&Entries(SERVICE), id, secret, limit)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        super::pieces::delete(&Entries(SERVICE), id)
    }
}

#[derive(Default)]
pub struct Memory(Mutex<HashMap<String, String>>);

impl Memory {
    /// What is saved, for tests.
    #[cfg(test)]
    pub fn ids(&self) -> Vec<String> {
        self.0.lock().unwrap().keys().cloned().collect()
    }
}

impl SecretStore for Memory {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(id.into(), secret.into());
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(id);
        Ok(())
    }
}

/// "sk-…abcd": enough to recognise which key is saved, useless to anyone else.
pub fn hint(secret: &str) -> String {
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() < 12 {
        return "••••".into();
    }
    let head: String = chars[..3].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hint_shows_only_the_ends() {
        assert_eq!(hint("sk-proj-1234567890abcd"), "sk-…abcd");
        assert_eq!(hint("short"), "••••");
    }

    /// Manual: `cargo test keychain_round_trip -- --ignored` (writes, then deletes, a test item).
    #[test]
    #[ignore]
    fn keychain_round_trip() {
        let k = Keychain::new().unwrap();
        let id = "test-round-trip";
        k.set(id, "secret-1").unwrap();
        k.set(id, "secret-2").unwrap();
        assert_eq!(k.get(id).unwrap().as_deref(), Some("secret-2"));
        // Longer than one Credential Manager entry, with characters outside ASCII.
        let long = "語𝄞-token.".repeat(400);
        k.set(id, &long).unwrap();
        assert_eq!(k.get(id).unwrap(), Some(long));
        k.delete(id).unwrap();
        assert_eq!(k.get(id).unwrap(), None);

        // An item saved by an older version is read and copied to the new name.
        #[cfg(target_os = "macos")]
        {
            Entries(OLD_SERVICE).set(id, "old").unwrap();
            assert_eq!(k.get(id).unwrap().as_deref(), Some("old"));
            assert_eq!(Entries(SERVICE).get(id).unwrap().as_deref(), Some("old"));
            k.delete(id).unwrap();
            assert_eq!(Entries(OLD_SERVICE).get(id).unwrap(), None);
            assert_eq!(k.get(id).unwrap(), None);
        }
    }

    #[test]
    fn memory_store_round_trip() {
        let m = Memory::default();
        assert_eq!(m.get("groq").unwrap(), None);
        m.set("groq", "k").unwrap();
        assert_eq!(m.get("groq").unwrap().as_deref(), Some("k"));
        m.delete("groq").unwrap();
        m.delete("groq").unwrap();
        assert_eq!(m.get("groq").unwrap(), None);
    }
}
