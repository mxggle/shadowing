//! Secrets longer than one entry of the system store can hold are kept in several entries.
//! Windows Credential Manager takes at most 2560 bytes per entry, stored as UTF-16, so
//! 1280 units; the ChatGPT tokens are longer than that. A secret that fits stays one plain
//! entry, so API keys (and everything saved before) read as they always have.
//!
//! A long one: the head entry `id` holds `MARK`, a generation (`a` or `b`), the number of
//! entries (three digits), `:` and the first piece; the other pieces are `id#a1`, `id#a2`…
//! A new value is written under the other generation and its head last, so a write cut
//! short (crash, full store) leaves the old value whole.

use super::secrets::SecretStore;

/// Starts a head entry. A control character: no key or token begins with it.
const MARK: &str = "\u{1}pieces:";

fn units(s: &str) -> usize {
    s.encode_utf16().count()
}

fn header(generation: char, count: usize) -> String {
    format!("{MARK}{generation}{count:03}:")
}

fn piece(id: &str, generation: char, k: usize) -> String {
    format!("{id}#{generation}{k}")
}

fn other(generation: char) -> char {
    if generation == 'a' {
        'b'
    } else {
        'a'
    }
}

/// `secret` as entry values, `[head, piece 1, …]`, none longer than `limit` UTF-16 units
/// (pieces end on character boundaries). One value, unchanged, when it fits.
pub fn split(secret: &str, generation: char, limit: usize) -> Vec<String> {
    if !secret.starts_with(MARK) && units(secret) <= limit {
        return vec![secret.to_string()];
    }
    let mut pieces = Vec::new();
    let (mut current, mut used) = (String::new(), 0);
    let mut room = limit - units(&header(generation, 0));
    for c in secret.chars() {
        if used + c.len_utf16() > room {
            pieces.push(std::mem::take(&mut current));
            (used, room) = (0, limit);
        }
        current.push(c);
        used += c.len_utf16();
    }
    pieces.push(current);
    let head = header(generation, pieces.len());
    pieces[0].insert_str(0, &head);
    pieces
}

/// A head entry's generation, number of entries and first piece; None for a plain value.
pub fn parse(head: &str) -> Option<(char, usize, &str)> {
    let rest = head.strip_prefix(MARK)?;
    let generation = rest.chars().next().filter(|g| matches!(g, 'a' | 'b'))?;
    let (count, first) = rest[1..].split_once(':')?;
    Some((generation, count.parse().ok().filter(|&n| n >= 1)?, first))
}

/// The whole secret; None when there is none, or when a piece has gone missing (the
/// value can't be trusted, so it reads as never saved: sign in or enter the key again).
pub fn get(store: &dyn SecretStore, id: &str) -> Result<Option<String>, String> {
    let Some(head) = store.get(id)? else {
        return Ok(None);
    };
    let Some((generation, count, first)) = parse(&head) else {
        return Ok(Some(head));
    };
    let mut secret = first.to_string();
    for k in 1..count {
        match store.get(&piece(id, generation, k))? {
            Some(part) => secret.push_str(&part),
            None => return Ok(None),
        }
    }
    Ok(Some(secret))
}

pub fn set(store: &dyn SecretStore, id: &str, secret: &str, limit: usize) -> Result<(), String> {
    let old = store.get(id)?;
    let generation = match old.as_deref().and_then(parse) {
        Some(('a', ..)) => 'b',
        _ => 'a',
    };
    let parts = split(secret, generation, limit);
    for (k, part) in parts.iter().enumerate().skip(1) {
        store.set(&piece(id, generation, k), part)?;
    }
    store.set(id, &parts[0])?;
    // The old value's pieces, and any an interrupted write left behind.
    sweep(store, id, other(generation), 1)?;
    sweep(store, id, generation, parts.len())
}

/// The head first, so nothing points at the pieces while they go.
pub fn delete(store: &dyn SecretStore, id: &str) -> Result<(), String> {
    store.delete(id)?;
    sweep(store, id, 'a', 1)?;
    sweep(store, id, 'b', 1)
}

/// Removes `id#{generation}{from}` and the pieces after it, up to the first missing one.
fn sweep(store: &dyn SecretStore, id: &str, generation: char, from: usize) -> Result<(), String> {
    let mut k = from;
    while store.get(&piece(id, generation, k))?.is_some() {
        store.delete(&piece(id, generation, k))?;
        k += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::secrets::Memory;
    use super::*;

    fn ids(m: &Memory) -> Vec<String> {
        let mut ids: Vec<_> = m.ids();
        ids.sort();
        ids
    }

    #[test]
    fn a_secret_that_fits_stays_one_plain_entry() {
        assert_eq!(split("sk-123", 'a', 10), ["sk-123"]);
        assert_eq!(split("", 'a', 10), [""]);
        assert_eq!(parse("sk-123"), None);
        let m = Memory::default();
        set(&m, "groq", "sk-123", 10).unwrap();
        assert_eq!(m.get("groq").unwrap().as_deref(), Some("sk-123"));
        assert_eq!(get(&m, "groq").unwrap().as_deref(), Some("sk-123"));
        assert_eq!(ids(&m), ["groq"]);
    }

    #[test]
    fn long_secrets_split_on_character_boundaries_within_the_limit() {
        // "語" is one UTF-16 unit, "𝄞" two: no piece may end between the halves of a pair.
        let secret = "語𝄞".repeat(40) + "end";
        for limit in [16, 17, 30, 1280] {
            let parts = split(&secret, 'b', limit);
            assert!(parts.iter().all(|p| units(p) <= limit), "{limit}");
            let (generation, count, first) =
                parse(&parts[0]).unwrap_or(('-', 1, parts[0].as_str()));
            if limit < units(&secret) {
                assert_eq!((generation, count), ('b', parts.len()));
            }
            assert_eq!(first.to_string() + &parts[1..].concat(), secret, "{limit}");
        }
    }

    #[test]
    fn a_plain_value_that_looks_like_a_head_is_still_escaped() {
        let odd = format!("{MARK}a002:x");
        let parts = split(&odd, 'a', 1280);
        assert_eq!(parts.len(), 1);
        assert_eq!(parse(&parts[0]), Some(('a', 1, odd.as_str())));
    }

    #[test]
    fn round_trip_through_a_store_and_overwrite_leaves_nothing_behind() {
        let m = Memory::default();
        let long = "x".repeat(100);
        set(&m, "chatgpt", &long, 30).unwrap();
        assert_eq!(get(&m, "chatgpt").unwrap().as_deref(), Some(long.as_str()));
        assert_eq!(
            ids(&m),
            ["chatgpt", "chatgpt#a1", "chatgpt#a2", "chatgpt#a3"]
        );

        // The next value goes to the other generation; the old pieces are removed.
        let longer = "y".repeat(40);
        set(&m, "chatgpt", &longer, 30).unwrap();
        assert_eq!(
            get(&m, "chatgpt").unwrap().as_deref(),
            Some(longer.as_str())
        );
        assert_eq!(ids(&m), ["chatgpt", "chatgpt#b1"]);

        set(&m, "chatgpt", "short", 30).unwrap();
        assert_eq!(ids(&m), ["chatgpt"]);
        assert_eq!(get(&m, "chatgpt").unwrap().as_deref(), Some("short"));

        set(&m, "chatgpt", &long, 30).unwrap();
        delete(&m, "chatgpt").unwrap();
        assert_eq!(get(&m, "chatgpt").unwrap(), None);
        assert!(ids(&m).is_empty());
        delete(&m, "chatgpt").unwrap();
    }

    #[test]
    fn an_interrupted_write_keeps_the_old_value() {
        let m = Memory::default();
        let old = "o".repeat(100);
        set(&m, "chatgpt", &old, 30).unwrap();
        // The new value's pieces were written, then the app stopped before its head.
        for (k, part) in split(&"n".repeat(100), 'b', 30).iter().enumerate().skip(1) {
            m.set(&piece("chatgpt", 'b', k), part).unwrap();
        }
        assert_eq!(get(&m, "chatgpt").unwrap().as_deref(), Some(old.as_str()));
        // The next write cleans up after it.
        set(&m, "chatgpt", "new", 30).unwrap();
        assert_eq!(ids(&m), ["chatgpt"]);
    }

    #[test]
    fn a_missing_piece_reads_as_nothing_saved() {
        let m = Memory::default();
        set(&m, "chatgpt", &"x".repeat(100), 30).unwrap();
        m.delete("chatgpt#a2").unwrap();
        assert_eq!(get(&m, "chatgpt").unwrap(), None);
    }
}
