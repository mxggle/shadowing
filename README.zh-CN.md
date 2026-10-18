# Shadowing

**把你的声音，放在母语者旁边听。**

用本地音频练跟读（shadowing）的 macOS 应用：循环一句，跟着说，看看你说的和原句差在哪。日语、英语或其他语言都适用。

[English](README.md)

没有字幕、没有模型、没有 API Key 时，播放器也完整可用；字幕、转写和 AI 都是可选的。
界面有简体中文和英文两种：跟随 Mac 的语言，也可以在设置里切换。

## 跟读录音

- **每句都能录**：点句子右边的麦克风（或按 `M`），说一遍，和原句对比。不戴耳机也可以：喇叭放出的原句被麦克风录进去，录完会自动去掉，只留下你的声音。
- **两种跟读方式**：**听完再说**（先放一遍原句，然后轮到你）和**边听边说**（跟着原句一起说）。说完自动结束。
- **知道差在哪**：你的波形和原句的上下对齐，写着节奏比原句快 / 慢多少，或比原声晚多少秒。“一起听”听合不合拍。
- **一遍遍接着录**：「连续录」录完一遍自动接下一遍，满意了按空格留下这一遍。
- **整段一口气读**（`⇧M`）：读完一整段对话或全文，自己读或跟着原文读都行；读完自动按句子分开，每句都能和原文对比。也可以逐句跟读，每句录几遍自己定。
- 留下的每次录音都自动保存（连续录和逐句跟读只留你选的那一遍或最后一遍）。播放时，录过的句子下面像歌词一样展开你的录音。
- 用 AirPods 等蓝牙耳机时，改用 Mac 自带的麦克风录音，耳机里的声音不会变成打电话的音质。

## 从链接导入（插件）

- 插件给应用加新的导入方式。第一个插件是 **YouTube 导入**：复制一个 YouTube 链接，回到应用按 `⌘V`，选好字幕和文件夹就下载。音频是 YouTube 原来的 m4a 音轨（不转码），有人工字幕时一起导入。
- 在 设置 → 插件 → 从文件夹安装 里安装。YouTube 导入插件在每个版本的 [Releases](../../releases) 附件里（`Shadowing-YouTube-plugin-…-macos-arm64.zip`）。自己写插件见 [docs/plugin-dev.md](docs/plugin-dev.md)。
- 插件是运行在你 Mac 上的程序，只安装你信任的插件；只下载你有权使用的内容。

## 播放

- 打开文件夹浏览音频，变速不变调（0.5–2.0×），A–B 循环、句子循环，记住每个音频听到哪里。解码、变速、循环、输出都在 Rust 里完成，循环接回没有缝。
- 播放顺序：顺序播放、列表循环、单曲循环、播完停止。

## 字幕

- 导入 SRT / VTT（音频旁的同名字幕自动读取），或者转写：本机 Whisper（Apple Silicon），或云端服务（Groq / OpenAI / 自建兼容服务）。句子边界对齐到真实停顿，对话里区分说话人，转写时没把握的字画虚线。
- 点一句从这一句播放，`[` `]` 换句，`{` `}` 换对话段落。
- 修改字幕：改一句、断句和合并句子、查找和全部替换、AI 校对（只给建议，由你确认）。改动只存在应用自己的数据里，不改写音频旁的字幕文件。

## 解释这一句

- 译文、把整句按顺序拆成几块讲意思（需要时讲语法），还有跟读时要照着说的语气。答案会保存。
- 用你自己设置的大模型：OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter、Ollama、LM Studio、自定义服务，或用 ChatGPT 账号登录。

## 学习记录

- 今天、最近 7 天、累计练了多久，每日目标和连续达标天数。只算真正在练的时间：播放、录音，以及暂停下来跟读、看解释的时候。

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
- 没有遥测，不用注册账号。应用自己只在这些时候联网：
  - **检查更新**：打开时读 GitHub 上最新版本的 `latest.json`；
  - **你设置的 AI**：转写会上传音频给你选的服务，解释和校对会把句子发给你选的模型；选本机模型（Whisper、Ollama、LM Studio）则不出这台电脑。设置里每个功能都写明内容发到哪里。请求都从 Rust 发出，不经过网页界面；
  - **下载模型**：本机转写和区分说话人的模型在第一次用到时从 Hugging Face 下载，固定版本并校验 SHA-256。
- **你安装的插件**是独立的程序，自己联网。YouTube 导入插件会访问 YouTube，第一次用时从 GitHub 下载 yt-dlp 和 QuickJS（校验 SHA-256），之后每天最多查一次 yt-dlp 新版本。插件以你的用户权限运行，能读写你的文件，所以只安装你信任的插件。YouTube 导入插件只写自己的数据文件夹和一个暂存文件夹，应用检查过里面的文件才移进你的文件夹。
- API Key 和登录 token 只存 macOS 钥匙串，应用自己的数据文件里只有 `sk-…abcd` 这样的提示。

## 第三方

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)（MIT）和 OpenAI Whisper 模型（MIT）；
- [3D-Speaker](https://github.com/modelscope/3D-Speaker) CAM++ 声纹模型（Apache-2.0），用 [tract](https://github.com/sonos/tract) 运行；
- symphonia、cpal、rubato、signalsmith-stretch 等音频库，见 `src-tauri/Cargo.toml`；
- YouTube 导入插件用 [yt-dlp](https://github.com/yt-dlp/yt-dlp)（Unlicense）和 [QuickJS-ng](https://github.com/quickjs-ng/quickjs)（MIT），第一次用时下载；
- 自带的示例录音和文字属于公有领域，出处见 [src-tauri/samples/README.md](src-tauri/samples/README.md)。

## 许可

[MIT](LICENSE)
