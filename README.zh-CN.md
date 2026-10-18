# Shadowing

[English](README.md) · 简体中文

用本地音频反复听、跟读（shadowing）的 macOS 桌面应用。日语、英语或其他语言都适用。

没有字幕、没有模型、没有 API Key 时，播放器也完整可用；字幕、转写和 AI 都是可选的。界面有简体中文和英文（设置 → 界面语言，默认跟随系统）。

## 功能

- **播放**：打开文件夹浏览音频，变速不变调（0.5–2.0×），A–B 循环，记住每个音频听到哪里。解码、变速、循环、输出都在 Rust 里完成，循环接回时不依赖定时器。
- **字幕**：导入 SRT / VTT（音频旁的同名字幕自动读取），或者自己转写：
  - 本机转写（Apple Silicon，whisper.cpp + Metal）或云端服务（Groq / OpenAI / 自建兼容服务）；
  - 句子边界对齐到真实停顿，对话里区分说话人（声纹在本机运行）；
  - 转写时没把握的字画虚线。
- **练习**：点一句从这一句播放，循环一句，`[` `]` 换句，句子下面可以展开解释。
- **跟读录音**：录下自己说一句（`M`），和原句的两条波形对齐比较，看节奏快慢。可以听完再说，也可以边听边说；也能一口气录整段（`⇧M`），或逐句跟读。不戴耳机也行，录进去的原声会自动去掉。
- **修改字幕**：改一句、断句和合并句子、查找和全部替换、AI 校对（只给建议，由你确认）；改动只存在应用自己的数据里，不改写音频旁的字幕文件。
- **解释这一句**：译文、生词、语法和口语点，答案会保存。用你自己设置的大模型（OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter、Ollama、LM Studio、自定义，或 ChatGPT 账号登录）。
- **学习记录**：每天练了多久、每日目标、连续达标的天数。
- **插件**：「YouTube 导入」插件从链接把视频的音频（和人工字幕）导入到打开的文件夹里。
- 第一次打开有示例练习和 AI 设置向导。

## 安装

目前只有 **Apple Silicon** 的 macOS 版。到 [Releases](../../releases) 下载 `.dmg`，双击打开后把 Shadowing 拖进“应用程序”。装好以后有新版本时应用里会提示，点一下就能更新。

这个版本没有 Apple 公证，浏览器下载的会被系统拦下，有时提示“已损坏”。在终端运行下面这一行，它会重新下载最新版、装进“应用程序”并打开（不改系统设置，脚本在 [site/install.sh](site/install.sh)）：

```bash
curl -fsSL https://shadowing.nihongo.day/install.sh | bash
```

已经拖进“应用程序”的，也可以只去掉隔离标记：`xattr -dr com.apple.quarantine /Applications/Shadowing.app`。

## 从源码构建

需要 Rust、Node.js 和 cmake（whisper.cpp 要用）：

```bash
brew install cmake
npm install
npm run app          # 开发模式启动
npx tauri build --bundles app   # 打包 .app
```

其他命令：

```bash
npm run check        # tsc + vite build + vitest + cargo fmt / clippy / test
npm run dev          # 浏览器 + mock 后端，只用来调 UI
npm run smoke -- <文件夹>   # 构建调试版，在真实应用里跑自测（先用 scripts/make-fixtures.sh 生成测试音频）
```

代码结构、约定和手动测试方法见 [CLAUDE.md](CLAUDE.md)，产品目标见 [PRODUCT.md](PRODUCT.md)，当前进度和哪些还没验证见 [PROGRESS.md](PROGRESS.md)。

## 隐私

- 应用只访问你在对话框里选择的文件夹，加上自带的示例。
- 没有遥测。只有你用到 AI 功能时才联网，请求都从 Rust 发出：转写会上传音频给你选的服务，解释和校对会把句子发给你选的模型；选本机模型（Whisper、Ollama、LM Studio）则不出这台电脑。设置里每个功能都会写明内容发到哪里。
- API Key 和登录 token 只存 macOS 钥匙串，应用自己的数据文件里只有 `sk-…abcd` 这样的提示。
- 本机转写和区分说话人的模型在第一次用到时从 Hugging Face 下载，固定版本并校验 SHA-256。

## 第三方

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)（MIT）和 OpenAI Whisper 模型（MIT）；
- [3D-Speaker](https://github.com/modelscope/3D-Speaker) CAM++ 声纹模型（Apache-2.0），用 [tract](https://github.com/sonos/tract) 运行；
- symphonia、cpal、rubato、signalsmith-stretch 等音频库，见 `src-tauri/Cargo.toml`；
- 自带的示例录音和文字属于公有领域，出处见 [src-tauri/samples/README.md](src-tauri/samples/README.md)。

## 许可

[MIT](LICENSE)
