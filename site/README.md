# 落地页

`site/` 是 Shadowing 的落地页：一个静态页面，不需要构建。

- `index.html`：页面本身（样式和脚本都内联）。「试一句」的示例播放器用 `gongitsune.mp3`，它是 `src-tauri/samples/ja/ごんぎつね.mp3` 的副本（公有领域，出处见 `src-tauri/samples/README.md`）。示例里的「跟读」按钮在浏览器里录一句、和原句并排画两条波形，录音只留在访客的浏览器里，不上传。
- `shots/`：页面上的应用截图，浅色和深色各一套（`*-light.webp` / `*-dark.webp`，无损 WebP，2× 像素），`*-crop-*` 是手机宽度用的裁切版。这些是真实界面，取自宣传视频工程（本地 `video/`）的舞台画面：去掉字幕层、相机复位、2× 渲染后导出。界面改版后要重新导出一套，文件名不变就不用改页面。
- `og.png`：分享到社交平台时的预览图（1200×630），用浅色首屏截图拼的。
- 「更新」一节是手写的版本列表，发新版时顺手在最上面加一行（版本、日期、一句话），保持和 `CHANGELOG.md` 一致。
- 下载按钮指向 `releases/latest/download/Shadowing-macos-arm64.dmg`，发布流程每次都会上传这个固定名字的 .dmg 安装包，所以发版后不用改页面。
- `plugins.html`（线上是 `/plugins`，`vercel.json` 的 `cleanUrls`）：插件目录。列表来自同一文件夹的 `plugins.json`，页面用脚本读出来画成卡片
  （全部按文字插入，只跟随 https 链接）；下面是安装步骤、怎么写插件、怎么提交。样式里的颜色变量、按钮、导航、页脚是从 `index.html` 复制的，改了那边记得同步。
- `plugins.json`：上架的插件，每条固定 zip 的地址、大小和 SHA-256（格式见 [docs/plugin-dev.md](../docs/plugin-dev.md) 末尾）。
  **上架一个插件**：读源代码、核对 zip、在应用里装一次，然后在这里加一条（`shasum -a 256` 算哈希，GitHub Release 的附件也能用
  `gh release view <tag> --json assets` 看 `digest`）。`node scripts/check-plugin-list.mjs` 检查格式（`npm test` 也会查）。
  YouTube 插件发新版本时，把它的条目换成新 Release 里那个 zip。提交入口是 GitHub 的 issue 表单 `.github/ISSUE_TEMPLATE/plugin.yml`。
- 首页的「插件」一节（`#plugins`）里那个导入确认框和下载中的两行是照应用的 `ImportLink.tsx` 用 HTML 画的，不是截图；应用里的样子变了要跟着改。
- `install.sh`：一键安装脚本，用户在终端运行 `curl -fsSL https://shadowing.nihongo.day/install.sh | bash`。它用 curl 下载最新的 .dmg（curl 下载的文件没有隔离标记，打开时不会说“已损坏”），挂载后把 Shadowing.app 复制进“应用程序”（替换旧版、先关掉正在运行的），校验签名（只认 Shadowing 自己的证书，哈希写在脚本里）再打开。安装一节的命令框和 README、Release 说明里都用这一行。`vercel.json` 让它以 `text/plain` 返回，浏览器里能直接看内容。
- 部署：Vercel 导入本仓库，Root Directory 填 `site`，Framework Preset 选 Other，不需要 Build Command。合并到 `main` 就自动上线。
- 访问统计：Vercel Web Analytics（项目的 Analytics 页里已开启）。`index.html` 的 `<head>` 末尾加载 `/_vercel/insights/script.js`，这个地址只在 Vercel 部署上有，本地预览时 404 是正常的。
- 页面上显示的版本号（`data-app-version`）在发版时由 `scripts/bump-version.sh` 一起改，`scripts/check-version.sh` 会检查它和应用版本一致。

本地预览：`npx serve site`（和 Vercel 一样，`/plugins` 能打开 `plugins.html`）。跟读按钮要用麦克风，只能在 `localhost` 或 https 下用，直接双击打开 `index.html` 不行。
