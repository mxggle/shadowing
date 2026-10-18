# Shadowing

English · [简体中文](README.zh-CN.md)

A macOS app for listening to your own audio over and over and repeating it aloud (shadowing). It works for Japanese, English or any other language.

The player works fully without subtitles, models or API keys; subtitles, transcription and AI are all optional. The interface is in English or Simplified Chinese (Settings → Language; it follows your Mac by default).

## Features

- **Play**: browse a folder of audio, change the speed without changing the pitch (0.5–2.0×), loop from A to B, and pick up each track where you left off. Decoding, speed, looping and output all run in Rust, so a loop wraps around exactly, without timers.
- **Subtitles**: import SRT / VTT (a subtitle file with the same name next to the audio is read automatically), or transcribe the audio:
  - on this Mac (Apple Silicon, whisper.cpp + Metal) or with a cloud service (Groq / OpenAI / your own compatible server);
  - sentence boundaries snap to real pauses, and dialogues tell speakers apart (the voice model runs on your Mac);
  - words the transcription wasn’t sure about get a dashed underline.
- **Practice**: click a sentence to play from there, loop one sentence, move between sentences with `[` `]`, and open an explanation under any sentence.
- **Record yourself**: record a sentence (`M`) and compare it with the original on two aligned waveforms, with how much faster or slower you were. Listen, then repeat, or speak along; record a whole section in one go (`⇧M`), or sentence by sentence. Headphones are optional: the original that leaks into the microphone is removed.
- **Edit subtitles**: fix a sentence, split and join sentences, find and replace all, and proofread with AI (suggestions only; you decide). Edits are kept in the app’s own data; subtitle files next to your audio are never rewritten.
- **Explain this sentence**: a translation, what each piece means, grammar and tone; answers are kept. It uses the model you set up (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Ollama, LM Studio, a custom service, or signing in with a ChatGPT account).
- **Practice log**: how long you practised each day, a daily goal and streaks.
- **Plugins**: the YouTube import plugin brings a video’s audio (and its human-made subtitles) from a link into your folder.
- On first launch there’s a sample practice and an AI setup assistant.

## Install

Only for Apple Silicon Macs for now. Download the `.dmg` from [Releases](../../releases), open it and drag Shadowing into Applications. Once it’s installed, the app tells you when there’s a new version and updates itself in one click.

This build isn’t notarized by Apple, so macOS blocks a copy downloaded with a browser, sometimes saying it “is damaged”. Run this line in Terminal instead: it downloads the latest version, puts it in Applications and opens it (no system settings are changed; the script is [site/install.sh](site/install.sh)):

```bash
curl -fsSL https://shadowing.nihongo.day/install.sh | bash
```

If you’ve already dragged it into Applications, removing the quarantine flag is enough: `xattr -dr com.apple.quarantine /Applications/Shadowing.app`.

## Build from source

You need Rust, Node.js and cmake (for whisper.cpp):

```bash
brew install cmake
npm install
npm run app          # start in development mode
npx tauri build --bundles app   # build the .app
```

Other commands:

```bash
npm run check        # tsc + vite build + vitest + cargo fmt / clippy / test
npm run dev          # browser + mock backend, for UI work only (add ?en to the address for English)
npm run smoke -- <folder>   # build a debug app and run its self-test in the real app (make test audio with scripts/make-fixtures.sh first)
```

The code layout, conventions and manual tests are in [CLAUDE.md](CLAUDE.md), the product goals in [PRODUCT.md](PRODUCT.md), and the current progress and what’s still unverified in [PROGRESS.md](PROGRESS.md). These are written in Chinese.

## Privacy

- The app only reads the folder you pick in the dialog, plus its own bundled samples.
- No telemetry. It only goes online when you use an AI feature, and every request is made from Rust: transcription uploads the audio to the service you chose, and explanations and proofreading send sentences to the model you chose. With a local model (Whisper, Ollama, LM Studio) nothing leaves this Mac. Settings say where each feature sends what.
- API keys and sign-in tokens are kept only in the macOS Keychain; the app’s own data file only holds a hint like `sk-…abcd`.
- The models for transcribing on this Mac and telling speakers apart are downloaded from Hugging Face the first time they’re needed, pinned to a version and checked against their SHA-256.

## Third-party

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) and the OpenAI Whisper models (MIT);
- the [3D-Speaker](https://github.com/modelscope/3D-Speaker) CAM++ speaker model (Apache-2.0), run with [tract](https://github.com/sonos/tract);
- symphonia, cpal, rubato, signalsmith-stretch and other audio libraries, see `src-tauri/Cargo.toml`;
- the bundled sample recordings and texts are in the public domain; their sources are in [src-tauri/samples/README.md](src-tauri/samples/README.md).

## License

[MIT](LICENSE)
