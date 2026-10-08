# Transcript、转写模型、LLM 与引导向导：方案

_调研与决定：2026-10-09。实现前的设计稿，实现中有变化就改这里。调研细节和来源见 [research.md](research.md)。_

## 已定的决定（来自需求澄清）

| 问题 | 决定 |
| --- | --- |
| 用户 | 不只自用，要发布给别人：按内存推荐模型，Intel 只走云端 |
| 本轮范围 | Transcript 界面 + 本地/云端转写 + 引导向导（含 LLM 设置与测试）。句子解释、查词放下一轮 |
| 向导形态 | 首次启动：欢迎 → 用示例音频动手练一遍 → “现在设置 AI / 以后再说”。AI 设置还会在第一次点“转写”时出现，也能从设置里重新打开 |
| 本地转写引擎 | whisper.cpp（whisper-rs + Metal + Silero VAD + token 时间戳），只在 Apple Silicon 上提供 |
| 云端转写 | 一个 OpenAI 兼容客户端：Groq（默认）、OpenAI `whisper-1`、自定义 URL |
| 地区 | 先只做国际服务商，不做国内预设和下载镜像 |
| OAuth | OpenRouter（PKCE）、Sign in with ChatGPT（开源应用自助注册，预览功能）。Anthropic / Gemini 订阅登录**不做**（条款禁止 / 无官方途径） |
| 分发 | 开源、免费 |
| 示例音频 | LibriVox 公有领域录音，日语、英语各一段约 30 秒，按用户选择的学习语言使用 |

## 调研结论（要点）

### 转写
- **本地**：whisper.cpp 是唯一成熟、能直接嵌进 Rust、日英都好、带 token 级时间戳的方案。
  - 模型（Hugging Face `ggerganov/whisper.cpp`，固定 commit + sha256）：
    - 8 GB → `large-v3-turbo-q5_0`（574 MB）
    - 16 GB → `large-v3-turbo-q8_0`（874 MB）
    - 32 GB+ 可选 `large-v3`（3.1 GB，日语最准）
  - `small` 及以下日语太差，不推荐。
  - kotoba-whisper v2.0 ggml 没有标点，难以分句，暂不提供。
  - 必须显式传语言；开 VAD、`no_context`、抑制空白，减少幻觉（如结尾的「ご視聴ありがとうございました」）。
  - 待确认：whisper-rs 0.16 是否暴露 VAD 后映射回原时间轴的 `whisper_full_get_token_t0/t1`。
- **不选**：
  - Parakeet v3 不支持日语。
  - Qwen3-ASR / Cohere Transcribe 的原生运行时没有时间戳。
  - WhisperKit / Apple SpeechTranscriber 需要 Swift 桥；后者可作为以后的“免下载”选项。
- **云端**：只有 Whisper 系接口给时间戳。
  - Groq `whisper-large-v3(-turbo)`：$0.04–0.11/小时，`verbose_json` 带词/段时间戳。
  - OpenAI `whisper-1`：$0.36/小时。
  - OpenAI 的 `gpt-4o-transcribe` / `gpt-transcribe` **没有时间戳**，不能用。
  - 单文件 25 MB 上限 → 在静音处切成约 10 分钟的块再拼接。

### LLM
- 两种协议覆盖几乎所有服务：
  - OpenAI 兼容 Chat Completions：OpenAI、Gemini、DeepSeek、OpenRouter、Ollama、LM Studio、自定义 URL。
  - Anthropic 原生 Messages：它的 OpenAI 兼容层忽略 `response_format`，不适合正式使用。
- Sign in with ChatGPT 是第三条路径：只走 Responses API（`stream: true`、`store: false`），不支持转写。
- 本地：不内置运行时。探测 Ollama（`:11434`）和 LM Studio（`:1234`），也允许填自定义本地 URL。Qwen 系对中日文最好。
- Key 存 macOS 钥匙串（`keyring`），所有请求都从 Rust 发出，WebView 只知道“已设置”。`state.json` 只存非机密配置。
- 设置流程：服务商 → Key（或 OAuth 登录）→ 拉取模型列表（可手填）→ 测试。

### 向导 UX
- 依据：NN/g、Apple HIG，以及 Msty、Superwhisper、VoiceInk 等应用的做法。
- 幻灯片式教程没有效果；用示例内容动手做、在界面里给上下文提示更有效。
- 推迟非必要设置，任何时候都不阻塞播放器。
- 模型设置：本地 / 云端两张卡片对比（隐私、费用、离线、准备工作），按硬件给**一个**推荐并说明理由，下载前显示大小。
- 下载在后台继续（不学 VoiceInk 锁住“继续”），最后用示例音频试一次。
- 中途退出后，从第一个未完成的步骤继续。

## 交付顺序（每项一个可体验的提交，提交前 `npm run check`）

1. **Transcript 基础**：句子数据模型、按音频存储、导入 SRT/VTT；句子列表、当前句高亮、点句播放、点句循环（复用 A–B），上一句 / 下一句快捷键。
2. **AI 配置底座**：Rust 侧配置模型、钥匙串、HTTP 客户端、服务商预设、测试连接；设置 → AI 面板（普通表单）。
3. **云端转写**：解码到 16 kHz 单声道，在静音处分块，上传，合并词时间戳，分句（标点 + 停顿），边界吸附到静音；进度事件，可取消。
4. **本地转写**：whisper-rs + Metal，模型清单（固定 URL + sha256），断点续传下载，按内存推荐，Intel 隐藏本地选项。
5. **LLM 连接**：OpenAI 兼容 + Anthropic 原生 + 本地探测、OpenRouter OAuth、Sign in with ChatGPT（标为实验性）；测试 = 解释示例句。
6. **引导**：
   - 欢迎页（选学习语言）。
   - 示例音频动手练（减速 → 循环一句 → 跟读，做到即自动打勾）。
   - AI 设置向导（转写 → LLM → 测试），可中断续做，在第一次点“转写”时触发，设置里可重新打开，配合上下文提示。

## 新增依赖（理由）

- `reqwest`：云端转写、LLM、模型下载。
- `keyring`：钥匙串存 Key / OAuth token。
- `whisper-rs`（`metal`）：本地转写。
- `sha2`：校验模型文件。
- 前端不加新依赖。

## 风险 / 待验证

- 日语分句与时间戳精度：whisper 时间戳会漂移，需要真实素材试听。
- Groq / OpenAI 对日语“词”的切分方式未知，先用短片段实测。
- 未签名开发版访问钥匙串可能反复弹窗，尽早用签名构建测试。
- Sign in with ChatGPT 是几周前上线的预览功能，接口可能变化。
- LibriVox 片段的具体出处与许可，在加入仓库时逐个记录。
