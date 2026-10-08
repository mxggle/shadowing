# 调研记录：转写、LLM、引导向导、OAuth

_2026-10-08 ~ 10-09 调研，供 [ai-plan.md](ai-plan.md) 的决定参考。_

标注：
- **[已核]**：读过官方页面、仓库或 API。
- **[二手]**：来自第三方。
- **[未核]**：推断，或者没能确认。

价格和限制会变，用之前再查一次。

---

## 1. 语音转写（STT）

### 本地：whisper.cpp（选用）

**绑定**
- `whisper-rs` 0.16.0（2026-03）[已核]。仓库已迁到 https://codeberg.org/tazz4843/whisper-rs ，有 `metal` / `coreml` / `raw-api` 特性。
- 上游 whisper.cpp v1.9.5（2026-10-06）[已核]。

**模型**（https://huggingface.co/ggerganov/whisper.cpp ，HF API 读到的大小）[已核]

| 模型 | f16 | q8_0 | q5_0 / q5_1 |
| --- | --- | --- | --- |
| large-v3-turbo | 1625 MB | 874 MB | 574 MB |
| large-v3 | 3095 MB | – | 1081 MB |
| medium | 1534 MB | 823 MB | 539 MB |
| small | 488 MB | 264 MB | 190 MB |

**内存**（README）：small 约 852 MB，medium 约 2.1 GB，large 约 3.9 GB。turbo 只有 4 层 decoder，明显更省 [未核具体数]。

**Core ML encoder**
- 需要单独下载，large 约 1.17 GB；首次编译很慢。
- v1 只用 Metal。

**速度**
- 没找到严谨的 M1–M3 测评。聚合站说 base M1 + Metal 跑 large-v3 约 2–3× 实时，turbo 再快 4–6 倍 [二手，无方法说明]。
- 需要自己用 `whisper-bench` 测。

**时间戳**（README、`include/whisper.h`）[已核]
- token 级时间戳，以及实验性的 DTW token 时间戳（有 `WHISPER_AHEADS_LARGE_V3_TURBO` 等预设）。
- 内置 Silero VAD（`ggml-silero-v6.2.0.bin`，约 0.9 MB，https://huggingface.co/ggml-org/whisper-vad ）。
- 用 VAD 时，要用 `whisper_full_get_token_t0/t1` 拿回原始时间轴；`token_data.t0/t1` 是裁剪后的时间轴，不能直接用。
- **待确认**：whisper-rs 0.16 是否封装了这些函数。

**日语 CER**（来自 kotoba-whisper 模型卡）

| 数据集 | large-v3 | medium | small |
| --- | --- | --- | --- |
| CommonVoice 8 | 8.5 | 11.5 | 15.1 |
| JSUT | 7.1 | 10.0 | 14.2 |
| ReazonSpeech | 14.9 | 33.2 | 41.5 |

- small 及以下不推荐用于日语。
- turbo 的多语言能力比 large-v3 略差 [二手]。

**kotoba-whisper**
- v2.0 有官方 ggml 版：https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml ，1520 MB / q5_0 538 MB，Apache-2.0 [已核]。
- 输出**没有标点**，分句困难。v2.1 / v2.2 的标点靠单独的 Python 管线。
- 只支持日语。
- 暂不提供。

**Whisper 常见问题与缓解**
- 问题：
  - 时间戳以 20 ms 为单位，会漂移（常常结束得偏晚）。
  - 静音或音乐处会幻觉，比如日语结尾的「ご視聴ありがとうございました」。
  - 会陷入重复循环。
- 缓解办法：
  - VAD
  - `no_context`
  - 抑制空白
  - 保留温度回退
  - DTW
  - 边界吸附到低能量处
- 日语的 BPE token 可能把一个 UTF-8 字符切开，要先合并成完整字符。分句按 。！？ 加停顿。

### 本地：没选的方案

**WhisperKit（Argmax）**
- 现名 `argmax-oss-swift`，需要 macOS 14+，v1.1.1（2026-10-08）[已核]：https://github.com/argmaxinc/WhisperKit
- 有 CLI（`argmax-cli --word-timestamps`），本地 server 实现了 OpenAI Audio API；server 是否返回词级时间戳未核。
- 要接入就得用 Swift sidecar 或 swift-rs，和 whisper.cpp 功能重复。

**Parakeet TDT v2 / v3**
- 不支持日语：v2 只有英语，v3 是 25 种欧洲语言 [已核]：https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Models.md
- 另有 `parakeet-tdt_ctc-0.6b-ja`，CC-BY-4.0；FluidAudio 报告 JSUT 上 CER 6.85%。
- FluidAudio 的 Rust crate `fluidaudio-rs` 不返回时间戳 [已核源码]。
- sherpa-onnx 的 Rust crate 有 token 时间戳，但只走 CPU / ONNX。

**Apple SpeechAnalyzer / SpeechTranscriber**
- 需要 macOS 26 [已核]。
- `audioTimeRange` 给词级时间；模型由系统通过 `AssetInventory` 下载。
- 支持日语 [二手：WWDC25 session 277，https://blog.addpipe.com/apple-speechanalyzer-api/ ]。
- 速度：34 分钟音频用时 45 秒，Whisper large-v3 用 1 分 41 秒 [二手：https://www.macstories.net/stories/hands-on-how-apples-new-speech-apis-outpace-whisper-for-lightning-fast-transcription/ ]。
- 日语准确率没有测评。需要 Swift 桥。可以作为以后的“免下载”选项。

**Qwen3-ASR**
- 支持日语。
- 对齐器（Qwen3-ForcedAligner）只有 PyTorch 版；原生移植没有时间戳。

**Cohere Transcribe**
- 没有时间戳，日语偏弱 [二手]：https://the-decoder.com/cohere-releases-open-source-model-that-tops-speech-recognition-benchmarks/

**transcribe.cpp**
- MIT 许可，有 Rust 绑定：https://github.com/handy-computer/transcribe.cpp
- Whisper 只有段级时间戳。值得以后关注。

### 模型下载做法

- 地址：`https://huggingface.co/<repo>/resolve/<commit-sha>/<file>`，固定 commit。
- 校验：HF API `GET /api/models/<repo>/tree/main` 返回每个文件的 `lfs.oid`（sha256）[已核]。
- 断点续传：先写 `.part`，用 HTTP Range 续传，校验 sha256 后再改名。
- 存放：`~/Library/Application Support/<id>/models/`，不放 Caches（可能被系统清理）。

### 云端（自带 Key）

| 服务 / 模型 | 每小时音频价格 | 限制 | 时间戳 | 日语 | 接口 |
| --- | --- | --- | --- | --- | --- |
| Groq `whisper-large-v3` / `-turbo` | $0.111 / $0.04；最少按 10 秒计 | 免费档 25 MB；开发档 100 MB（只能通过 url） | `verbose_json`，词级 + 段级 | 可以 | OpenAI 兼容 |
| OpenAI `whisper-1` | $0.36 | 25 MB | `verbose_json`，词级 + 段级，**只有这个模型有** | Whisper 水平 | 原生 |
| OpenAI `gpt-transcribe`（2026-07-28）、`gpt-4o-(mini-)transcribe` | $0.27 / $0.36 / $0.18 | 25 MB | **没有** | 更好 | 原生 |
| Deepgram Nova-3 | $0.258 | 2 GB | 词级 | 有 | 自有接口 |
| ElevenLabs Scribe v2 | $0.22 | 3 GB，10 小时 | 词级 | 一流 | 自有接口 |
| AssemblyAI Universal | $0.15–0.21 | 2.2 GB | 词级 | 有 | 自有接口 |
| Google `gemini-3.5-transcribe` | 约 $0.30 | 1 小时（开词级时间戳时 30 分钟） | `word_info` | 有 | 非 OpenAI 兼容 |
| Mistral Voxtral（Transcribe V2） | 约 $0.18 [二手] | 3 小时 | 词级 + 段级，但不能同时传 `language` | 有 | 类 OpenAI [未核] |
| Soniox stt-async v5 | $0.10 | 300 分钟 | token 级（ms） | 有 | 自有接口 |

**说明**
- 各家对日语“词”怎么切（按字还是按词素）都没有核实，需要用短音频实测。
- 25 MB 上限：2 小时的 16 kHz 单声道 Opus（32 kbps）也有约 29 MB，所以长文件必须在静音处切块，再把时间戳偏移拼起来。

**来源**
- Groq：https://console.groq.com/docs/speech-to-text
- OpenAI：https://developers.openai.com/docs/guides/speech-to-text ，https://developers.openai.com/api/docs/pricing
- Deepgram：https://deepgram.com/pricing ，https://developers.deepgram.com/docs/models-languages-overview
- ElevenLabs：https://elevenlabs.io/docs/capabilities/speech-to-text
- AssemblyAI：https://www.assemblyai.com/pricing
- Gemini：https://ai.google.dev/gemini-api/docs/transcribe
- Mistral：https://docs.mistral.ai/studio/audio/speech_to_text/offline_transcription
- Soniox：https://soniox.com/pricing

---

## 2. LLM（解释与查词）

### 协议

两种就够了：

1. **OpenAI 兼容 Chat Completions**：OpenAI、Gemini 兼容层、DeepSeek、OpenRouter、Ollama、LM Studio、llama.cpp、mlx-lm、Jan、自定义 URL。
2. **Anthropic 原生 Messages**：它的 OpenAI 兼容层忽略 `response_format`，官方说不适合生产 [已核：https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk ]。

### 本地运行时

| 运行时 | 默认地址 | 结构化输出 |
| --- | --- | --- |
| Ollama | `localhost:11434/v1`；原生接口 `/api/tags`、`/api/chat` | 原生 `format: <JSON schema>`；`/v1` 下的 `json_schema` 未核 |
| LM Studio | `localhost:1234/v1` | 支持 `json_schema`，不支持 `json_object` |
| llama.cpp | `:8080/v1` | `json_schema` 作为语法约束 |

- mlx-lm 也用 `:8080`，官方说不适合生产。
- Jan：`:1337/v1`。
- 不内置运行时，探测用户已经装好的。
- 来源：
  - https://docs.ollama.com/api/openai-compatibility
  - https://lmstudio.ai/docs/developer/openai-compat/structured-output
  - https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md

**按内存推荐的本地模型**（推断，没有日→中解释的测评，需要实测）

| 内存 | 模型 |
| --- | --- |
| 8 GB | `qwen3.5:4b`、`gemma4:e4b` |
| 16 GB | `qwen3.5:9b`，或 `gemma4:12b` |
| 32 GB | `qwen3.6:35b`（MoE，激活 3B，约 24 GB）、`qwen3.6:27b` |

- 中日文 Qwen 最好。
- `gpt-oss:20b` 的思考关不掉。
- Ollama 有一个 bug：`format` 和 `think:false` 一起用会坏（#14645）。

### 云端价格

每百万 token，输入 / 输出，美元。

| 服务 | 模型与价格 |
| --- | --- |
| Anthropic | Haiku 5.5 $0.10 / $0.50；Sonnet 5.5 $2 / $10 [已核：https://platform.claude.com/docs/en/about-claude/pricing ] |
| OpenAI | gpt-5-nano $0.05 / $0.40；gpt-5-mini $0.25 / $2.00 [已核：https://developers.openai.com/api/docs/pricing ] |
| Gemini | 2.5 Flash-Lite $0.10 / $0.40；3.1 Flash-Lite $0.25 / $1.50；免费档数据可能被 Google 使用 [已核：https://ai.google.dev/gemini-api/docs/pricing ] |
| DeepSeek | `deepseek-flash` 闲时 $0.15 / $0.60 [已核：https://api-docs.deepseek.com/quick_start/pricing ] |

**兼容性细节**
- DeepSeek 只有 `json_object`，而且提示里必须出现 “json”。
- Gemini 兼容层还是 beta（https://ai.google.dev/gemini-api/docs/openai ），模型 id 可能带 `models/` 前缀。
- Zhipu 的路径是 `/api/paas/v4`，所以自定义地址要能填完整路径。

### Key 的保存

- 存钥匙串，所有请求从 Rust 发出。
- 测试连接：先 `GET /models`，再发一个极小的 chat 请求。
- 比较过的应用：
  - BoltAI、Msty、Zed 都把 Key 存在系统钥匙串。
  - Cherry Studio、Chatbox、Jan、Obsidian Copilot 的设置都是：选服务 → 填 Key → 拉取模型 → 测试。
  - Raycast 支持自带 Key、自定义 OpenAI 兼容服务和 Ollama。

---

## 3. 引导向导 UX

**证据**
- NN/g 对 70 人的研究：看了幻灯片式教程，任务成功率没有提高，主观难度反而更高。https://www.nngroup.com/articles/mobile-tutorials/
- NN/g 的建议：
  - 能不做引导就不做；要做就提供明显的“跳过”。
  - 上下文提示和空状态比强制教程更有效。
  - 来源：
    - https://www.nngroup.com/articles/mobile-app-onboarding/
    - https://www.nngroup.com/articles/empty-state-interface-design/
    - https://www.nngroup.com/articles/help-and-documentation/
- Apple HIG：引导要“快速、有趣、可选”；通过交互来教；推迟非必要的设置；不要让大下载挡住引导；教程之后能在帮助或设置里再找到。https://developer.apple.com/design/human-interface-guidelines/onboarding
- 快捷键：在用户走慢路径时给出短暂提示最有效（Blur、ExposeHK）。https://www.dgp.toronto.edu/~ravin/papers/chi2007_learninghotkeys.pdf

**同类应用**
- **VoiceInk**（读过源码）：本地 / 云端两张卡片；下载时锁住“继续”（反面例子）；云端要求先测试连接；可以“以后再设置”；有试一试的步骤；可以从第一个未完成的步骤继续。https://github.com/Beingpax/VoiceInk
- **Superwhisper**：本地 / 云端对比表（准备工作、隐私、离线、速度）；每类推荐一个模型。https://superwhisper.com/docs/get-started/choose-your-model.md
- **Msty**：先检测硬件再推荐；下载时可以继续使用应用。https://docs.msty.ai/studio/getting-started/quick-start
- **Jan**：每个模型标出是否适合这台机器；下载进度显示在顶栏。https://www.jan.ai/docs/desktop/manage-models
- **Readwise Reader**：用预置文档教快捷键。
- **Raycast / Buzz / Spokenly**：AI 设置都推迟到设置里。

---

## 4. OAuth 登录

| 服务 | 结论 | 依据 |
| --- | --- | --- |
| OpenRouter | **可以做**：官方 PKCE 流程，不需要注册客户端或 secret，换回一个用户自己掌控的 API Key | https://openrouter.ai/docs/use-cases/oauth-pkce |
| Sign in with ChatGPT | **可以做（预览）** | 见下文 |
| Anthropic（Claude 订阅） | **不能做**：2026-02 条款写明订阅 OAuth token 只能用于 Claude Code 和 Claude.ai，且已经封禁第三方工具 | https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/ |
| Google Gemini | **不做**：没有给第三方应用用订阅的官方途径 | — |
| Hugging Face | 可以做（`inference-api` scope），优先级低 | https://huggingface.co/docs/hub/main/en/oauth |

**Sign in with ChatGPT**
- 2026-09 DevDay 开放。
- 开源或本地运行的应用可以自助注册（动态注册，`127.0.0.1` 回调，PKCE S256）；商业应用要填申请表。
- 需要 Plus / Pro 账号。
- 只支持 Responses API，要求 `stream: true` 和 `store: false`；不支持 `temperature`、`max_output_tokens`；**不支持音频和转写**。
- 来源：
  - https://developers.openai.com/siwc/token-sharing-open-source
  - https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
