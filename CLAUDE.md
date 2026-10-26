# CLAUDE.md

Shadowing：macOS 优先的 Tauri 2 桌面应用，用于本地音频的反复听和跟读。也有 Windows（x86_64）版，见下面的“Windows”一节。
产品目标与范围见 [PRODUCT.md](PRODUCT.md)，当前进度见 [PROGRESS.md](PROGRESS.md)。开工前先读这两个文件。

## 技术栈

- 前端：React 19 + TypeScript + Vite 8 + Tailwind 4 + Zustand 5，图标用 lucide-react。
- 后端：Rust（Tauri 2），版本固定在 `rust-toolchain.toml`（本地和 CI 一致，升级时一并修新的 clippy 提示）。在 macOS 上构建需要 cmake（whisper.cpp），`brew install cmake`；Windows 上不编 whisper.cpp，不用 cmake。**音频播放完全在 Rust**（`src-tauri/src/audio/`）：解码、变速、A–B 循环、输出都不经过 WebView。
- 持久化：Rust 侧一个 JSON 文件（app data 目录下的 `state.json`，原子写入）。**API Key / token 只存系统的密码库**（`ai/secrets.rs`：macOS 钥匙串，Windows 凭据管理器），state.json 里只有 `sk-…abcd` 这样的提示。

## 结构

```
src/                      前端
  lib/api.ts              唯一调用 Rust 命令的地方（除 audio/engine.ts 的 player_* 命令）
  audio/engine.ts         原生播放器的薄客户端：发命令、收 player:* 事件
  audio/logic.ts          纯函数规则（循环、恢复位置、速度），有单元测试
  store.ts                唯一的 Zustand store（字幕部分在 transcriptSlice.ts，改字幕在 correctSlice.ts，拆句 / 合并句在 reshapeSlice.ts，
                          AI 校对在 proofreadSlice.ts，解释句子在 explainSlice.ts，引导部分在 guideSlice.ts，
                          学习记录与每日目标在 practiceSlice.ts，应用内更新在 updateSlice.ts，跟读录音在 recordSlice.ts（回放录音在 takePlayback.ts），整段录音在 readingSlice.ts，逐句跟读在 drillSlice.ts，
                          插件和从链接导入在 importSlice.ts，视频画面的设置在 videoSlice.ts）
  lib/sentences.ts        句子规则（当前句、句子循环、[ ] 换句、正在放的句子逐字亮到哪），有单元测试
  lib/sections.ts         对话段落规则（分段、合并、改名、整段循环、{ } 换段），有单元测试
  lib/edits.ts            改字幕的规则（改动取整词、查找匹配、全部替换），有单元测试
  lib/reshape.ts          拆句 / 合并后跟着挪的东西（句子序号、段落、解释、建议、撤销），有单元测试
  lib/aiReady.ts          转写 / 解释是否已设置好、向导从哪一步继续，有单元测试
  lib/i18n.ts             界面语言：t() / tk() 取中文或英文（英文在 src/i18n/en/，按界面的各部分分文件），有单元测试（也检查没翻译的中文）
  lib/platform.ts         在哪个系统上跑（Windows 还是 Mac，看 WebView 的 user agent；浏览器 mock 里地址加 ?platform=windows 预览 Windows）、
                          命令键判断（isMod / isCmd）和按键名（shortcut()：⌘ → Ctrl、⇧ → Shift），有单元测试
  lib/wording.ts          Mac 和 Windows 说法不同的词（这台 Mac / 这台电脑，macOS 钥匙串 / Windows 凭据管理器），有单元测试
  lib/paths.ts            路径里的 / 和 \（面包屑的子文件夹、没有标题时用文件名），有单元测试
  lib/update.ts           更新提示里的更新说明要点、下载百分比，有单元测试
  lib/changelog.ts        新功能：把打包进应用的 CHANGELOG.md（releases.ts）读成各个版本、更新后要不要说“已更新到 …”，有单元测试
  lib/practice.ts         学习记录：按天（4 点换日）汇总练习时间、每天的目标、连续达标天数，有单元测试
  lib/takes.ts            跟读录音：哪些录音属于哪一句、两条波形怎么对齐、节奏 / 延迟的说法，有单元测试
  lib/readings.ts         整段录音：读哪些句子、哪些整段录音属于这一段、快慢的说法，有单元测试
  lib/rounds.ts           连续录（一遍遍接着录）和逐句跟读（每句最多几遍）：空格留下哪一遍、遍数输入、卡片上的说法，有单元测试
  lib/imports.ts          从链接导入：默认带哪种字幕（说的语言，不带译文）、进度的说法、下载排队（一次一个）、
                          下载中的行放在哪个分组（和 Rust 一样整理文件夹名），有单元测试
  lib/picture.ts          视频画面的布局（并排要主区 ≥ 1100px，V 轮换）、object-fit: contain 时画面在框里的位置、遮字幕带的拖动，有单元测试
  lib/videoSync.ts        视频画面跟着声音走：每 50 毫秒比一比引擎的位置和 <video> 的；差得多就往前多跳一点（跳转要的时间，按每次落下的位置校准）再稳住；只靠跳来纠正，不改速度（WebKit 改速度会卡住半秒），速度只在你改的时候跟着一次跳转改，
                          声音比画面长时停在最后一帧，有单元测试
  lib/playKey.ts          播放条的播放 / 暂停键现在管谁（录音、整段录音、回放录音、整段回放，都没有时是主播放器）、暂停后继续时还要做什么，有单元测试
  components/             UI：Stage.tsx 主区（有字幕 = 句子列表，没有 = 循环面板；视频时多一块画面，Picture.tsx：静音的 <video>、拖动条、悬停时的布局按钮，PictureMask.tsx 遮字幕的模糊带，
                          VideoStage.tsx 并排和影院，PictureMenu.tsx 播放设置里的「画面」「遮字幕」，Unsupported.tsx 放不了的 WebM / MKV 的说明；TrackTitle.tsx 音频的标题）、PlayerBar.tsx 底部播放条、
                          Loop.tsx 循环面板 / 播放条上的循环窗、PlaybackMenu.tsx 速度等设置；ui.tsx 共用的按键与表单件；
                          Transcript.tsx 句子列表，Sections.tsx 段落小标题和顶部的段落菜单，SentenceText.tsx 句子文字（查找高亮、没把握的虚线），
                          Explain.tsx 句子下的解释块、SentenceEditor.tsx 改一句（⇧↩ 断开、⌫ / ⌦ 合并）、ReplaceBar.tsx 查找和替换、Proofread.tsx AI 校对；
                          UpdateNotice.tsx 右上角的更新提示（更新后一次的“已更新到 …”也在这里），WhatsNew.tsx 新功能（菜单、设置里打开）；Recorder.tsx 句子下的跟读录音卡片（和行上的麦克风），TakeWaves.tsx 原句 / 我的两条波形，TakePeek.tsx 播放到录过的句子时展开的精简对比；
                          Reading.tsx 整段录音（开始菜单、录音时的标题条），Drill.tsx 逐句跟读（每句几遍、进行中的标题条），ReadingResult.tsx 读完的结果（段落上方一行）；
                          AddMenu.tsx 侧栏顶的 ＋（所有添加音频的方式，插件的导入也在这里；见 docs/plugin-ui.md 的插槽），
                          ImportLink.tsx 从链接导入的确认框（⌘V 或 ＋ 打开）、列表里下载中 / 排队 / 失败的一行；
                          Practice.tsx 学习记录面板（PracticeCharts.tsx 柱状图和日历，PracticeGoal.tsx 顶栏目标圆环和目标一行）；
                          settings/ 是设置面板（Plugins.tsx 插件：已装的、删除、从文件夹安装）；
                          guide/ 是引导：Welcome.tsx 欢迎页（第一次打开是 Onboarding.tsx 四步新手引导，步骤内容在 OnboardingSteps.tsx）、PracticeCoach.tsx 示例练习清单、AiWizard.tsx 等 AI 设置向导、Hint.tsx 一次性提示
  dev/smoke.ts            应用内自测脚本（只在 smoke 模式加载）
src-tauri/src/
  lib.rs                  AppState + 命令注册
  i18n.rs                 界面语言：设置里选的，或跟随 Mac（系统首选语言是中文才用中文）；tr! / pick 给 Rust 里的提示选中文或英文
  library.rs              扫描文件夹（音频、视频 mp4 / m4v / mov、列出但放不了的 webm / mkv）、路径校验（resolve_inside；路径用 dunce 规范化，Windows 上没有 `\\?\` 前缀，盘符和共享名不分大小写）
  media.rs                视频的画面：应用里只给自己用的 HTTP 服务（只听 127.0.0.1、随机端口、每次启动新的口令、核对 Host），把打开的文件夹里的视频按 Range 边读边交给 <video>；
                          不用自定义协议：WebKit 经自定义协议一帧一个请求，放不到实时（见 docs/video-plan.md）
  guide.rs                引导状态（state.json 的 guide）、打包的示例音频（samples/，见 samples/README.md 的出处）
  store.rs                state.json 读写、原子写入
  transcript.rs           每个音频的字幕：app data 里的 transcripts/，或音频旁的同名 .srt/.vtt
                          （改过的字幕只存 app data 里的副本，不改写音频旁的文件）
  timing.rs               逐字高亮用的每个字（英文是每个词）什么时候说：转写时从 Whisper 的词时间得出（只有转写的字幕有），
                          改字（逐字对比，换掉的字接替原来的时间）、拆句、合并、撤销时跟着走
  subtitles.rs            SRT / WebVTT 解析
  sections.rs             对话段落：转写 / 导入后在明显的停顿或换了一组说话人处自动分段（纯函数，不联网），
                          以及整理前端送来的分段（transcript.rs 存在字幕里，旧字幕读取时补上）
  practice/               学习记录：clock.rs 按播放器状态、录音 / 回听录音和窗口操作算“在练”的时间段（暂停 90 秒内有操作也算），
                          存在 app data 的 practice.json；音频事件经 practice::Watch 先给它看一眼
  record/                 跟读录音：mod.rs 录音的开始 / 结束，session.rs 录音线程（麦克风 + 播放器输出的副本，说完自动停，事件 recorder:*）、
                          mic.rs 麦克风、devices.rs 选麦克风（蓝牙耳机时用 Mac 自带的）、vad.rs 什么时候算说完、
                          echo.rs 去掉录进来的原声（整段估计喇叭到麦克风的路径再减掉，剩下的按频率压低）、
                          take.rs 对齐、裁剪、音量、跟读延迟，saved.rs 存在 app data 的 recordings/（每次一个 WAV + takes.json；
                          wav.rs：听完再说 / 自己读是单声道“先原句、再你”，边听边说是立体声“左原句、右你”；跟着原文读的每句不另存，
                          指向整段文件里的一段），space.rs 录音占用和清理找不到原音频的录音（设置里），
                          playback.rs 回放（引擎的 clip；watch.rs 报告放到哪、是不是放完了），rounds.rs 连续录（每遍之前把刚说完的一遍取出、有声音就放在一边，停下时留下哪一遍）；
                          配音（视频）：Meta 的 `dub`，录音时喇叭静音（`Cmd::Mute`），照边听边说做成录音但不去回声（`take::build_heard`）；每条录音记下原句在音频里从哪开始（`original_at`，按 `Mark::src` 算），回放时画面跟着它走；
                          hold.rs 暂停录音（播放键）：暂停的那段从麦克风和输出副本里一起剪掉，时间线没有缺口，原句停在原处（引擎的 `Cmd::Hold`）；
                          整段：follow.rs 自己读时跟踪读到哪一句（也记下高亮在每个句界移动的位置、读到了第几句）、segment.rs 读完按停顿 / 原文时间拆句、original.rs 从音频切出每句原文、
                          reading.rs 拼成整段 + 每句一条录音、replay.rs 整段回放（我的整段 / 一起听 / 逐句对比）
  reshape/                拆句 / 合并句 / 撤销：cut.rs 在光标处断开（按字数估时间、再挪到附近的停顿上），mod.rs 合并、
                          段落和已存的解释跟着挪
  explain/                解释这一句：把一句（带前后几句）发给「句子解释」的模型，reply.rs 只留下译文、逐块的意思和语法、语气并封顶（宽松地读，一块写错不丢整个回答），saved.rs 把答案存在 app data 的 explanations/（句子被改过就作废）
  proofread/              AI 校对：把字幕（没把握的字用〔〕标出）发给「句子解释」的模型，reply.rs 只留下能精确套用的小改动
  transcribe/             转写：pcm.rs 解码成 16 kHz 单声道、chunk.rs 在停顿处切块、cloud.rs 上传、
                          sentences.rs 把 Whisper 结果变成带时间的句子（没有标点时按 Whisper 分段断句）、
                          long.rs 过长的句子在逗号或停顿处切开、snap.rs 把句子边界对齐到真实停顿、
                          doubt.rs 把 Whisper 没把握的字标成句子里要画虚线的范围；
                          commands.rs 一次一个任务（转写 → 区分说话人），进度发 transcribe:status
  local/                  本机转写（仅 Apple Silicon）：models.rs 模型清单（固定 commit + sha256）、按芯片 / 内存 / 可用空间推荐模型、
                          system.rs 芯片、内存、可用空间（macOS sysctl / statfs，Windows 的系统接口）、
                          download.rs 可续传并校验的下载、whisper.rs whisper.cpp（只在 macOS 编译；Metal，DTW 词时间，自动识别时先判断语言）
  speakers/               区分说话人：fbank.rs 声学特征、mod.rs 用 tract 跑 3D-Speaker CAM++ 声纹模型
                          （Apache-2.0，固定 commit + sha256，第一次转写时下载到 models 文件夹）、cluster.rs 按声音分组
  ai/                     可选的 AI 服务：providers.rs 预设与模型筛选、secrets.rs 钥匙串 / 凭据管理器（pieces.rs：Windows 上太长的值拆成几条存）、http.rs 请求与中文错误、
                          chat.rs 对话接口（OpenAI 兼容 / Anthropic / Responses）、check.rs 测试连接与本机服务检测、
                          oauth.rs + openrouter.rs + chatgpt/ 浏览器登录（ChatGPT 的 token 也只存钥匙串）
  audio/                  原生播放引擎（见下）
  plugins/                插件（方案见 docs/plugin-plan.md）：app data 的 plugins/<id>/ 里一个 manifest.json + 一个程序。
                          manifest.rs 读和检查 manifest、链接规则（像浏览器扩展的 match pattern）；mod.rs 列出、删除；install.rs 从文件夹安装（原生选择框选好后，在设置里确认它会做什么，
                          不用原生确认框：选择框刚关上时弹的原生确认框会自己“通过”），选的是插件外面一层也行，更新时保留插件自己的 data/；
                          复制进来时去掉浏览器下载留下的隔离标记（带着它 macOS 会直接杀掉插件程序，复制也会保留它；Windows 上去掉 Zone.Identifier）；rpc.rs 把程序当子进程运行（环境变量清空，只留系统 PATH、HOME、代理，
                          Windows 上要的那几个见 os.rs：环境、不弹控制台窗口、取消时连子进程一起结束），
                          stdin/stdout 上每行一条 JSON-RPC 2.0，取消时先发 $/cancel、2 秒后结束进程；
                          import.rs 从链接导入（import/resolve → import/run，一次一个，进度发 import:status；clipboard.rs 读剪贴板）；
                          accept.rs 插件只写暂存文件夹，应用检查文件（不收链接出去的、不是音频的）后自己移进打开的文件夹，
                          字幕存成可移除的导入字幕（不放在音频旁边）；names.rs 用标题起文件名（Windows 不允许的字符和 CON、NUL 这类名字也处理，和 src/lib/imports.ts 一样）
  update.rs               应用内更新（tauri-plugin-updater）：读最新 Release 的 latest.json、下载签名过的 .app.tar.gz、
                          原地替换后重启；菜单里的「检查更新…」和「新功能…」（Windows 没有应用菜单，用设置里的）
  smoke.rs                调试构建专用自测入口（也装一个假的导入插件：shell 脚本，Windows 上是 .cmd + PowerShell）
plugins/youtube/          「YouTube 导入」插件：单独的小 Rust 程序（不进应用的构建），说插件协议；
                          第一次用时下载 yt-dlp 文件夹版和 QuickJS-ng（校验 SHA-256；platform.rs 选 macOS / Windows 的文件，fetch.rs 用系统的 curl 下载），
                          每天最多查一次 yt-dlp 新版本；只取 m4a 音轨（不用 ffmpeg）和人工字幕。
                          scripts/build-plugin.sh youtube [Rust target] 生成可安装的文件夹（带 target 时在 dist/<平台>/ 下）
src-tauri/tauri.windows.conf.json   只在 Windows 上叠加到 tauri.conf.json 的配置（JSON Merge Patch，数组整个替换）：
                          没有 Mac 的标题栏设置的窗口、NSIS 安装包（当前用户、简体中文和英文）、WebView2 下载式引导、含 icon.ico 的图标列表、
                          更新包（createUpdaterArtifacts：安装包本身就是更新，tauri build 用更新私钥签出 .sig）
docs/plugin-dev.md        写插件的人看的文档（manifest、协议、运行环境、打包、提交和审核）
site/                     落地页 index.html 和插件目录 plugins.html（列表是 plugins.json，scripts/check-plugin-list.mjs 检查格式；
                          提交插件用 .github/ISSUE_TEMPLATE/plugin.yml），见 site/README.md
```

## Windows

x86_64 先做；2026-10-19 在真实的 Windows 11 电脑上试过，从 0.10.0 之后的版本起随 Mac 版一起发布（仓库变量 `WINDOWS_RELEASE` 是 `true` 时，见“发布”里的 Windows）。
每一行的现状见 [PRODUCT.md](PRODUCT.md) 的“Windows 版”，做了什么见 [PROGRESS.md](PROGRESS.md)。

- 前端怎么判断系统、怎么写文案和快捷键：见“约定”里的“Mac 和 Windows”。`lib/platform.ts` 只看 WebView 的 user agent（WebView2 是 “Windows NT”，WKWebView 是 “Macintosh”）。
- 窗口：Mac 用 `titleBarStyle: Overlay`（红绿灯压在界面上）；Windows 是原生标题栏，`tauri.windows.conf.json` 里的窗口设置没有这几项。
  WebView2 是 Chromium：它自带的 F5 / Ctrl+R / Ctrl+P / Ctrl+F 在发布版里被 `useShortcuts` 拦掉（`tauri dev` 里保留，方便刷新）。
- **只有 macOS 有的**：本机转写（whisper.cpp + Metal，Windows 只提供云端转写）；代码签名（自签证书，Windows 安装包没有签名，SmartScreen 会警告“更多信息 → 仍要运行”）。
- 拿到 Windows 安装包（试用）：GitHub 的 Actions → “Release (Windows)”（手动运行；推到 `feat/windows*` 分支也会自动跑）→ 运行结果里的 Artifacts →
  `Shadowing-X.Y.Z-windows-x64`（保留 14 天，里面的 `Shadowing-X.Y.Z-windows-x64-setup.exe` 装在当前用户下，不要管理员权限；还有 `.sig` 和 Windows 版插件 zip）。
  在 Windows 上本机构建：`npx tauri build --bundles nsis --no-sign`（`createUpdaterArtifacts` 开着，没有更新私钥时要 `--no-sign`），安装包在 `src-tauri/target/release/bundle/nsis/`。
- 发布带上 Windows 要仓库变量 `WINDOWS_RELEASE` = `true`（Settings → Secrets and variables → Actions → Variables，或
  `gh variable set WINDOWS_RELEASE --body true`）；删掉它就回到只发 Mac。落地页的 Windows 按钮指向 `releases/latest/download/Shadowing-windows-x64-setup.exe`，
  最新的 Release 没有 Windows 版时是 404。第一个带 Windows 的 Release 发布以后，在 `site/plugins.json` 里给 YouTube 插件加 `windows-x86_64` 的包
  （这个 Release 里的 zip，`gh release view vX.Y.Z --json assets` 看 `digest` 和大小）。
- Rust 那边 Windows 和 macOS 不同的地方：
  - 应用数据在 `%LOCALAPPDATA%\dev.shadowing.app`（不放 Roaming：模型最大 3 GB）；macOS 照旧。
  - Key 和登录存在凭据管理器的“普通凭据”里，名字是 `<服务 id>.Shadowing`；一条最多约 1280 个字符，更长的拆成 `#a1`、`#a2`…（`ai/pieces.rs`）。ChatGPT 的 id_token 不再保存。
  - 没有应用菜单（Windows 上会变成窗口里的一行菜单栏）；检查更新和新功能在设置里。应用内更新下载 `latest.json` 里 `windows-x86_64` 的安装包，
    验过签名后运行它（passive，装完重新打开）；安装程序接手前先保存 state.json 和学习记录。`latest.json` 里没有这个平台时当作“没有更新”。
  - 打开网页用 `ShellExecuteW`（只开 http / https）；麦克风被系统设置拦住时提示去“隐私和安全性 → 麦克风”。
  - 插件：平台键 `windows-x86_64` / `windows-arm64`（ARM 上没有 arm64 程序时用 x86_64 的），程序可以是 `.exe`；详见 [docs/plugin-dev.md](docs/plugin-dev.md)。
- 在 Mac 上检查 Windows 能不能编译（不能运行）：`rustup target add x86_64-pc-windows-gnu`、`brew install mingw-w64`，然后
  `cargo clippy --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-gnu --all-targets -- -D warnings`（插件同理）。
  链接整个应用会因 GNU ld 的导出表上限失败，和代码无关；真正的构建和测试看 CI 的 Windows 任务（MSVC）。
- 仓库的 `.gitattributes` 让所有文本文件在 Windows 上也是 LF（shell 脚本和 `rustfmt --check` 都要）。

## 播放引擎（src-tauri/src/audio）

- symphonia 解码（每个音频一个解码线程，2 秒环形缓冲）→ signalsmith-stretch 变速（1.0× 时旁路）→ rubato 重采样 → cpal 输出。
- 跟读录音用到的：`Cmd::Range` 只放一段然后停在终点（循环不生效），`Cmd::Tap` 把送给声卡的样本连同主机时间和在音频里的位置（`Mark::src`）
  抄一份给录音线程（tap.rs；主机时间见 clock.rs：Windows 上设备报的时间缺失或差一秒以上时改用性能计数器），`Cmd::Clip` 在暂停的音频上放一段录音（clip.rs）。暂停录音用 `Cmd::Hold`（暂停但保留这一段的终点，
  继续时接着放；之后任何移动播放头的命令都让它作废），暂停回放用 `Cmd::HoldClip`。配音用 `Cmd::Mute`：抄给录音线程之后才把送给声卡的变成静音。
- A–B 循环在音频回调里按帧完成：设定循环时把 [A−0.3s, B] 解码进内存，越过 B 时 5ms 交叉淡化接回 A，不依赖任何定时器。
- 命令同步执行、经无锁队列（rtrb）发给引擎；状态以 `player:status` 事件约 30Hz 推送，带递增 `seq`。
  前端丢弃 `seq` 更旧的事件；改变播放头的命令直接返回最新 Status。
- whisper-rs 0.16 的 `set_abort_callback_safe` 有 bug（会让每次编码都中止），`local/whisper.rs` 改用原始回调。
- 本机转写用 DTW 词时间：普通 token 时间会把每轮第一个词放到上一轮结束处（早约 1 秒）。whisper.cpp 的 DTW 不能和
  flash attention 同时用，所以关掉了 flash attention（慢约 25%）。
- 已知限制：m4a/m4b 的 AAC 有约 23ms 编码器前置延迟未裁剪；CAF 里的 AAC 打不开。

## 约定

- 保持小：单个文件尽量 < 300 行；新增依赖需要说明理由。
- 只有用户在原生对话框里选择的文件夹（加上应用自带的只读 `samples/`）才被授权；Rust 命令访问文件前都要经过
  `AppState::audio` / `allowed`（内部用 `resolve_inside`）。
- 所有对外网络请求都从 Rust 发出（不经 WebView）；前端只传服务 id，不传 URL 或 Key 去请求。
  插件程序自己联网（它是独立进程，同样不经 WebView），但碰不到用户的文件夹和钥匙串：只写自己的 data/ 和应用给的暂存文件夹。
- 新规则优先写成纯函数并加测试（TS 放 `*.test.ts`，Rust 放模块内 `#[cfg(test)]`）。
- 用户可见文案有简体中文和英文两套。中文直接写在组件里，经过 `t()`（`lib/i18n.ts`）显示：中文本身就是 key，
  英文写在 `src/i18n/en/` 里对应的文件；模块级常量里的中文用 `tk()` 标记，显示的地方再 `t()`（不要在模块顶层调用 `t()`）。
  `src/lib/i18n.test.ts` 会找出没经过 `t()` 的中文、没有英文的 key 和用不到的英文；要原样保留的中文（语言自己的名字、
  CHANGELOG 的小标题）在同一行加 `// i18n: keep`。Rust 里给用户看的文字用 `tr!("中文 {x}", "English {x}")` 或
  `i18n::pick("中文", "English")`（`src-tauri/src/i18n.rs`）。新文案两种语言一起写。
- 界面风格“稿纸 + 播放台”（变量都在 `src/index.css`）：
  - 主区是纸（`paper`），放要听要说的原文：原文和音频标题用衬线 `font-script`（日文明朝体），应用自己的中文标题用
    `font-heading`（宋体），其余界面用系统无衬线。
  - 扁平：没有凸起、内阴影、发光，只有浮层（菜单、对话框）用 `shadow-lift`。底部播放条（`deck`）放所有播放控件：
    播放键是唯一的实心圆（`btn-ink`），其余传输按钮平时无底色、悬停才出现；动作按钮用浅色填充（`btn`），
    读数、选择器、输入框用 `tint`（半透明填充，任何底色上都一样）。按下 / 快捷键触发时按钮微缩。
  - 整体中性灰（带极淡的暖色）；**橙色 `loop` 只表示“正在循环”**，不要用在别处。被选中：列表行用 `bg-press`，
    分段选择器里是白底 + 细线。
  - 滚动区域不显示滚动条（`scrollbar-none`），在边缘用渐隐或细线提示还有内容。
  - 时间、速度、计数用等宽数字（`font-mono tabular`）；文字不小于 11px；快捷键提示放在 tooltip 和 `?` 表里，不贴在控件上；
    要提到按键时用 `Kbd`（细线框）。动效 ≤ 250ms、只缓出不回弹。
- Mac 和 Windows（`lib/platform.ts`）：只有 Windows 会变，**Mac 上的文案、快捷键、布局必须和以前一模一样**。
  - 快捷键按 Mac 的写法写（`⌘F`、`⇧↩`），显示时经过 `shortcut()` 或 `Kbd`（Windows 上是 Ctrl+F、Shift+Enter）；tooltip 里写成 `t("查找和替换 ({key})", { key: shortcut("⌘F") })`。
    判断“按了命令键”用 `isMod(e)`（Mac 仍是 ⌘ 或 Ctrl，Windows 只认 Ctrl）或 `isCmd(e)`（只认本系统自己的键：Mac 的 ⌘、Windows 的 Ctrl），不要直接读 `e.metaKey`。
  - 提到“这台 Mac”“钥匙串”：词在句末、前后本来就有空格、或只是英文时，用 `device()` / `vault()`（`lib/wording.ts`）填 `{device}` / `{vault}`。
    中文里 Mac 前后有空格而“电脑”没有，所以词在句子中间时给 Windows 单独写一句：`isWindows ? t("…这台电脑上…") : t("…这台 Mac 上…")`，两句都要有英文。
    只有 Mac 才会出现的界面（本机 Whisper 的卡片、芯片和内存）照写 Mac。
  - 顶栏给 Mac 红绿灯留的空白（`pl-20`、`pl-[84px]`）只在 Mac 上留；Windows 有自己的标题栏。路径里的分隔符用 `lib/paths.ts`，不要 `split("/")`。
  - 字体栈（`src/index.css`）里 Mac 的字体在前，Windows 的接在后面。
- 不为旧项目（~/code/lingoloop）做任何兼容或迁移；参考它的思路可以，不搬它的结构。

## 验证

```bash
npm run check                         # tsc + vite build + vitest + cargo fmt/clippy/test（应用和 plugins/youtube）
scripts/make-fixtures.sh <文件夹>       # 生成自测用的测试音频（需要 say + ffmpeg）
npm run smoke -- <文件夹>              # 构建调试版 .app，在真实应用里跑自测并打印 PASS/FAIL
                                      # （会在 18765 端口启动 scripts/fake-whisper.py 测转写全流程）
scripts/build-plugin.sh youtube       # 构建插件，生成 plugins/youtube/dist/youtube/（设置 → 插件 → 从文件夹安装）
npm run dev                           # 浏览器 + mock 后端，只用来调 UI（没有真实声音）；地址加 ?fresh 模拟第一次打开，
                                      # 加 ?platform=windows 看 Windows 的界面（Ctrl 快捷键、“这台电脑”、没有红绿灯的空白、没有本机转写）
npm run app                           # 开发模式启动应用
SHADOWING_DATA_DIR=$(mktemp -d) npm run app   # 开发模式，用一个空的数据文件夹（看第一次打开的新手引导，不动真实数据；
                                      # 加 SHADOWING_MODELS_DIR=~/Library/Application\ Support/dev.shadowing.app/models 可复用已下载的模型）
```

- smoke 模式使用临时 state 文件和内存里的 Key 存储，不影响真实数据和钥匙串。
- 真实模型手动测试（会下载到应用的 models 文件夹）：
  `SHADOWING_FIXTURES=<fixtures> SHADOWING_LONG=<几分钟的语音> cargo test --manifest-path src-tauri/Cargo.toml real_ -- --ignored --nocapture`
- AI 校对手动测试（用设置里的「句子解释」服务和钥匙串里的登录，只读 state.json 的副本，不改应用数据）：
  `SHADOWING_AUDIO=<音频>[;<音频>…] cargo test --manifest-path src-tauri/Cargo.toml --release real_proofread -- --ignored --nocapture`
- 句子解释手动测试（同样用设置里的服务和钥匙串登录，读音频已保存的字幕，不改应用数据）：
  `SHADOWING_AUDIO=<音频> SHADOWING_SENTENCES=2,5,16 cargo test --manifest-path src-tauri/Cargo.toml --release real_explain -- --ignored --nocapture`
- 跟读录音真机测试（会用 Mac 的喇叭放声音、用 `say` 当跟读的人、录麦克风）：
  `SHADOWING_OUTPUT_DEVICE="MacBook Pro Speakers" cargo test --manifest-path src-tauri/Cargo.toml --release real_record -- --ignored --nocapture`
  （`SHADOWING_OUT=<文件夹>` 留下录音；`SHADOWING_INPUT_DEVICE` 指定麦克风）。
- 插件手动测试（真实网络，先 `scripts/build-plugin.sh youtube`；`SHADOWING_PLUGIN_DATA=<文件夹>` 保留插件下载的 yt-dlp）：
  `SHADOWING_URL=<YouTube 链接> cargo test --manifest-path src-tauri/Cargo.toml real_plugin -- --ignored --nocapture`。
- 钥匙串手动测试：`cargo test --manifest-path src-tauri/Cargo.toml keychain_round_trip -- --ignored`。
- Rust 引擎另有手动测试：`cargo test --manifest-path src-tauri/Cargo.toml plays_tone -- --ignored`（真实声卡播放测试音）。
- 音质、循环边界听感、跟读节奏无法自动验证，需要用户试听反馈。汇报时区分“已实现 / 已验证 / 待验证”。

## Git

- 直接在 `main` 上小步提交，Conventional Commits（`feat:` `fix:` `docs:` `chore:` `test:`）。
- 每个可体验的交付一个提交，提交前跑 `npm run check`。
- 用户可见的变化同时写进 [CHANGELOG.md](CHANGELOG.md) 的「未发布」。

## 发布

1. 从 `main` 开 `release/vX.Y.Z` 分支：把 CHANGELOG 的「未发布」改成版本号和日期，用 `scripts/bump-version.sh X.Y.Z` 改版本号
   （`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`，
   还有落地页 `site/index.html` 上显示的版本；`scripts/check-version.sh` 检查它们一致，CI 也会查），提交 `chore(release): vX.Y.Z`，开 PR，本地检查过就合并，不等 GitHub 的检查（rebase，保留每个小提交）。
2. **打包在 Mac 上做**：在合并后的 `main` 上打附注标签 `vX.Y.Z` 并推送，然后在本机运行 `scripts/release-local.sh vX.Y.Z`（只有 Mac 时 5 分钟左右）。
   它会停掉这个标签在 Actions 上的 Mac 构建（`release.yml`），在本机用 `~/.tauri` 里的证书和更新私钥打包、签名，检查过就直接发布（加 `--draft` 只建草稿）：
   `Shadowing-X.Y.Z-macos-arm64.dmg`（给人下载的安装包）和 `.zip`，固定名字的 `Shadowing-macos-arm64.dmg` / `.zip`
   （网站的下载按钮链接 `releases/latest/download/Shadowing-macos-arm64.dmg`），应用内更新用的 `Shadowing-X.Y.Z-macos-arm64.app.tar.gz`、`.sig` 和 `latest.json`，
   说明由 `scripts/release-notes.sh` 从 CHANGELOG 生成（含安装步骤和 SHA-256）。
   Mac 不在手边时，标签在 Actions 上的构建（`.github/workflows/release.yml`）会做同样的事并建草稿，但要 20 分钟左右；两边的文件都由 `scripts/release-assets.sh` 生成，名字和内容一样。
   **Windows**（仓库变量 `WINDOWS_RELEASE` 是 `true` 时才有；没设就和以前一样只发 Mac）：Windows 的文件只能在 Actions 上构建。推标签时
   `.github/workflows/release-windows.yml` 在 windows-latest 上打 NSIS 安装包和它的 `.sig`（Actions secrets 里的更新私钥）、Windows 版 YouTube 插件
   （`scripts/release-assets-windows.sh`），只放在这次运行的 Artifacts 里，不碰 Release。`release-local.sh` 打好 Mac 版以后等这次运行、下载它的文件
   （`scripts/windows-files.sh`；从推标签起 15–25 分钟，所以整个发布要 25 分钟左右），`release-assets.sh` 把它们和 Mac 的放进同一个 Release：
   `Shadowing-X.Y.Z-windows-x64-setup.exe` 和 `.sig`、固定名字的 `Shadowing-windows-x64-setup.exe`（`releases/latest/download/Shadowing-windows-x64-setup.exe`）、
   `Shadowing-YouTube-plugin-<插件版本>-windows-x86_64.zip`；`latest.json` 同时有 `darwin-aarch64` 和 `windows-x86_64`，说明里有 Windows 的安装步骤。
   两个系统一起检查、一起发布，`latest.json` 发布以后不再改。Actions 上的草稿（`release.yml`）也一样等 Windows 的文件。
   Windows 的构建失败时：`gh run rerun <id> --failed`，过了再运行一次 `release-local.sh`；或者加 `--mac-only` 只发 Mac（Windows 上的应用留在原来的版本）。
3. 上传前 `scripts/verify-release.sh` 自动检查这些文件（说明在脚本开头：文件齐全、`latest.json` 和 `.sig` 一致、每个更新的 `.sig` 用 `tauri.conf.json`
   里的公钥验过（`scripts/update-sig.mjs`，和应用里一样）、DMG / 两种工具解压的 zip / 更新包里的应用都过得了 `site/install.sh` 的签名检查、版本号对；
   有 Windows 时还查安装包是这个版本的 NSIS 安装包、插件 zip 里是 Windows 程序，`latest.json` 里正好是这次有文件的系统），不用再手动下载检查；没过就停下，不上传。**发布的那一刻**，已装的应用
   下次打开就会提示更新（它们只读最新的已发布 Release 的 `latest.json`，草稿不影响）。Actions 建的草稿：
   `gh release download vX.Y.Z -D <空文件夹>` 后同样用 `scripts/verify-release.sh X.Y.Z <文件夹>` 检查，再 `gh release edit vX.Y.Z --draft=false --latest` 发布。

### 更新签名密钥

- 应用内更新用一对专门的签名密钥（minisign，和 Apple 签名无关）。公钥写在 `tauri.conf.json` 的 `plugins.updater.pubkey`；
  私钥**不进仓库**，放在仓库的 Actions secrets：`TAURI_SIGNING_PRIVATE_KEY`（私钥文件的内容）和
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。打标签发布时没有这两个 secret 会直接失败。
- 私钥或密码丢了，已装的应用就再也收不到更新（只能换公钥、让大家手动装一次新版本）。务必在密码管理器里备份。
- 本机 `~/.tauri/shadowing-updater.key` 和 Actions secrets 里必须是同一把：Mac 的更新在本机签，Windows 的在 Actions 上签。
  不是同一把时 `verify-release.sh` 会停下（Windows 的 `.sig` 对不上公钥）。
- `tauri build` 只打 .app；签名、DMG、zip、更新包和 latest.json 都由 `scripts/release-assets.sh` 生成（说明在脚本开头）。
  它也打包 YouTube 导入插件（`Shadowing-YouTube-plugin-<插件版本>-macos-arm64.zip`，插件自己的版本号在 `plugins/youtube/manifest.json`），
  发布说明里有安装步骤。

### 代码签名证书

- 应用用一张自己生成的证书签名（“Shadowing Code Signing”，自签名，不需要 Apple 账号）。它去不掉第一次打开时
  Gatekeeper 的拦截，但每个版本的签名身份都一样，macOS 就知道更新后还是同一个应用，**不会再弹窗要钥匙串密码**
  （ad-hoc 签名每次构建都不同，每次更新都会弹）。证书（.p12 和密码）在 `~/.tauri/shadowing-codesign.p12(.password)`，
  也在 Actions secrets：`SHADOWING_CODESIGN_P12`（base64）和 `SHADOWING_CODESIGN_PASSWORD`。务必备份；换证书会让所有用户再弹一次，`site/install.sh` 里固定的证书 SHA-1（`REQ`）也要一起改。
- 钥匙串项目名是 “Shadowing”（`ai/secrets.rs`）；0.5.1 之前叫 “dev.shadowing.app”，读到旧的会自动复制过来。
- 打包时注意：`samples/ja/` 的文件名有日文浊音，macOS 的 `tar` 和 HFS+ 会把它们改写成分解形式，签名就对不上了。
  所以更新包用 Python 的 tarfile 打，DMG 用 APFS。
- 应用没有 Apple 签名也能正常自更新：应用自己下载的文件不带隔离属性，替换后直接打开，不会被 Gatekeeper 拦。
  只有直接从“下载”文件夹打开（App Translocation）时没法替换自己，会提示先拖进“应用程序”。

## CI

- `.github/workflows/check.yml`：每个 PR 和推到 `main` 时在 macOS（Apple Silicon）上跑 `scripts/check-version.sh` 和 `npm run check`；
  另有一个 `windows` 任务（windows-latest，x86_64）在 Windows 上跑 `npm run check`。runner 没有声卡，要真实音频设备的测试照旧是 `#[ignore]`。
- `.github/workflows/release-windows.yml`（“Release (Windows)”）：Windows 安装包、它的 `.sig` 和 Windows 版插件，作为 Artifacts 保留 14 天。
  推 `v*.*.*` 标签时只在仓库变量 `WINDOWS_RELEASE` 是 `true` 时跑（给 `release-local.sh` 取用）；手动运行或推到 `feat/windows*` 分支时出一份试用的。
- `.github/workflows/release.yml`：只在推送 `v*.*.*` 标签时（本机的 `release-local.sh` 会停掉它）和手动运行时打包；PR 和 main 推送都不再在 GitHub 上打包，打包在 Mac 上做。
