# 写一个 Shadowing 插件

插件给 Shadowing 加上应用本身不带的功能。写好以后可以提交到[插件目录](https://shadowing.nihongo.day/plugins)，审过源代码就上架，谁都能下载。

这份文档写的是**插件协议 1**（Shadowing 0.9.0 起）。参考实现是 [YouTube 导入](../plugins/youtube/)（Rust，几百行）
和 [日语注音](../plugins/furigana/)（Rust，一百多行加上词典）。
为什么这样设计、以后的计划，见 [plugin-plan.md](plugin-plan.md)。

## 插件是什么

一个文件夹：

```
podcast/
  manifest.json      它是谁、程序在哪、接哪些链接、会做什么
  bin/podcast        程序本身
  data/              （应用建的）插件自己的长期数据，更新插件时保留
```

应用要用插件时启动 `bin/podcast`，在它的标准输入输出上一行一条 [JSON-RPC 2.0](https://www.jsonrpc.org/specification) 消息
（和 LSP、MCP 同一种做法），用完就结束这个进程。用什么语言写都行，只要程序能直接在用户的电脑上运行：
Rust、Go、Swift 编译出来的程序，或者用系统自带解释器的脚本（Mac 上 `#!/bin/sh`、`#!/bin/zsh`；Windows 上 `.cmd`，见[Windows](#windows)）。
别依赖 Homebrew、Python、Node：插件的 `PATH` 只有系统目录，用户的电脑上也不一定有。

现在有两个扩展点：

- **从链接导入**：用户粘贴一个链接，你的插件把音频（和字幕）下载下来，应用放进用户的文件夹。
- **注音**（应用 0.14 起）：应用把字幕的句子交给你的插件，插件说每个词怎么读，应用把读音显示在字的上方（`<ruby>`）。

导出（比如导出到 Anki）、查词典这些扩展点在计划中。

## manifest.json

```json
{
  "id": "podcast",
  "name": "播客导入",
  "version": "0.1.0",
  "protocol": 1,
  "minAppVersion": "0.9.0",
  "author": "你的名字",
  "description": "粘贴播客单集的链接，导入音频。",
  "main": { "darwin-arm64": "bin/podcast", "windows-x86_64": "bin/podcast.exe" },
  "contributes": {
    "importers": [
      { "id": "episode", "title": "播客", "match": ["https://*.example.fm/episodes/*"] }
    ]
  },
  "permissions": {
    "network": ["example.fm"],
    "runs": "只下载这一集的音频"
  }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 小写字母、数字和 `-`，以字母或数字开头，最多 40 个字。也是插件文件夹的名字，装上以后不要改 |
| `name` | 是 | 显示给用户的名字 |
| `version` | 是 | 写成 `1.2.3` |
| `protocol` | 是 | 现在是 `1` |
| `minAppVersion` | | 需要的最低应用版本，例如 `"0.9.0"`；更旧的应用会拒绝安装 |
| `author`、`description` | | 安装前和设置里显示 |
| `main` | 是 | 平台 → 插件文件夹里的程序路径。平台是 `darwin-arm64`（Apple Silicon）、`darwin-x86_64`（Intel Mac）、`windows-x86_64`、`windows-arm64`。Windows on Arm 上没有 `windows-arm64` 时用 `windows-x86_64` 的程序（Windows 11 会模拟运行）；Mac 不这样回退。路径用 `/` 分隔，不能出插件文件夹，也不能有 `:`；Windows 的程序要写全文件名（`bin/podcast.exe`） |
| `contributes.importers` | | 能导入哪些链接，见下面 |
| `contributes.readings` | | 给哪些语言注音，见[注音](#注音) |
| `contributes.settings` | | 插件自己的选项，应用画在 设置 → 插件 里，见[选项](#选项) |
| `permissions.network` | | 会联网到哪些域名 |
| `permissions.runs` | | 一句话：会下载或运行什么程序（例如“第一次使用时从 GitHub 下载 yt-dlp（约 51 MB）”） |

`permissions` 是**给人看的说明**，安装前列出来，应用拦不住一个原生程序做别的事。所以要写全、写实，审核会对照源代码看。

### 链接规则（`match`）

和浏览器扩展的 match pattern 一样：

- 必须以 `https://` 或 `http://` 开头。
- 主机名前的 `*.` 表示这个域名和它的所有子域名：`https://*.youtube.com/watch?*` 接 `www.youtube.com`、`m.youtube.com`，也接 `youtube.com`。
- 路径里的 `*` 匹配任意长的一段文字（包括空的）；其余字符原样比较。
- 一个导入可以写好几条规则，任何一条匹配就交给这个插件。

`importers` 里每一项还有 `id`（发给插件，用来区分同一个插件的几种导入）和 `title`（显示给用户，例如“YouTube”）。

### 注音（`readings`）

```json
"readings": [{ "id": "ja", "title": "日语注音", "languages": ["ja"] }]
```

`languages` 是 ISO-639-1 的语言代码。字幕没有记下语言，应用自己判断：现在只认得日语（至少五分之一的句子里有假名），
所以 `languages` 里只有 `ja` 有用。装了好几个能读同一种语言的插件时，用第一个（按插件 id 排）。

### 选项（`settings`）

```json
"settings": [
  {
    "key": "style", "type": "select", "label": "注音用", "default": "hiragana",
    "options": [{ "value": "hiragana", "label": "平假名" }, { "value": "romaji", "label": "罗马音" }]
  }
]
```

应用在 设置 → 插件 里这个插件的一行下面画出来（一组按钮），记下用户选的，每次请求时放在 `settings` 里发给插件
（`{"style":"romaji"}`；没选过就是 `default`）。现在只有 `select` 一种（应用 0.14 起）；写了应用不认识的类型，这个版本的应用会拒绝安装。
`label` 和选项的 `label` 照原样显示，不翻译。

## 协议

每导入一个链接，应用会启动插件**两次**：一次读出信息（`import/resolve`）给用户确认，用户点「下载」后再启动一次下载（`import/run`）。
每次都是先 `initialize`，再一个请求，拿到回答后应用就结束进程。

消息是 JSON-RPC 2.0，每条一行（行内不能有换行），UTF-8。应用发的请求带 `id`，插件要回一条带同一个 `id` 的 `result` 或 `error`。
插件发的通知（`progress`、`log`）不带 `id`。stdout 上不是 JSON 的行会被忽略（调试构建里会打印出来），但最好把调试输出写到 stderr。

### initialize

```json
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocol":1,"appVersion":"0.9.0","dataDir":"/Users/…/plugins/podcast/data"}}
← {"jsonrpc":"2.0","id":1,"result":{"name":"播客导入","version":"0.1.0"}}
```

`dataDir` 是插件自己的 `data/`（也是进程的工作目录）。要下载的工具、缓存都放这里，更新插件时保留。

### import/resolve：读出是什么

```json
→ {"jsonrpc":"2.0","id":2,"method":"import/resolve","params":{"url":"https://www.example.fm/episodes/42","importer":"episode"}}
← {"jsonrpc":"2.0","id":2,"result":{"title":"第 42 集：在咖啡店点单","duration":1834.5,"uploader":"Example FM","language":"ja","subtitles":[{"lang":"ja","name":"日本語"}]}}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 确认框里显示，也是文件名 |
| `duration` | | 秒 |
| `uploader` | | 作者、频道 |
| `language` | | 说的语言（`ja`、`en`…），应用用它选默认的字幕 |
| `subtitles` | | 人工字幕：`[{ "lang": "ja", "name": "日本語" }]`。没有就是 `[]` |
| `videos` | | 也能带画面时：有哪些高度、每种连声音大约多大（字节），从低到高：`[{ "height": 720, "size": 96000000 }]`。不写或 `[]` 就只给声音（应用 0.13 起） |
| `audioSize` | | 只要声音时大约多大（字节） |

要快（一两秒），用户在等。

### import/run：下载

```json
→ {"jsonrpc":"2.0","id":2,"method":"import/run","params":{"url":"https://www.example.fm/episodes/42","importer":"episode","outDir":"/Users/…/plugins/.jobs/7f3a/","subtitles":"ja"}}
← {"jsonrpc":"2.0","method":"progress","params":{"message":"下载音频","done":4200000,"total":10800000}}
← {"jsonrpc":"2.0","id":2,"result":{"title":"第 42 集：在咖啡店点单","files":[{"path":"42.m4a","kind":"audio"},{"path":"42.ja.vtt","kind":"subtitle","lang":"ja"}]}}
```

- `outDir` 是这次下载的暂存文件夹。**只往这里写**。
- `subtitles` 是用户选的字幕语言，或者 `null`（不要字幕）。
- `video` 是用户要的画面高度（resolve 时 `videos` 里的一个），或者 `null` / 没有（只要声音）。旧版本的应用不发这一项。
- 回答里的 `files`：`path` 是相对 `outDir` 的路径（或者 `outDir` 里的绝对路径），`kind` 是 `"audio"`、`"video"`（要了画面时：一个 mp4 / m4v / mov，画面 H.264，声音 AAC）或 `"subtitle"`，字幕可以带 `lang`。
  `title` 可以不写（就用 resolve 时的标题）。

### readings/run：注音

一次发这个字幕里还没读过的所有句子（应用记住读过的，改了一句只发这一句；换了选项全部重新发）：

```json
→ {"jsonrpc":"2.0","id":2,"method":"readings/run","params":{"reading":"ja","language":"ja","texts":["東京へ行く","はい"],"settings":{"style":"hiragana"}}}
← {"jsonrpc":"2.0","id":2,"result":{"results":[[{"text":"東京","ruby":"とうきょう"},{"text":"へ"},{"text":"行","ruby":"い"},{"text":"く"}],[{"text":"はい"}]]}}
```

- `results` 和 `texts` 一一对应。每句切成几段，**按顺序连起来必须正好是原句**（空格、标点都不能少），不然这一句就不显示注音。
- `ruby` 是显示在这一段上面的字，没有就不标。超过 40 个字的会被截断。
- 不发 `progress`，要快：几百句应该在一秒内回答完。30 秒还没回答，应用就取消。

### progress 和 log

```json
← {"jsonrpc":"2.0","method":"progress","params":{"message":"下载音频","done":4200000,"total":10800000}}
← {"jsonrpc":"2.0","method":"log","params":{"message":"用的是 itag 140"}}
```

`progress` 显示在列表里正在下载的那一行：`message` 是一句话，`done` / `total` 是字节（不知道总数时 `total` 写 0）。
resolve 时也可以发（例如第一次用时要先下载工具）。`log` 只在调试构建里打印。

### 出错

```json
← {"jsonrpc":"2.0","id":2,"error":{"code":1,"message":"这一集需要登录才能收听"}}
```

`message` **直接显示给用户**，所以写成一句给人看的中文，不要贴堆栈。`code` 应用不看。
插件崩了、没回答就退出时，应用显示“插件意外退出”加上 stderr 的最后一行。

### 取消

用户取消时应用发 `{"jsonrpc":"2.0","method":"$/cancel","params":{"id":2}}`。2 秒内插件没结束，应用就结束进程。
所以干活时也要读 stdin（另开一个线程读），看到 `$/cancel` 就停下、清理、退出或回一个错误。

## 运行环境

- 环境变量清空，只留：`PATH=/usr/bin:/bin:/usr/sbin:/sbin`、`LANG=en_US.UTF-8`、`HOME`、`TMPDIR` 和代理变量
  （`http_proxy`、`https_proxy`、`all_proxy`、`no_proxy`，大小写都有）。联网时请尊重代理变量，国内用户常用代理。
  Windows 上留的不一样，见[Windows](#windows)。
- 工作目录是插件的 `data/`。
- 插件**只写**自己的 `data/` 和应用给的 `outDir`，不读写用户的其他文件、不碰钥匙串、不收集使用数据。这是上架的条件。
- 要下载别的程序（像 YouTube 导入下载 yt-dlp）时：固定版本或校验官方发布的 SHA-256，下载到 `data/`，并写进 `permissions.runs`。

## 应用怎么接收结果

插件碰不到用户的文件夹，应用替它收尾：

1. 在 `files` 里找第一个能用的音频：在 `outDir` 里、是普通文件（不是链接）、不超过 4 GB，
   扩展名是 `mp3`、`m4a`、`m4b`、`aac`、`wav`、`flac`、`aif`、`aiff`、`caf` 之一。没有就报“插件没有下载到能播放的音频”。
   （Opus、WebM 应用放不了，请下载成上面的格式。）
2. 字幕取第一个 `.srt` 或 `.vtt`（不超过 20 MB），存成这个音频的导入字幕：用户能在应用里移除、改用转写。字幕不放在音频旁边。
3. 用标题起文件名（去掉 `/ : \` 等字符，Windows 留给设备的名字如 `CON`、`nul.txt` 加 `_`，重名加 “ (2)”），移进用户选的子文件夹，删掉暂存文件夹。

## 在本机试

1. 把程序和 `manifest.json` 放进一个文件夹（Rust 可以参考 [`scripts/build-plugin.sh`](../scripts/build-plugin.sh)）。
2. 在应用里打开 设置 → 插件 →「从文件夹安装…」，选这个文件夹。改了程序再装一次就会替换（`data/` 保留）。
3. 复制一个你的插件能接的链接，回到应用按 `⌘V`（Windows 上 `Ctrl+V`）。

也可以不开应用，直接在终端里喂消息：

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocol":1,"appVersion":"0.9.0","dataDir":"/tmp/podcast-data"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"import/resolve","params":{"url":"https://www.example.fm/episodes/42","importer":"episode"}}' \
  | env -i PATH=/usr/bin:/bin HOME="$HOME" ./bin/podcast
```

Windows 上在 cmd 里把消息写进一个文件再喂给它：`bin\podcast.exe < requests.jsonl`（文件存成 UTF-8）。

用开发模式运行应用（`npm run app`）时，插件的 stderr 和 `log` 会打印在终端里。

## Windows

插件在 Windows 上也是一个文件夹加一个程序，协议完全一样。不同的地方：

- **程序**：`main` 里写 `windows-x86_64`（Windows on Arm 也会用它）和程序的全名，例如 `bin/podcast.exe`。
  Rust 可以在 Mac 上交叉编译（`scripts/build-plugin.sh <插件> x86_64-pc-windows-gnu`，要先装 mingw-w64），或者在 Windows 上直接构建。
  也可以写 `.cmd`（应用经 cmd.exe 运行它），再交给系统自带的 PowerShell：要写完整路径
  `"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0podcast.ps1"`。
- **环境变量**：清空后只留 Windows 程序启动要用的：`SystemRoot`、`windir`、`SystemDrive`、`TEMP`、`TMP`、`USERPROFILE`、`LOCALAPPDATA`、
  `APPDATA`、`ProgramData`、`ProgramFiles`、`PATHEXT`、`ComSpec`、`PROCESSOR_ARCHITECTURE`、`NUMBER_OF_PROCESSORS`，
  `PATH` 是 `%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem`（不是用户自己的 `Path`），
  再加代理变量 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`（Windows 的环境变量不分大小写）。没有 `HOME`、`TMPDIR`、`LANG`。
- **没有控制台窗口**：应用启动插件时不开控制台（`CREATE_NO_WINDOW`）。插件再启动别的命令行程序时也请这样做，不然会闪出一个黑窗口。
- **系统工具用完整路径**：例如 `%SystemRoot%\System32\curl.exe`、`%SystemRoot%\System32\tar.exe`（能解 zip）。用户的 `Path` 里可能先有 Git 带的
  `curl`、`tar`，行为不一样（Git 的 `tar` 把 `C:\…` 当成远程主机）。
- **编码**：stdout 上写 UTF-8 的字节，不要用控制台代码页（中文 Windows 是 GBK）。Rust、Go 写出去的本来就是字节；
  .NET / PowerShell 自己建一个 UTF-8 的 `StreamWriter` 包住标准输出；Python 设 `PYTHONUTF8=1`。应用发来的消息也是 UTF-8。
- **路径**：`dataDir`、`outDir` 是 `C:\Users\…` 这样的路径，里面可能有中文、日文。交给不认识 Unicode 路径的旧工具时，把工作目录设到那个文件夹、只传文件名。
- **取消**：2 秒内不退出时，应用用 `taskkill /T /F` 结束插件**和它启动的所有程序**。（macOS 上只结束插件本身，所以看到 `$/cancel` 时请自己结束启动的程序。）
- **安装**：浏览器下载的 zip 解出来的文件带“来自网络”的标记（`Zone.Identifier`），应用安装时会去掉。不需要代码签名；
  开着“智能应用控制”的电脑可能拦下没有签名的程序（还没验证）。

## 打包

把插件文件夹压成 zip，解压出来是一个以 `id` 命名的文件夹：

```bash
ditto -c -k --norsrc --noextattr --keepParent podcast podcast-0.1.0-macos-arm64.zip
```

（`--norsrc --noextattr` 不带 macOS 的 `._` 文件。）不需要 Apple 的签名：浏览器下载的 zip 解压后带隔离标记，
应用安装时会去掉，插件程序照常能运行。Windows 上用系统自带的 tar 打 zip（Windows 10 1803 起都有）：

```bat
tar -a -c -f podcast-0.1.0-windows-x86_64.zip podcast
```

每个平台一个 zip，里面的 `manifest.json` 最好只写这个平台（`scripts/build-plugin.sh` 就是这样做的），
装到别的电脑上时应用会直接说“不支持这台电脑”。最好把 zip 作为源代码仓库 Release 的附件发布，用户和审核看到的是同一个文件。

## 提交到插件目录

1. 源代码放在公开的地方（GitHub 等）。
2. 发一个 Release，附上 zip。
3. 在 GitHub 上填[「提交插件」表单](https://github.com/mxggle/shadowing/issues/new?template=plugin.yml)：源代码地址、zip 的链接
   （也可以把 zip 直接拖进表单上传）、它做什么、会联网到哪里。

审核看这些：

- 读源代码：做的事和 `permissions` 写的一致；只写 `data/` 和 `outDir`；不收集数据；下载的程序固定版本或校验哈希。
- zip 是这份源代码构建的（必要时我们自己构建一次比对），里面只有插件需要的文件。
- 在真实的应用里装一次，导入一个链接。

审过以后，我们在 [`site/plugins.json`](../site/plugins.json) 里加一条，记下 zip 的地址、大小和 **SHA-256**，插件就出现在插件目录。
`scripts/check-plugin-list.mjs` 会检查格式。发新版本时再提交一次（或者直接提一个改 `plugins.json` 的 PR，写上新版本改了什么）；
SHA-256 是固定的，Release 里的文件被换掉，插件目录里的旧条目也不会指向新文件。

`plugins.json` 一条的样子：

```json
{
  "id": "podcast",
  "name": "播客导入",
  "author": "你的名字",
  "description": "粘贴播客单集的链接，导入音频。",
  "imports": ["播客"],
  "source": "https://github.com/you/shadowing-podcast",
  "version": "0.1.0",
  "minAppVersion": "0.9.0",
  "released": "2026-11-01",
  "permissions": { "network": ["example.fm"], "runs": "只下载这一集的音频" },
  "packages": {
    "darwin-arm64": { "url": "https://github.com/you/shadowing-podcast/releases/download/v0.1.0/podcast-0.1.0-macos-arm64.zip", "sha256": "…", "size": 123456 },
    "windows-x86_64": { "url": "https://github.com/you/shadowing-podcast/releases/download/v0.1.0/podcast-0.1.0-windows-x86_64.zip", "sha256": "…", "size": 234567 }
  }
}
```

`official: true` 只给 Shadowing 自己写的插件。

## 协议会怎么变

`protocol` 只增不改：加新的扩展点、新的可选字段不改版本号；要改已有消息的意思才升到 2，到时应用至少再支持协议 1 一个大版本。
