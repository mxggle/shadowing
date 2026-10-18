# Shadowing

**Hear your voice right next to a native speaker's.**

Shadowing is a macOS app for practicing shadowing with your own audio: loop a sentence, say it with the speaker,
and see how your take lines up with the original. It works for Japanese, English or any other language.

[简体中文](README.zh-CN.md)

The player works fully without subtitles, models or API keys. Subtitles, transcription and AI are all optional.
The interface is in English or Simplified Chinese: it follows your Mac's language, and you can switch it in Settings.

## Shadow recording

- **Record any sentence**: click the mic next to a sentence (or press `M`), say it, and compare with the original.
  No headphones needed: the original that leaks from the speakers into the mic is removed afterwards, leaving only your voice.
- **Two ways to shadow**: *listen, then speak* (the sentence plays, then it's your turn), or *speak along* (talk over
  the original as it plays). Recording stops by itself when you finish.
- **See where you differ**: your waveform sits under the original's, lined up, with how much faster or slower you were,
  or how many seconds you lagged behind. Play the two together to hear whether you're in sync.
- **Keep going**: *continuous* recording starts the next take as soon as one ends; press Space to keep the take you like.
- **Read a whole section** (`⇧M`): read a full dialog or the whole text in one go, on your own or along with the
  original. It's split back into sentences afterwards, each one comparable with the original. Or drill sentence by
  sentence, with as many takes per sentence as you choose.
- Every take you keep is saved (in continuous recording and drills, that's the take you pick or the last one).
  While the audio plays, your recordings unfold under each sentence like lyrics.
- With AirPods or other Bluetooth headphones, it records with the Mac's built-in mic so your headphones keep full audio quality.

## Import from a link (plugins)

- Plugins add new ways to bring audio in. The first one is **YouTube import**: copy a YouTube link, press `⌘V` in the app,
  pick the subtitles and a folder, and download. You get the original m4a audio track (not re-encoded) and the
  human-made subtitles when there are any.
- Install a plugin from Settings → Plugins → Install from folder. The YouTube plugin is attached to each
  [release](../../releases) as `Shadowing-YouTube-plugin-…-macos-arm64.zip`. To write your own, see [docs/plugin-dev.md](docs/plugin-dev.md).
- Plugins are programs that run on your Mac: only install plugins you trust, and only download content you have the right to use.

## Player

- Open a folder and browse its audio. Change speed without changing pitch (0.5–2.0×), loop A–B or a single sentence,
  and pick up where you left off. Decoding, time-stretching, looping and output all run natively in Rust, so loops are seamless.
- Play order: in order, repeat all, repeat one, or stop when a track ends.

## Subtitles

- Import SRT / VTT (a subtitle file with the same name next to the audio is picked up automatically), or transcribe
  on your Mac (Whisper, Apple Silicon) or with a cloud service (Groq, OpenAI, or any compatible server).
  Sentence boundaries snap to real pauses, speakers in a dialog are told apart, and words the transcriber wasn't sure of are underlined.
- Click a sentence to play from there; `[` `]` move between sentences, `{` `}` between dialog sections.
- Fix the subtitles: edit a sentence, split or merge sentences, find and replace, or get AI proofreading suggestions
  that you confirm one by one. Edits are stored in the app and never written back to your subtitle files.

## Understand a sentence

- **Explain this sentence**: a translation, the sentence broken into chunks with the meaning (and grammar, when it matters)
  of each, and the tone to aim for when you shadow it. Answers are saved.
- Uses the AI you set up: OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Ollama, LM Studio, any compatible server,
  or sign in with your ChatGPT plan.

## Practice log

- Today, the last 7 days and all-time practice time, with a daily goal and a streak. Only real practice counts:
  playing, recording, and the moments you pause to shadow or read an explanation.

## Install

macOS on **Apple Silicon** only for now. Download the `.dmg` from [Releases](../../releases), open it and drag
Shadowing into Applications. After that, the app offers new versions itself and updates in one click.

The app isn't notarized by Apple, so macOS blocks it when it's downloaded from a browser, sometimes saying it's "damaged".
This line downloads the latest version again, installs it into Applications and opens it (it changes no system settings;
the script is [site/install.sh](site/install.sh)):

```bash
curl -fsSL https://shadowing.nihongo.day/install.sh | bash
```

If you already dragged it into Applications, removing the quarantine flag is enough:
`xattr -dr com.apple.quarantine /Applications/Shadowing.app`.

## Build from source

You need Rust, Node.js and cmake (for whisper.cpp):

```bash
brew install cmake
npm install
npm run app          # run in development mode
npx tauri build --bundles app   # build the .app
```

Other commands:

```bash
npm run check        # tsc + vite build + vitest + cargo fmt / clippy / test
npm run dev          # browser + mock backend, for UI work only
npm run smoke -- <folder>   # build a debug app and run the in-app self-test (make test audio with scripts/make-fixtures.sh)
```

Code structure, conventions and manual tests are in [CLAUDE.md](CLAUDE.md), the product goals in [PRODUCT.md](PRODUCT.md),
and what's done and what's still unverified in [PROGRESS.md](PROGRESS.md). These are written in Chinese.

## Privacy

- The app can only open folders you choose in the open dialog, plus its built-in samples.
- No telemetry and no account. The app itself goes online only for:
  - **updates**: at launch it reads the latest release's `latest.json` on GitHub;
  - **AI you set up**: transcription uploads the audio to the service you chose, and explanations and proofreading send
    the sentences to the model you chose. With on-device options (Whisper, Ollama, LM Studio) nothing leaves your Mac.
    Settings says where each feature sends its content. All requests are made from Rust, not from the web view;
  - **models**: the on-device transcription and speaker models download from Hugging Face the first time you need them,
    at pinned versions with SHA-256 checks.
- **Plugins** you install are separate programs that do their own networking. The YouTube plugin talks to YouTube and,
  on first use, downloads yt-dlp and QuickJS from GitHub (checksums verified), then checks for a newer yt-dlp at most once a day.
  Plugins run with your user account's permissions and could read and write your files, so only install plugins you trust.
  The YouTube plugin writes only to its own data folder and to a staging folder, and the app checks the files there
  before moving them into your folder.
- API keys and sign-in tokens are stored only in the macOS Keychain. The app's own data file holds just a hint like `sk-…abcd`.

## Third-party

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) and the OpenAI Whisper models (MIT);
- the [3D-Speaker](https://github.com/modelscope/3D-Speaker) CAM++ speaker model (Apache-2.0), run with [tract](https://github.com/sonos/tract);
- symphonia, cpal, rubato, signalsmith-stretch and other audio libraries, see `src-tauri/Cargo.toml`;
- the YouTube plugin uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) and [QuickJS-ng](https://github.com/quickjs-ng/quickjs) (MIT), downloaded on first use;
- the bundled sample recordings and texts are in the public domain; sources are in [src-tauri/samples/README.md](src-tauri/samples/README.md).

## License

[MIT](LICENSE)
