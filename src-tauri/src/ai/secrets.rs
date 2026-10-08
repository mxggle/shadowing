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

const SERVICE: &str = "dev.shadowing.app";

pub struct Keychain;

impl Keychain {
    pub fn new() -> Result<Self, String> {
        let store = apple_native_keyring_store::keychain::Store::new().map_err(fail)?;
        keyring_core::set_default_store(store);
        Ok(Self)
    }
}

fn fail(e: keyring_core::Error) -> String {
    format!("无法访问钥匙串：{e}")
}

fn entry(id: &str) -> Result<keyring_core::Entry, String> {
    keyring_core::Entry::new(SERVICE, id).map_err(fail)
}

impl SecretStore for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match entry(id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(fail(e)),
        }
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        entry(id)?.set_password(secret).map_err(fail)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(fail(e)),
        }
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
