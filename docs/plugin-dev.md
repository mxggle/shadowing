# 写一个 Shadowing 插件

插件给 Shadowing 加上应用本身不带的功能。写好以后可以提交到[插件目录](https://shadowing.nihongo.day/plugins)，审过源代码就上架，谁都能下载。

这份文档写的是**插件协议 1**（Shadowing 0.9.0 起）。参考实现是 [YouTube 导入](../plugins/youtube/)（Rust，几百行）。
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
（和 LSP、MCP 同一种做法），用完就结束这个进程。用什么语言写都行，只要程序能直接在 Mac 上运行：
Rust、Go、Swift 编译出来的程序，或者用 Mac 自带解释器的脚本（`#!/bin/sh`、`#!/bin/zsh`）。
别依赖 Homebrew、Python、Node：插件的 `PATH` 只有系统目录，用户的 Mac 上也不一定有。

现在只有一个扩展点：**从链接导入**。用户粘贴一个链接，你的插件把音频（和字幕）下载下来，应用放进用户的文件夹。
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
  "main": { "darwin-arm64": "bin/podcast" },
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
| `main` | 是 | 平台 → 插件文件夹里的程序路径。平台是 `darwin-arm64`（Apple Silicon）或 `darwin-x86_64`（Intel）。路径不能出插件文件夹 |
| `contributes.importers` | | 能导入哪些链接，见下面 |
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

要快（一两秒），用户在等。

### import/run：下载

```json
→ {"jsonrpc":"2.0","id":2,"method":"import/run","params":{"url":"https://www.example.fm/episodes/42","importer":"episode","outDir":"/Users/…/plugins/.jobs/7f3a/","subtitles":"ja"}}
← {"jsonrpc":"2.0","method":"progress","params":{"message":"下载音频","done":4200000,"total":10800000}}
← {"jsonrpc":"2.0","id":2,"result":{"title":"第 42 集：在咖啡店点单","files":[{"path":"42.m4a","kind":"audio"},{"path":"42.ja.vtt","kind":"subtitle","lang":"ja"}]}}
```

- `outDir` 是这次下载的暂存文件夹。**只往这里写**。
- `subtitles` 是用户选的字幕语言，或者 `null`（不要字幕）。
- 回答里的 `files`：`path` 是相对 `outDir` 的路径（或者 `outDir` 里的绝对路径），`kind` 是 `"audio"` 或 `"subtitle"`，字幕可以带 `lang`。
  `title` 可以不写（就用 resolve 时的标题）。

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
- 工作目录是插件的 `data/`。
- 插件**只写**自己的 `data/` 和应用给的 `outDir`，不读写用户的其他文件、不碰钥匙串、不收集使用数据。这是上架的条件。
- 要下载别的程序（像 YouTube 导入下载 yt-dlp）时：固定版本或校验官方发布的 SHA-256，下载到 `data/`，并写进 `permissions.runs`。

## 应用怎么接收结果

插件碰不到用户的文件夹，应用替它收尾：

1. 在 `files` 里找第一个能用的音频：在 `outDir` 里、是普通文件（不是链接）、不超过 4 GB，
   扩展名是 `mp3`、`m4a`、`m4b`、`aac`、`wav`、`flac`、`aif`、`aiff`、`caf` 之一。没有就报“插件没有下载到能播放的音频”。
   （Opus、WebM 应用放不了，请下载成上面的格式。）
2. 字幕取第一个 `.srt` 或 `.vtt`（不超过 20 MB），存成这个音频的导入字幕：用户能在应用里移除、改用转写。字幕不放在音频旁边。
3. 用标题起文件名（去掉 `/ : \` 等字符，重名加 “ (2)”），移进用户选的子文件夹，删掉暂存文件夹。

## 在本机试

1. 把程序和 `manifest.json` 放进一个文件夹（Rust 可以参考 [`scripts/build-plugin.sh`](../scripts/build-plugin.sh)）。
2. 在应用里打开 设置 → 插件 →「从文件夹安装…」，选这个文件夹。改了程序再装一次就会替换（`data/` 保留）。
3. 复制一个你的插件能接的链接，回到应用按 `⌘V`。

也可以不开应用，直接在终端里喂消息：

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocol":1,"appVersion":"0.9.0","dataDir":"/tmp/podcast-data"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"import/resolve","params":{"url":"https://www.example.fm/episodes/42","importer":"episode"}}' \
  | env -i PATH=/usr/bin:/bin HOME="$HOME" ./bin/podcast
```

用开发模式运行应用（`npm run app`）时，插件的 stderr 和 `log` 会打印在终端里。

## 打包

把插件文件夹压成 zip，解压出来是一个以 `id` 命名的文件夹：

```bash
ditto -c -k --norsrc --noextattr --keepParent podcast podcast-0.1.0-macos-arm64.zip
```

（`--norsrc --noextattr` 不带 macOS 的 `._` 文件。）不需要 Apple 的签名：浏览器下载的 zip 解压后带隔离标记，
应用安装时会去掉，插件程序照常能运行。最好把 zip 作为源代码仓库 Release 的附件发布，用户和审核看到的是同一个文件。

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
    "darwin-arm64": { "url": "https://github.com/you/shadowing-podcast/releases/download/v0.1.0/podcast-0.1.0-macos-arm64.zip", "sha256": "…", "size": 123456 }
  }
}
```

`official: true` 只给 Shadowing 自己写的插件。

## 协议会怎么变

`protocol` 只增不改：加新的扩展点、新的可选字段不改版本号；要改已有消息的意思才升到 2，到时应用至少再支持协议 1 一个大版本。
