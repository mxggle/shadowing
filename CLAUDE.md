# CLAUDE.md

Shadowing：macOS 优先的 Tauri 2 桌面应用，用于本地音频的反复听和跟读。
产品目标与范围见 [PRODUCT.md](PRODUCT.md)，当前进度见 [PROGRESS.md](PROGRESS.md)。开工前先读这两个文件。

## 技术栈

- 前端：React 19 + TypeScript + Vite 8 + Tailwind 4 + Zustand 5，图标用 lucide-react。
- 后端：Rust（Tauri 2）。**音频播放完全在 Rust**（`src-tauri/src/audio/`）：解码、变速、A–B 循环、输出都不经过 WebView。
- 持久化：Rust 侧一个 JSON 文件（app data 目录下的 `state.json`，原子写入）。**API Key / token 只存 macOS 钥匙串**（`ai/secrets.rs`），state.json 里只有 `sk-…abcd` 这样的提示。

## 结构

```
src/                      前端
  lib/api.ts              唯一调用 Rust 命令的地方（除 audio/engine.ts 的 player_* 命令）
  audio/engine.ts         原生播放器的薄客户端：发命令、收 player:* 事件
  audio/logic.ts          纯函数规则（循环、恢复位置、速度），有单元测试
  store.ts                唯一的 Zustand store（字幕部分在 transcriptSlice.ts）
  lib/sentences.ts        句子规则（当前句、句子循环、[ ] 换句），有单元测试
  components/             UI（settings/ 是设置面板：AI 服务、Key、模型、测试）
  dev/smoke.ts            应用内自测脚本（只在 smoke 模式加载）
src-tauri/src/
  lib.rs                  AppState + 命令注册
  library.rs              扫描文件夹、路径校验（resolve_inside）
  store.rs                state.json 读写、原子写入
  transcript.rs           每个音频的字幕：app data 里的 transcripts/，或音频旁的同名 .srt/.vtt
  subtitles.rs            SRT / WebVTT 解析
  transcribe/             转写：pcm.rs 解码成 16 kHz 单声道、chunk.rs 在停顿处切块、cloud.rs 上传、
                          sentences.rs 把 Whisper 结果变成带时间的句子；一次一个任务，进度发 transcribe:status
  ai/                     可选的 AI 服务：providers.rs 预设与模型筛选、secrets.rs 钥匙串、http.rs 请求与中文错误
  audio/                  原生播放引擎（见下）
  smoke.rs                调试构建专用自测入口
```

## 播放引擎（src-tauri/src/audio）

- symphonia 解码（每个音频一个解码线程，2 秒环形缓冲）→ signalsmith-stretch 变速（1.0× 时旁路）→ rubato 重采样 → cpal 输出。
- A–B 循环在音频回调里按帧完成：设定循环时把 [A−0.3s, B] 解码进内存，越过 B 时 5ms 交叉淡化接回 A，不依赖任何定时器。
- 命令同步执行、经无锁队列（rtrb）发给引擎；状态以 `player:status` 事件约 30Hz 推送，带递增 `seq`。
  前端丢弃 `seq` 更旧的事件；改变播放头的命令直接返回最新 Status。
- 已知限制：m4a/m4b 的 AAC 有约 23ms 编码器前置延迟未裁剪；CAF 里的 AAC 打不开。

## 约定

- 保持小：单个文件尽量 < 300 行；新增依赖需要说明理由。
- 只有用户在原生对话框里选择的文件夹才被授权；Rust 命令访问文件前都要 `resolve_inside` 校验。
- 所有对外网络请求都从 Rust 发出（不经 WebView）；前端只传服务 id，不传 URL 或 Key 去请求。
- 新规则优先写成纯函数并加测试（TS 放 `*.test.ts`，Rust 放模块内 `#[cfg(test)]`）。
- 用户可见文案用简体中文，直接写在组件里（暂不做 i18n）。
- 不为旧项目（~/code/lingoloop）做任何兼容或迁移；参考它的思路可以，不搬它的结构。

## 验证

```bash
npm run check                         # tsc + vite build + vitest + cargo fmt/clippy/test
scripts/make-fixtures.sh <文件夹>       # 生成自测用的测试音频（需要 say + ffmpeg）
npm run smoke -- <文件夹>              # 构建调试版 .app，在真实应用里跑自测并打印 PASS/FAIL
                                      # （会在 18765 端口启动 scripts/fake-whisper.py 测转写全流程）
npm run dev                           # 浏览器 + mock 后端，只用来调 UI（没有真实声音）
npm run app                           # 开发模式启动应用
```

- smoke 模式使用临时 state 文件和内存里的 Key 存储，不影响真实数据和钥匙串。
- 钥匙串手动测试：`cargo test --manifest-path src-tauri/Cargo.toml keychain_round_trip -- --ignored`。
- Rust 引擎另有手动测试：`cargo test --manifest-path src-tauri/Cargo.toml plays_tone -- --ignored`（真实声卡播放测试音）。
- 音质、循环边界听感、跟读节奏无法自动验证，需要用户试听反馈。汇报时区分“已实现 / 已验证 / 待验证”。

## Git

- 直接在 `main` 上小步提交，Conventional Commits（`feat:` `fix:` `docs:` `chore:` `test:`）。
- 每个可体验的交付一个提交，提交前跑 `npm run check`。
