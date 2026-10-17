# CLAUDE.md

Shadowing：macOS 优先的 Tauri 2 桌面应用，用于本地音频的反复听和跟读。
产品目标与范围见 [PRODUCT.md](PRODUCT.md)，当前进度见 [PROGRESS.md](PROGRESS.md)。开工前先读这两个文件。

## 技术栈

- 前端：React 19 + TypeScript + Vite 8 + Tailwind 4 + Zustand 5，图标用 lucide-react。
- 后端：Rust（Tauri 2），版本固定在 `rust-toolchain.toml`（本地和 CI 一致，升级时一并修新的 clippy 提示）。构建需要 cmake（whisper.cpp），`brew install cmake`。**音频播放完全在 Rust**（`src-tauri/src/audio/`）：解码、变速、A–B 循环、输出都不经过 WebView。
- 持久化：Rust 侧一个 JSON 文件（app data 目录下的 `state.json`，原子写入）。**API Key / token 只存 macOS 钥匙串**（`ai/secrets.rs`），state.json 里只有 `sk-…abcd` 这样的提示。

## 结构

```
src/                      前端
  lib/api.ts              唯一调用 Rust 命令的地方（除 audio/engine.ts 的 player_* 命令）
  audio/engine.ts         原生播放器的薄客户端：发命令、收 player:* 事件
  audio/logic.ts          纯函数规则（循环、恢复位置、速度），有单元测试
  store.ts                唯一的 Zustand store（字幕部分在 transcriptSlice.ts，改字幕在 correctSlice.ts，拆句 / 合并句在 reshapeSlice.ts，
                          AI 校对在 proofreadSlice.ts，解释句子在 explainSlice.ts，引导部分在 guideSlice.ts，
                          学习记录与每日目标在 practiceSlice.ts，应用内更新在 updateSlice.ts，跟读录音在 recordSlice.ts（回放录音在 takePlayback.ts），整段录音在 readingSlice.ts，逐句跟读在 drillSlice.ts，
                          插件和从链接导入在 importSlice.ts）
  lib/sentences.ts        句子规则（当前句、句子循环、[ ] 换句），有单元测试
  lib/sections.ts         对话段落规则（分段、合并、改名、整段循环、{ } 换段），有单元测试
  lib/edits.ts            改字幕的规则（改动取整词、查找匹配、全部替换），有单元测试
  lib/reshape.ts          拆句 / 合并后跟着挪的东西（句子序号、段落、解释、建议、撤销），有单元测试
  lib/aiReady.ts          转写 / 解释是否已设置好、向导从哪一步继续，有单元测试
  lib/update.ts           更新提示里的更新说明要点、下载百分比，有单元测试
  lib/changelog.ts        新功能：把打包进应用的 CHANGELOG.md（releases.ts）读成各个版本、更新后要不要说“已更新到 …”，有单元测试
  lib/practice.ts         学习记录：按天（4 点换日）汇总练习时间、每天的目标、连续达标天数，有单元测试
  lib/takes.ts            跟读录音：哪些录音属于哪一句、两条波形怎么对齐、节奏 / 延迟的说法，有单元测试
  lib/readings.ts         整段录音：读哪些句子、哪些整段录音属于这一段、快慢的说法，有单元测试
  lib/rounds.ts           连续录（一遍遍接着录）和逐句跟读（每句最多几遍）：空格留下哪一遍、遍数输入、卡片上的说法，有单元测试
  lib/imports.ts          从链接导入：默认带哪种字幕（说的语言，不带译文）、进度的说法、下载排队（一次一个）、
                          下载中的行放在哪个分组（和 Rust 一样整理文件夹名），有单元测试
  lib/playKey.ts          播放条的播放 / 暂停键现在管谁（录音、整段录音、回放录音、整段回放，都没有时是主播放器）、暂停后继续时还要做什么，有单元测试
  components/             UI：Stage.tsx 主区（有字幕 = 句子列表，没有 = 循环面板）、PlayerBar.tsx 底部播放条、
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
  library.rs              扫描文件夹、路径校验（resolve_inside）
  guide.rs                引导状态（state.json 的 guide）、打包的示例音频（samples/，见 samples/README.md 的出处）
  store.rs                state.json 读写、原子写入
  transcript.rs           每个音频的字幕：app data 里的 transcripts/，或音频旁的同名 .srt/.vtt
                          （改过的字幕只存 app data 里的副本，不改写音频旁的文件）
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
                          download.rs 可续传并校验的下载、whisper.rs whisper.cpp（Metal，DTW 词时间，自动识别时先判断语言）
  speakers/               区分说话人：fbank.rs 声学特征、mod.rs 用 tract 跑 3D-Speaker CAM++ 声纹模型
                          （Apache-2.0，固定 commit + sha256，第一次转写时下载到 models 文件夹）、cluster.rs 按声音分组
  ai/                     可选的 AI 服务：providers.rs 预设与模型筛选、secrets.rs 钥匙串、http.rs 请求与中文错误、
                          chat.rs 对话接口（OpenAI 兼容 / Anthropic / Responses）、check.rs 测试连接与本机服务检测、
                          oauth.rs + openrouter.rs + chatgpt/ 浏览器登录（ChatGPT 的 token 也只存钥匙串）
  audio/                  原生播放引擎（见下）
  plugins/                插件（方案见 docs/plugin-plan.md）：app data 的 plugins/<id>/ 里一个 manifest.json + 一个程序。
                          manifest.rs 读和检查 manifest、链接规则（像浏览器扩展的 match pattern）；mod.rs 列出、删除；install.rs 从文件夹安装（原生选择框选好后，在设置里确认它会做什么，
                          不用原生确认框：选择框刚关上时弹的原生确认框会自己“通过”），选的是插件外面一层也行，更新时保留插件自己的 data/；rpc.rs 把程序当子进程运行（环境变量清空，只留系统 PATH、HOME、代理），
                          stdin/stdout 上每行一条 JSON-RPC 2.0，取消时先发 $/cancel、2 秒后结束进程；
                          import.rs 从链接导入（import/resolve → import/run，一次一个，进度发 import:status）；
                          accept.rs 插件只写暂存文件夹，应用检查文件（不收链接出去的、不是音频的）后自己移进打开的文件夹，
                          字幕存成可移除的导入字幕（不放在音频旁边）
  update.rs               应用内更新（tauri-plugin-updater）：读最新 Release 的 latest.json、下载签名过的 .app.tar.gz、
                          原地替换后重启；菜单里的「检查更新…」和「新功能…」
  smoke.rs                调试构建专用自测入口（也装一个假的导入插件：shell 脚本）
plugins/youtube/          「YouTube 导入」插件：单独的小 Rust 程序（不进应用的构建），说插件协议；
                          第一次用时下载 yt-dlp 文件夹版和 QuickJS-ng（校验 SHA-256），每天最多查一次 yt-dlp 新版本；
                          只取 m4a 音轨（不用 ffmpeg）和人工字幕。scripts/build-plugin.sh youtube 生成可安装的文件夹
```

## 播放引擎（src-tauri/src/audio）

- symphonia 解码（每个音频一个解码线程，2 秒环形缓冲）→ signalsmith-stretch 变速（1.0× 时旁路）→ rubato 重采样 → cpal 输出。
- 跟读录音用到的：`Cmd::Range` 只放一段然后停在终点（循环不生效），`Cmd::Tap` 把送给声卡的样本连同主机时间
  抄一份给录音线程（tap.rs），`Cmd::Clip` 在暂停的音频上放一段录音（clip.rs）。暂停录音用 `Cmd::Hold`（暂停但保留这一段的终点，
  继续时接着放；之后任何移动播放头的命令都让它作废），暂停回放用 `Cmd::HoldClip`。
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
- 用户可见文案用简体中文，直接写在组件里（暂不做 i18n）。
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
- 不为旧项目（~/code/lingoloop）做任何兼容或迁移；参考它的思路可以，不搬它的结构。

## 验证

```bash
npm run check                         # tsc + vite build + vitest + cargo fmt/clippy/test（应用和 plugins/youtube）
scripts/make-fixtures.sh <文件夹>       # 生成自测用的测试音频（需要 say + ffmpeg）
npm run smoke -- <文件夹>              # 构建调试版 .app，在真实应用里跑自测并打印 PASS/FAIL
                                      # （会在 18765 端口启动 scripts/fake-whisper.py 测转写全流程）
scripts/build-plugin.sh youtube       # 构建插件，生成 plugins/youtube/dist/youtube/（设置 → 插件 → 从文件夹安装）
npm run dev                           # 浏览器 + mock 后端，只用来调 UI（没有真实声音）；地址加 ?fresh 模拟第一次打开
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
   还有落地页 `site/index.html` 上显示的版本；`scripts/check-version.sh` 检查它们一致，CI 也会查），提交 `chore(release): vX.Y.Z`，开 PR，CI 绿了再合并（rebase，保留每个小提交）。
2. 在合并后的 `main` 上打附注标签 `vX.Y.Z` 并推送。`.github/workflows/release.yml` 会构建 `Shadowing-X.Y.Z-macos-arm64.dmg`（给人下载的安装包）和 `.zip`，
   建一个**草稿** Release，说明由 `scripts/release-notes.sh` 从 CHANGELOG 生成（含安装步骤和 SHA-256）。
   同时上传固定名字的 `Shadowing-macos-arm64.dmg` / `.zip`（网站的下载按钮链接 `releases/latest/download/Shadowing-macos-arm64.dmg`）和应用内更新用的 `Shadowing-X.Y.Z-macos-arm64.app.tar.gz`、`.sig` 和 `latest.json`。
   GitHub 上要 15 分钟以上；**更快的做法**是推送标签后在本机运行 `scripts/release-local.sh vX.Y.Z`（5 分钟左右）：
   它会停掉这个标签在 Actions 上的构建，在本机用 `~/.tauri` 里的证书和更新私钥打包、签名，再建草稿 Release
   （加 `--publish` 直接发布）。两边产出的文件都由 `scripts/release-assets.sh` 生成，名字和内容一样。
3. 在 GitHub 上看草稿：补上“已知限制 / 还没验证”，下载 dmg 装一次打开看看，再点发布。**点发布的那一刻**，已装的应用
   下次打开就会提示更新（它们只读最新的已发布 Release 的 `latest.json`，草稿不影响）。

### 更新签名密钥

- 应用内更新用一对专门的签名密钥（minisign，和 Apple 签名无关）。公钥写在 `tauri.conf.json` 的 `plugins.updater.pubkey`；
  私钥**不进仓库**，放在仓库的 Actions secrets：`TAURI_SIGNING_PRIVATE_KEY`（私钥文件的内容）和
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。打标签发布时没有这两个 secret 会直接失败。
- 私钥或密码丢了，已装的应用就再也收不到更新（只能换公钥、让大家手动装一次新版本）。务必在密码管理器里备份。
- `tauri build` 只打 .app；签名、DMG、zip、更新包和 latest.json 都由 `scripts/release-assets.sh` 生成（说明在脚本开头）。

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

- `.github/workflows/check.yml`：每个 PR 和推到 `main` 时在 macOS（Apple Silicon）上跑 `scripts/check-version.sh` 和 `npm run check`。
- `.github/workflows/release.yml`：推送 `v*.*.*` 标签时出草稿 Release（含签名的更新包和 latest.json）；改了 Rust 依赖的 main 推送和每周一次只构建，用来保住依赖的编译缓存（标签构建只能用 main 上存的缓存）；手动运行只构建，zip 留在 Actions 的产物里 14 天。
