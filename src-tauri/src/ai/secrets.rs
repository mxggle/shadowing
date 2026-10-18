//! API keys and tokens live in the macOS Keychain, one item per provider.
//! Tests and smoke runs use an in-memory store so they never touch the real one.

use std::collections::HashMap;
use std::sync::Mutex;

pub trait SecretStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<String>, String>;
    fn set(&self, id: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<(), String>;
}

pub struct Secrets(pub Box<dyn SecretStore>);

/// The item name macOS shows when it asks about the Keychain.
const SERVICE: &str = "Shadowing";
/// Before 0.5.1 the items were named after the bundle identifier, which read like a “dev” build.
/// Read once and copied to `SERVICE`; the old item is left alone, since removing it could ask again.
const OLD_SERVICE: &str = "dev.shadowing.app";

pub struct Keychain;

impl Keychain {
    pub fn new() -> Result<Self, String> {
        let store = apple_native_keyring_store::keychain::Store::new().map_err(fail)?;
        keyring_core::set_default_store(store);
        Ok(Self)
    }
}

fn fail(e: keyring_core::Error) -> String {
    tr!("无法访问钥匙串：{e}", "Couldn't access the Keychain: {e}")
}

fn entry(service: &str, id: &str) -> Result<keyring_core::Entry, String> {
    keyring_core::Entry::new(service, id).map_err(fail)
}

fn read(service: &str, id: &str) -> Result<Option<String>, String> {
    match entry(service, id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(e) => Err(fail(e)),
    }
}

fn remove(service: &str, id: &str) -> Result<(), String> {
    match entry(service, id)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(fail(e)),
    }
}

impl SecretStore for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        if let Some(secret) = read(SERVICE, id)? {
            return Ok(Some(secret));
        }
        let Some(secret) = read(OLD_SERVICE, id)? else {
            return Ok(None);
        };
        // Saved by an older version: keep a copy under the new name (still usable if that fails).
        if let Err(e) = self.set(id, &secret) {
            eprintln!("{e}");
        }
        Ok(Some(secret))
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        entry(SERVICE, id)?.set_password(secret).map_err(fail)
    }

    /// Both names, so signing out or clearing a key leaves no copy behind.
    fn delete(&self, id: &str) -> Result<(), String> {
        remove(SERVICE, id)?;
        remove(OLD_SERVICE, id)
    }
}

#[derive(Default)]
pub struct Memory(Mutex<HashMap<String, String>>);

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
        k.delete(id).unwrap();
        assert_eq!(k.get(id).unwrap(), None);

        // An item saved by an older version is read and copied to the new name.
        entry(OLD_SERVICE, id).unwrap().set_password("old").unwrap();
        assert_eq!(k.get(id).unwrap().as_deref(), Some("old"));
        assert_eq!(read(SERVICE, id).unwrap().as_deref(), Some("old"));
        k.delete(id).unwrap();
        assert_eq!(read(OLD_SERVICE, id).unwrap(), None);
        assert_eq!(k.get(id).unwrap(), None);
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
