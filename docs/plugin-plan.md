# 插件系统与 YouTube 导入：方案

_2026-10-17 的设计稿，还没开始实现。实现时有变化就改这里。_

## 要解决什么

- 有些功能用的人很多，但不该放进核心应用。YouTube 下载就是一例：[PRODUCT.md](../PRODUCT.md) 写了 v1 不做 YouTube，
  它在条款上有争议，而且 YouTube 一改版就坏，修复要跟着 yt-dlp 走，等不到应用发版。
- 想让别人也能写插件，并有一个能浏览、安装、更新插件的地方（插件市场）。
- 核心应用的承诺不能被插件破坏：没有插件时一切照常；插件拿不到用户的文件夹和钥匙串里的 Key；WebView 不发网络请求。

## 先定的三件事

| 问题 | 建议 | 理由 |
| --- | --- | --- |
| 插件代码在哪里运行 | **独立进程**：插件带一个可执行文件，应用启动它，通过 stdin/stdout 用 JSON-RPC 2.0 通信（同 LSP、MCP 的做法） | 任何语言都能写；崩了、卡了不影响播放器；取消就是结束进程；YouTube 本来就要运行 yt-dlp |
| 插件能不能改界面 | **v1 不能运行自己的界面代码**。插件在 manifest 里声明要加哪些入口和选项，界面由应用按“稿纸 + 播放台”风格画 | WebView 里的脚本能调所有 Tauri 命令，Tauri 的权限只能按窗口分，不能按脚本分；界面也能保持一致 |
| 安全模型 | 和 Obsidian、VS Code 插件一样：**插件是运行在你电脑上的程序**。v1 只能装官方仓库里审过的插件，开发者模式下可以从本机文件夹装 | macOS 上没有 App Sandbox 的应用，没法可靠地限制子进程（Windows 上也一样）。限制不了就不假装能，靠审核、校验和“插件碰不到用户文件”的设计 |

### 不选的做法

- **Obsidian 式（插件 JS 跑在界面里）**：Obsidian 的插件有完整的 Node 权限；Tauri 的 WebView 没有 Node，插件要下载、运行程序还得由 Rust 代劳，
  等于把一个不受控的脚本接到所有命令上。
- **WASM（Extism / wasmtime）**：沙盒是真的，但 yt-dlp 是 Python 写的，跑不进 WASM；wasmtime 还会让应用大 10 MB 以上。
  等出现“纯计算、不需要外部程序”的插件需求再考虑。
- **只写配置（manifest 里写命令模板）**：做 YouTube 够用，第三方插件就做不了什么了。

## 整体结构

```
应用（Rust）                                   插件进程
  plugins/registry.rs  读官方插件列表（签名）
  plugins/install.rs   下载 zip → 校验 → 解包
  plugins/host.rs      启动 / JSON-RPC / 取消   ⇄ stdin/stdout ⇄  shadowing-youtube（或任何语言写的程序）
  plugins/import.rs    暂存文件夹 → 检查 → 移进当前文件夹                └─ 自己管理 yt-dlp、qjs
界面（React）
  设置 → 插件（已装 / 浏览 / 开发者模式）
  从链接导入（⌘V 粘贴链接、侧栏按钮）
```

磁盘上：

```
<app data>/plugins/
  youtube/
    manifest.json
    bin/shadowing-youtube
    data/            插件自己的长期数据（yt-dlp、qjs 放这里），更新插件时保留
  .jobs/<id>/        一次导入的暂存文件夹，结束后删掉
```

`state.json` 新增 `plugins: { "<id>": { enabled, version, settings } }`。插件需要的密钥（以后才有，例如会员视频的 cookie）
照现在的做法存钥匙串（`plugin.<id>.<key>`），启动插件时传给它。

## 插件包和 manifest

插件包是一个 zip：`manifest.json` + 可执行文件（以后可以加 `README.md`、图标）。

```json
{
  "id": "youtube",
  "name": "YouTube 导入",
  "version": "1.0.0",
  "protocol": 1,
  "minAppVersion": "0.9.0",
  "author": "Shadowing",
  "repo": "mxggle/shadowing-youtube",
  "description": "粘贴 YouTube 链接，下载音频（和人工字幕）到当前文件夹。",
  "main": { "darwin-arm64": "bin/shadowing-youtube", "windows-x86_64": "bin/shadowing-youtube.exe" },
  "contributes": {
    "importers": [
      {
        "id": "video",
        "title": "YouTube",
        "match": ["https://*.youtube.com/watch?*", "https://youtu.be/*", "https://*.youtube.com/shorts/*"],
        "options": [
          { "key": "subtitles", "type": "toggle", "label": "有人工字幕时一起下载", "default": true }
        ]
      }
    ]
  },
  "permissions": {
    "network": ["youtube.com", "googlevideo.com", "github.com"],
    "runs": "第一次使用时下载 yt-dlp（约 51 MB，解压后 124 MB）和 QuickJS（约 1 MB）"
  }
}
```

- `permissions` 是给人看的说明，安装前列出来；对原生程序做不到强制，界面上不能说成“已限制”。
- 应用校验：`id` 只能是小写字母、数字、`-`；`protocol` 是应用支持的版本；`minAppVersion` 用 semver 比（`semver` 已在依赖树里）；
  `main` 里有这台机器的架构，文件在包里且不越出插件文件夹（复用 `resolve_inside` 的思路）。

## 扩展点

v1 只做一个，接口按“以后还会有别的”来设计：

| 扩展点 | 做什么 | 时间 |
| --- | --- | --- |
| `importers` 从链接导入 | 匹配链接 → 先看信息 → 下载音频（和字幕）到暂存文件夹 → 应用移进当前文件夹 | v1 |
| `exporters` 导出 | 例如导出到 Anki：应用切好句子音频、带上原文和解释，交给插件 | 第二个，用来检验接口是不是够通用 |
| `subtitleSources` 字幕来源 | 给已有的音频找字幕（例如按记下的 YouTube 链接重新拿字幕） | 以后 |
| `lookup` 查词 | 选词查词时用词典插件 | 以后，等选词查词做了再说 |
| `readings` 注音 | 句子交给插件，插件说每个词怎么读，应用显示在字的上方 | 已做（2026-10-27，0.14）：「日语注音」插件（`plugins/furigana/`），同时做了 manifest 的 `settings`（只有 `select`） |

转写和句子解释的服务不做成扩展点：已有的“自定义 URL（OpenAI 兼容）”已经覆盖。

## 通信协议（v1）

一次导入启动一个进程，做完就退出（不常驻）。每行一条 JSON-RPC 消息。

| 方向 | 方法 | 内容 |
| --- | --- | --- |
| 应用 → 插件 | `initialize` | `{ protocol, appVersion, dataDir }`（`dataDir` 是插件的 `data/`）→ `{ name, version }` |
| 应用 → 插件 | `import/resolve` | `{ url, importer }`（`importer` 是 manifest 里匹配的那个 id）→ `{ title, duration?, uploader?, language?, subtitles: [{ lang, name }] }`，用于导入前的确认 |
| 应用 → 插件 | `import/run` | `{ url, importer, outDir, subtitles }`（`outDir` 是暂存文件夹，`subtitles` 是要带的字幕语言或 null）→ `{ files: [{ path, kind: "audio" \| "subtitle", lang? }], title? }` |
| 插件 → 应用 | `progress` | `{ message, done, total }`（字节，0 = 不知道），例如“下载 yt-dlp”“下载音频 3.2 / 9.8 MB” |
| 插件 → 应用 | `log` | 调试构建里打印到终端 |
| 应用 → 插件 | `$/cancel` | 取消；2 秒内不退出就结束进程 |

插件进程：环境变量清空，只留 `PATH`（系统目录）、`HOME`、`LANG`、`TMPDIR` 和代理变量，工作目录是插件的 `data/`。
Windows 上留的是 Windows 程序启动要用的（`SystemRoot`、只有 System32 的 `PATH`、`TEMP` / `TMP`、用户文件夹、`PATHEXT`、`ComSpec`）和代理变量，
不开控制台窗口（见 `plugins/os.rs`）。
一个请求处理完，插件回一条带同一个 `id` 的 `result` 或 `error`（`error.message` 直接显示给用户，所以写成中文的一句话）。

### 应用怎么接收结果（插件碰不到用户的文件夹）

1. 插件只往暂存文件夹 `.jobs/<id>/` 写。
2. 结束后应用检查：只收 `library::AUDIO_EXTENSIONS` 里的音频和 `.srt` / `.vtt`；路径必须在暂存文件夹里（不跟随符号链接）；大小有上限。
3. 文件名用视频标题，去掉 `/ : \` 等字符，重名加 “ (2)”。Windows 留给设备的名字（`CON`、`nul.txt`、`COM1` 等）加 `_`，在 Mac 上也一样，
   文件夹在两种电脑之间拷来拷去名字不变（`plugins/names.rs`，界面里的 `folderName` 跟它一致）。
4. 音频移进当前文件夹（默认放 `YouTube/` 子文件夹，确认时可以改），重新扫描，选中新的音频。
   字幕**不**放到音频旁边，而是和“导入字幕”一样存进 app data（`source: "imported"`，来源写“YouTube 字幕”）：
   音频旁的字幕在应用里移除不了，也就没法改用转写；而 YouTube 的人工字幕有的断句很差（见下面的原型结果）。
5. 删掉暂存文件夹。应用记下来源链接（`app data/imports.json`：音频路径 → 链接），以后“重新拿字幕”用。

没有打开文件夹时，确认框里先让用户选一个文件夹（原生对话框，和现在一样）。

## YouTube 插件

一个小的 Rust 程序 `shadowing-youtube`（单独的仓库），自己管理 yt-dlp：

- **yt-dlp**：第一次用时从 yt-dlp 的 GitHub Release 下载 **`yt-dlp_macos.zip`**（文件夹版，51 MB，解压后 124 MB，已带 YouTube 需要的解题脚本 yt-dlp-ejs），
  按它发布的 `SHA2-256SUMS` 校验。不用单文件的 `yt-dlp_macos`（35 MB）：它每次运行都重新解压，macOS 每次都要重新检查，光启动就要 6 秒；
  文件夹版只有第一次 6 秒，之后 0.17 秒。YouTube 经常改版：下载失败时提示“更新 yt-dlp”，插件设置里也能手动更新。这部分修复不需要应用发版，
  也不需要插件发版。
- **JS 运行时**：从 2025.11 起，yt-dlp 说下载 YouTube 需要一个外部 JS 运行时。实测现在默认的路径（YouTube 的 visionOS 客户端）根本不解题，
  没有运行时也能全速下载；但这随时可能变，所以还是备一个：本机装了 Deno（≥ 2.3）或 Node（≥ 22）就用它（解题 0.4 秒），
  没有就下载 QuickJS-ng 的 `qjs`（1 MB，解题 2 秒，可以接受），用 `--js-runtimes quickjs:<路径>` 指给 yt-dlp。
  QuickJS-ng 不发布校验文件，用 GitHub API 给 Release 文件算的 `digest`（sha256）校验。不下 Deno（压缩包 36 MB）。
- **格式：m4a，不转 mp3**。YouTube 几乎都有 AAC 的 m4a 音轨（itag 140，128 kbps），应用本来就能放 m4a。
  `-f "bestaudio[ext=m4a]"`，直接拿原始音轨：不重新编码、音质不损失、不用下载 ffmpeg（几十 MB）。
  没有 ffmpeg 时 yt-dlp 存下的是 DASH（分段的）m4a，并警告“只有部分播放器支持”；应用的解码器实测没问题（见下面的原型结果），这个警告不用管。
  应用的解码器不支持 Opus / WebM，所以只有 Opus 的少数视频报“没有可用的音轨”。真有人要 mp3 再加“转成 mp3”（那时才下 ffmpeg）。
- **字幕**：默认只下人工字幕（`--write-subs --sub-langs <学习语言>.* --sub-format vtt`），有就省一次转写。
  但人工字幕不一定按句子断：TED 的是一句一条；有的日语频道是按画面上的行断的，没有标点，一句话跨两条。所以存成可以移除的导入字幕，
  断得不好就移除、改用转写（确认框里也可以不勾字幕）。
  自动字幕不下：质量不如本机 Whisper，YouTube 的滚动字幕还会一句重复好几遍。没有字幕时照常走应用里的转写。
- **范围**：v1 只做单个视频（`--no-playlist`）。播放列表以后再做（确认框里列出几个、一共多长）。
- **报错**：把 yt-dlp 的常见错误翻成中文（需要登录 / 被限流 / 地区限制 / 视频不存在），原始输出放在“详细信息”里。
- **B 站**：yt-dlp 也支持，B 站的音轨也是 m4a。中文用户多在 B 站，YouTube 做稳之后加 `bilibili.com` 的匹配就行，插件可以叫“视频网站导入”。

## 界面

- **从链接导入**：
  - 在应用里按 ⌘V（焦点不在输入框时），剪贴板是链接且有插件能处理 → 弹出导入确认框；侧栏顶部有“从链接导入…”按钮；文件菜单也有一项。
  - 确认框：标题、时长、作者、有没有字幕、存到哪个子文件夹 → “下载”。
  - 进度显示在侧栏列表顶部的一行（进度条 + 取消），下载时可以继续练别的；完成后这一行变成新的音频。
  - 粘贴的是 YouTube 链接、但还没装插件 → 提示“安装 YouTube 导入插件”，点一下装好继续。这就是“把链接粘进来就能下载”的完整体验，核心应用里不带下载代码。
- **设置 → 插件**：已装的插件（名字、版本、开关、选项、卸载并显示占用空间）；“浏览”列出官方仓库的插件（官方标记、作者、说明、大小、安装）；
  有更新时显示“更新”。开发者模式下多一个“从文件夹加载…”。
- 安装前的确认框列出 `permissions`，并说清楚：“插件是运行在这台 Mac 上的程序，只装你信任的插件。”

## 插件仓库（市场）

学 Obsidian：一个公开的 GitHub 仓库（例如 `mxggle/shadowing-plugins`）放 `plugins.json`，开发者提 PR 加一条，审过合并。

> **已做（2026-10-18）**：先不另开仓库，列表放在这个仓库的 [`site/plugins.json`](../site/plugins.json)，
> 随落地页发布在 `https://shadowing.nihongo.day/plugins.json`；[插件目录页](https://shadowing.nihongo.day/plugins)（`site/plugins.html`）
> 读它列出插件（下载、SHA-256、源代码），写着怎么安装、怎么写、怎么提交。提交用 GitHub 的 issue 表单
> （`.github/ISSUE_TEMPLATE/plugin.yml`，可以直接拖 zip 上传）或改 `plugins.json` 的 PR；开发文档是 [plugin-dev.md](plugin-dev.md)。
> `scripts/check-plugin-list.mjs`（`npm test` 里有它的测试）检查格式。和下面的设计不同：`repo` 换成了 `source`（源代码地址，可以是子文件夹），
> 加了 `imports`（显示用的网站名）、`released`、`permissions`。**还没做**：`plugins.json` 的签名、应用里浏览和一键安装 / 更新。

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "youtube", "name": "YouTube 导入", "author": "Shadowing", "official": true,
      "description": "…", "repo": "mxggle/shadowing-youtube",
      "version": "1.0.0", "minAppVersion": "0.9.0",
      "packages": { "darwin-arm64": { "url": "https://github.com/…/youtube-1.0.0-darwin-arm64.zip", "sha256": "…", "size": 812345 } }
    }
  ]
}
```

- 和 Obsidian 不同的是：**列表里固定了每个版本的 SHA-256**，插件作者改了 Release 里的文件也装不上；而且 **`plugins.json` 用 minisign 签名**，
  公钥写在应用里（用一对新的密钥，不和应用更新共用）。验证用 `minisign-verify`，解包用 `zip`，都已经在依赖树里（来自 tauri-plugin-updater），
  **不加新依赖**（只需要给 tokio 打开 `process` 功能，或者直接用 `std::process` 加线程）。
- 审核时看源码和 Release 是同一个提交构建的（CI 里从源码构建、比对哈希），看它会下载、运行什么。
- 应用打开时、检查应用更新时顺便读一次列表（失败不提示）；设置里能手动刷新。
- 插件可执行文件要签名吗：应用自己下载的文件不带隔离属性，Gatekeeper 不拦（和应用内更新一样），所以不需要 Apple 签名；
  也正因为如此，必须先校验哈希再解包。

## 交付顺序（每项一个可体验的提交，提交前 `npm run check`）

0. ~~**原型**：先在终端里验证 `yt-dlp_macos` + `qjs` 能下 m4a 和人工字幕；量一下 QuickJS 解题要几秒。~~ 已做，结果见下面。
1. ~~**宿主最小版 + YouTube 插件 0.1**：开发者模式从本机文件夹加载插件；启动进程、JSON-RPC、进度、取消；`importers`；导入确认框和侧栏进度；
   暂存 → 检查 → 移进文件夹。到这一步就能“粘贴链接 → 下载 → 播放 / 转写”。~~ 已做（`feat/plugins` 分支），和上面写的不一样的地方：
   - 「从文件夹安装…」一直在设置里（还没有市场，没有它就装不了），不藏在开发者模式里。选好文件夹后，在设置里（不是原生确认框）列出 `permissions`，点「安装」才复制：选择框刚关上就弹的原生确认框不可靠，实测有一次没显示就自己返回了“安装”。
   - manifest 里没有通用的 `options`；字幕是协议里固定的一项（`import/run` 的 `subtitles`），这个应用的导入都离不开字幕。
   - 没有做：插件的开关（装了就用，不想用就删除）、`imports.json`（记下来源链接）、文件菜单里的入口。
   - 没装插件时粘贴 YouTube 链接，确认框里说“在 设置 → 插件 里安装”，带「打开设置」。
   - YouTube 插件先放在这个仓库的 `plugins/youtube/`（单独的 Cargo 项目，`npm run check` 也查它），有市场以后再搬到自己的仓库。
2. **安装和市场**：插件包格式、签名的 `plugins.json`、设置里的插件面板（浏览 / 安装 / 更新 / 卸载）、粘贴 YouTube 链接时提示安装。
   YouTube 插件挂到官方仓库，正式发布。（已做：插件包格式、网站上的插件目录和 `plugins.json`；没做：签名、应用里的浏览 / 安装 / 更新。）
3. **开放给第三方**：插件开发文档、模板仓库（Rust 和 Python 各一个示例）、提交和审核流程、仓库 CI 校验；
   做第二个扩展点（导出到 Anki）检验接口。（已做：开发文档 `plugin-dev.md`、issue 表单、`plugins.json` 的格式检查；没做：模板仓库、第二个扩展点。）
4. **以后**：插件进程的沙盒加固（`sandbox-exec` 规则，只允许写自己的 `data/` 和暂存文件夹）、播放列表、B 站、受限的插件界面。

## 新增依赖（理由）

- Rust：没有。`minisign-verify`、`zip`、`semver`、`sha2`、`reqwest` 都已在树里；`tokio` 可能要多开 `process` 功能。
- 前端：没有。
- 实际（第 1 步）：应用没有加任何依赖（进程用 `std::process` 加线程，没开 tokio 的 `process`）。
- YouTube 插件：`serde`、`serde_json`、`sha2`，下载和解压用 macOS 自带的 `curl`、`ditto`（Windows 上是系统自带的 `curl.exe`、`tar.exe`）。不进应用。
- Windows（2026-10-18）：读剪贴板用 `windows-sys`（已在依赖树里，来自 cpal 和 tauri），不启动别的程序。

## 风险 / 待验证

- **条款**：YouTube 的服务条款不允许下载（YouTube 自己提供下载的除外）。核心应用不带下载代码，插件也不内置 yt-dlp（从 yt-dlp 的 GitHub 下载），
  插件说明里写“只下载你有权使用的内容”。插件是不是放进官方仓库、是不是标“官方”，需要你决定。
- **“需要登录确认不是机器人”**：YouTube 对一些 IP 会这样要求，yt-dlp 的解法是读浏览器 cookie（`--cookies-from-browser`）。v1 不做，先看实际碰到的多不多。
- **安全**：插件是原生程序，审核是唯一的硬防线。开放第三方之前，审核流程和仓库 CI 要先到位。
- **维护**：插件市场意味着要审 PR、维护协议的兼容性。`protocol` 版本只增不改，旧插件至少再支持一个大版本。
- **PO Token / SABR**：YouTube 的 web、web_safari、mweb 客户端现在没有 PO Token 就拿不到音频（只给 SABR 流或直接跳过），
  现在能下全靠 yt-dlp 默认用的 visionOS 客户端。这是最脆弱的一环，也是 yt-dlp 要能独立更新的原因。
- 还没验证：播放列表；会员 / 年龄限制的视频；没有 m4a 的视频（测的 8 个都有）；在别的网络（例如国内经代理）下的速度；
  Intel Mac（yt-dlp 是通用二进制，`qjs` 要换 x86_64 版）。

## Windows（2026-10-18）

- 平台键沿用 `{os}-{arch}`：`windows-x86_64`、`windows-arm64`。Windows on Arm 没有 arm64 的程序时用 x86_64 的（Windows 11 会模拟运行 x64 程序），
  所以 YouTube 插件只发一个 x86_64 版。Mac 不这样回退（不一定装了 Rosetta）。
- 插件程序是 `.exe`（`.cmd` / `.bat` 也行，经 cmd.exe 运行）。启动时不开控制台窗口（`CREATE_NO_WINDOW`）。
- 取消：插件 2 秒内不退出，Windows 上用 `taskkill /T /F` 连它启动的程序（例如正在下载的 yt-dlp）一起结束。macOS 上仍只结束插件本身：
  它启动的程序往插件写输出时会因为插件已经不在而失败退出；YouTube 插件自己收到 `$/cancel` 时就会结束 yt-dlp。
- 安装：浏览器下载的 zip 解出来的文件带“来自网络”标记（`文件:Zone.Identifier`，复制也会带上），安装时和 macOS 的隔离标记一样去掉。
- YouTube 插件：yt-dlp 用文件夹版 `yt-dlp_win.zip`（x64，18 MB；arm64 是 `yt-dlp_win_arm64.zip`），同样按 GitHub API 的 `digest` 校验；
  QuickJS 用 `qjs-windows-x86_64.exe`（没有 arm64 版，arm64 上也用它）。`curl.exe`、`tar.exe` 用 System32 里的完整路径（Git 带的 `tar` 认不得 `C:\`），
  文件只用名字传给它们（工作目录设成 `data/`），不怕路径里有系统代码页表示不了的字。Windows 的 curl 检查不了证书吊销时（有些代理、杀毒软件下会这样）
  重试一次 `--ssl-no-revoke`：证书本身照常检查，下载的文件也都按 SHA-256 校验。yt-dlp 加 `PYTHONUTF8=1`，输出是 UTF-8。
- 还没在真的 Windows 上验证：上面这些都只在 Mac 上交叉编译和单元测试过；SmartScreen / Defender / 智能应用控制对插件程序和 yt-dlp 的反应；
  Windows 上的系统代理（应用自己的请求用系统代理，插件只拿到代理环境变量；macOS 上也是这样，yt-dlp 自己会读系统代理，curl 不会）。

## 原型结果（2026-10-17，第 0 步）

在这台 Mac（Apple Silicon）上，用 yt-dlp 2026.08.19、QuickJS-ng 0.17.0，环境变量清空、`PATH` 只有 `/usr/bin:/bin`（模拟插件进程，不用 Homebrew 的 ffmpeg）。

| 测什么 | 结果 |
| --- | --- |
| yt-dlp 启动 | 单文件版每次 6 秒；文件夹版第一次 6 秒，之后 0.17 秒 |
| 读视频信息（导入前的确认） | 1.3–1.6 秒 |
| 下载 11 分钟视频的音频 + 日语人工字幕 | 共 6.2 秒，音频 10.8 MB，2.4 MB/s（没有限速） |
| JS 解题（强制用要解题的 mweb 客户端量的） | QuickJS 2.0 秒（缓存没用）；Deno 0.4–0.5 秒；Node 0.4–0.5 秒 |
| 没有任何 JS 运行时 | 默认路径照常：8 个视频都拿到 m4a，只多一条警告 |
| m4a（itag 140）有没有 | 8 / 8 个视频都有（日语会话、TED、音乐等） |
| 人工字幕 | 8 个里 7 个有日语或英语的人工字幕 |
| 应用的解码器放 DASH m4a | 能放：时长 698.108 秒，和 ffprobe 完全一样；整段解码正常；跳转不到 1 毫秒，跳到 0 / 1 / 123.456 / 349 / 600 / 697 秒后的样本和 ffmpeg 重新封装的普通 m4a **逐个相同**（只有开头几帧有 4×10⁻⁶ 的解码器预热差别） |
| `subtitles.rs` 读 YouTube 的 VTT | 3 个文件（11 分钟日语、1 小时日语、20 分钟 TED 英语）分别 180 / 861 / 427 句，没有重复、没有重叠；`Kind:` / `Language:` 头正常跳过 |
| 字幕断句 | TED 和 11 分钟那个是一句一条；1 小时那个按行断、没有标点（“…1 つのテーマ大体6分ぐらいでうんえ1” / “時間ぐらい…”） |

结论：
- 方案可行，**不需要 ffmpeg，也不一定需要 JS 运行时**。插件第一次使用要下载约 52 MB（yt-dlp 文件夹版 + qjs）。
- 改了三处：yt-dlp 用文件夹版；qjs 只当备用；字幕存成可以移除的导入字幕，不放在音频旁边。
