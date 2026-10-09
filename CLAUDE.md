# CLAUDE.md

Shadowing：macOS 优先的 Tauri 2 桌面应用，用于本地音频的反复听和跟读。
产品目标与范围见 [PRODUCT.md](PRODUCT.md)，当前进度见 [PROGRESS.md](PROGRESS.md)。开工前先读这两个文件。

## 技术栈

- 前端：React 19 + TypeScript + Vite 8 + Tailwind 4 + Zustand 5，图标用 lucide-react。
- 后端：Rust（Tauri 2）。构建需要 cmake（whisper.cpp），`brew install cmake`。**音频播放完全在 Rust**（`src-tauri/src/audio/`）：解码、变速、A–B 循环、输出都不经过 WebView。
- 持久化：Rust 侧一个 JSON 文件（app data 目录下的 `state.json`，原子写入）。**API Key / token 只存 macOS 钥匙串**（`ai/secrets.rs`），state.json 里只有 `sk-…abcd` 这样的提示。

## 结构

```
src/                      前端
  lib/api.ts              唯一调用 Rust 命令的地方（除 audio/engine.ts 的 player_* 命令）
  audio/engine.ts         原生播放器的薄客户端：发命令、收 player:* 事件
  audio/logic.ts          纯函数规则（循环、恢复位置、速度），有单元测试
  store.ts                唯一的 Zustand store（字幕部分在 transcriptSlice.ts，改字幕在 correctSlice.ts，
                          AI 校对在 proofreadSlice.ts，解释句子在 explainSlice.ts，引导部分在 guideSlice.ts）
  lib/sentences.ts        句子规则（当前句、句子循环、[ ] 换句），有单元测试
  lib/edits.ts            改字幕的规则（改动取整词、查找匹配、全部替换），有单元测试
  lib/aiReady.ts          转写 / 解释是否已设置好、向导从哪一步继续，有单元测试
  components/             UI：Stage.tsx 主区（有字幕 = 句子列表，没有 = 循环面板）、PlayerBar.tsx 底部播放条、
                          Loop.tsx 循环面板 / 播放条上的循环窗、PlaybackMenu.tsx 速度等设置；ui.tsx 共用的按键与表单件；
                          Transcript.tsx 句子列表，SentenceText.tsx 句子文字（查找高亮、没把握的虚线），
                          Explain.tsx 句子下的解释块、SentenceEditor.tsx 改一句、ReplaceBar.tsx 查找和替换、Proofread.tsx AI 校对；
                          settings/ 是设置面板；
                          guide/ 是引导：Welcome.tsx 欢迎页、PracticeCoach.tsx 示例练习清单、AiWizard.tsx 等 AI 设置向导、Hint.tsx 一次性提示
  dev/smoke.ts            应用内自测脚本（只在 smoke 模式加载）
src-tauri/src/
  lib.rs                  AppState + 命令注册
  library.rs              扫描文件夹、路径校验（resolve_inside）
  guide.rs                引导状态（state.json 的 guide）、打包的示例音频（samples/，见 samples/README.md 的出处）
  store.rs                state.json 读写、原子写入
  transcript.rs           每个音频的字幕：app data 里的 transcripts/，或音频旁的同名 .srt/.vtt
                          （改过的字幕只存 app data 里的副本，不改写音频旁的文件）
  subtitles.rs            SRT / WebVTT 解析
  explain/                解释这一句：把一句（带前后几句）发给「句子解释」的模型，reply.rs 只留下译文、生词、语法点并封顶
  proofread/              AI 校对：把字幕（没把握的字用〔〕标出）发给「句子解释」的模型，reply.rs 只留下能精确套用的小改动
  transcribe/             转写：pcm.rs 解码成 16 kHz 单声道、chunk.rs 在停顿处切块、cloud.rs 上传、
                          sentences.rs 把 Whisper 结果变成带时间的句子（没有标点时按 Whisper 分段断句）、
                          long.rs 过长的句子在逗号或停顿处切开、snap.rs 把句子边界对齐到真实停顿、
                          doubt.rs 把 Whisper 没把握的字标成句子里要画虚线的范围；
                          commands.rs 一次一个任务（转写 → 区分说话人），进度发 transcribe:status
  local/                  本机转写（仅 Apple Silicon）：models.rs 模型清单（固定 commit + sha256）与内存适配、
                          download.rs 可续传并校验的下载、whisper.rs whisper.cpp（Metal，DTW 词时间，自动识别时先判断语言）
  speakers/               区分说话人：fbank.rs 声学特征、mod.rs 用 tract 跑 3D-Speaker CAM++ 声纹模型
                          （Apache-2.0，固定 commit + sha256，第一次转写时下载到 models 文件夹）、cluster.rs 按声音分组
  ai/                     可选的 AI 服务：providers.rs 预设与模型筛选、secrets.rs 钥匙串、http.rs 请求与中文错误、
                          chat.rs 对话接口（OpenAI 兼容 / Anthropic / Responses）、check.rs 测试连接与本机服务检测、
                          oauth.rs + openrouter.rs + chatgpt/ 浏览器登录（ChatGPT 的 token 也只存钥匙串）
  audio/                  原生播放引擎（见下）
  smoke.rs                调试构建专用自测入口
```

## 播放引擎（src-tauri/src/audio）

- symphonia 解码（每个音频一个解码线程，2 秒环形缓冲）→ signalsmith-stretch 变速（1.0× 时旁路）→ rubato 重采样 → cpal 输出。
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
npm run check                         # tsc + vite build + vitest + cargo fmt/clippy/test
scripts/make-fixtures.sh <文件夹>       # 生成自测用的测试音频（需要 say + ffmpeg）
npm run smoke -- <文件夹>              # 构建调试版 .app，在真实应用里跑自测并打印 PASS/FAIL
                                      # （会在 18765 端口启动 scripts/fake-whisper.py 测转写全流程）
npm run dev                           # 浏览器 + mock 后端，只用来调 UI（没有真实声音）；地址加 ?fresh 模拟第一次打开
npm run app                           # 开发模式启动应用
```

- smoke 模式使用临时 state 文件和内存里的 Key 存储，不影响真实数据和钥匙串。
- 真实模型手动测试（会下载到应用的 models 文件夹）：
  `SHADOWING_FIXTURES=<fixtures> SHADOWING_LONG=<几分钟的语音> cargo test --manifest-path src-tauri/Cargo.toml real_ -- --ignored --nocapture`
- AI 校对手动测试（用设置里的「句子解释」服务和钥匙串里的登录，只读 state.json 的副本，不改应用数据）：
  `SHADOWING_AUDIO=<音频>[;<音频>…] cargo test --manifest-path src-tauri/Cargo.toml --release real_proofread -- --ignored --nocapture`
- 钥匙串手动测试：`cargo test --manifest-path src-tauri/Cargo.toml keychain_round_trip -- --ignored`。
- Rust 引擎另有手动测试：`cargo test --manifest-path src-tauri/Cargo.toml plays_tone -- --ignored`（真实声卡播放测试音）。
- 音质、循环边界听感、跟读节奏无法自动验证，需要用户试听反馈。汇报时区分“已实现 / 已验证 / 待验证”。

## Git

- 直接在 `main` 上小步提交，Conventional Commits（`feat:` `fix:` `docs:` `chore:` `test:`）。
- 每个可体验的交付一个提交，提交前跑 `npm run check`。
