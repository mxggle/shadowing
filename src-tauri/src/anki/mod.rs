//! 加入 Anki: one sentence as an Anki card, through AnkiConnect while Anki is open. The card
//! plays the sentence cut from the track, shows its text, and on the back the explanation
//! kept for it (if it was explained). Cards go in the deck "Shadowing", with our own note type.

mod card;
mod connect;

use crate::record::{original, wav};
use crate::AppState;
use connect::Failure;
use serde::Serialize;
use serde_json::json;
use tauri::State;

/// Speech doesn't need more; keeps a card's audio around 50 KB a second.
const CLIP_RATE: u32 = 24_000;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Added,
    /// It's in the deck already (same sentence): nothing changed.
    Duplicate,
    /// Anki isn't open or doesn't have AnkiConnect: the app says how to set it up.
    Unreachable,
}

#[derive(Debug, Serialize)]
pub struct Added {
    status: Status,
    deck: &'static str,
}

fn reply(status: Status) -> Added {
    Added {
        status,
        deck: card::DECK,
    }
}

/// Adds sentence `index` of the track at `path` to Anki. `text` is the sentence as shown:
/// if it was edited since, the card would hold other words, so the ask is refused.
#[tauri::command]
pub async fn anki_add(
    state: State<'_, AppState>,
    path: String,
    index: usize,
    text: String,
) -> Result<Added, String> {
    let file = state.audio(&path)?;
    let audio = file.to_string_lossy().into_owned();
    let transcript = crate::transcript::for_track(&state, &path)?.ok_or(crate::i18n::pick(
        "这个音频没有字幕",
        "This audio has no subtitles.",
    ))?;
    let sentences = &transcript.sentences;
    if sentences.get(index).map(|s| s.text.as_str()) != Some(text.as_str()) {
        return Err(crate::i18n::pick(
            "这一句刚被修改过，请再试一次",
            "This sentence was just edited. Try again.",
        )
        .into());
    }
    // Before cutting any audio: is Anki there at all?
    match connect::call("version", json!({})).await {
        Err(Failure::Unreachable) => return Ok(reply(Status::Unreachable)),
        Err(Failure::Anki(e)) => return Err(anki_error(&e)),
        Ok(_) => {}
    }

    let (start, end) = card::span(sentences, index);
    let media = card::media_name(&audio, start, end);
    let cut = file.clone();
    let wav = tauri::async_runtime::spawn_blocking(move || {
        original::clip(&cut, start, end, CLIP_RATE).map(|x| wav::mono(&x, CLIP_RATE))
    })
    .await
    .map_err(|e| e.to_string())??;

    let explanation = crate::explain::kept(&state, &audio, sentences, index);
    let name = file
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let fields = card::fields(
        &text,
        &media,
        explanation.as_ref(),
        &card::source(&name, sentences[index].start),
    );
    match add(&media, &wav, fields).await {
        Ok(()) => Ok(reply(Status::Added)),
        Err(Failure::Anki(e)) if connect::is_duplicate(&e) => Ok(reply(Status::Duplicate)),
        Err(Failure::Unreachable) => Ok(reply(Status::Unreachable)),
        Err(Failure::Anki(e)) => Err(anki_error(&e)),
    }
}

/// Makes the note type and the deck if they aren't there, stores the audio, adds the note.
async fn add(media: &str, wav: &[u8], fields: serde_json::Value) -> Result<(), Failure> {
    let models = connect::call("modelNames", json!({})).await?;
    let has_model = models
        .as_array()
        .is_some_and(|m| m.iter().any(|n| n == card::MODEL));
    if !has_model {
        connect::call("createModel", card::model()).await?;
    }
    connect::call("createDeck", json!({ "deck": card::DECK })).await?;
    connect::call(
        "storeMediaFile",
        json!({ "filename": media, "data": connect::base64(wav) }),
    )
    .await?;
    connect::call(
        "addNote",
        json!({ "note": {
            "deckName": card::DECK,
            "modelName": card::MODEL,
            "fields": fields,
            "options": { "allowDuplicate": false, "duplicateScope": "deck" },
            "tags": ["shadowing"],
        }}),
    )
    .await?;
    Ok(())
}

fn anki_error(e: &str) -> String {
    tr!(
        "Anki 没能加入这张卡片：{e}",
        "Anki couldn't add the card: {e}"
    )
}
