# 落地页

`site/` 是 Shadowing 的落地页：一个静态页面，不需要构建。

- `index.html`：页面本身（样式和脚本都内联）。「试一句」的示例播放器用 `gongitsune.mp3`，它是 `src-tauri/samples/ja/ごんぎつね.mp3` 的副本（公有领域，出处见 `src-tauri/samples/README.md`）。示例里的「跟读」按钮在浏览器里录一句、和原句并排画两条波形，录音只留在访客的浏览器里，不上传。
- `shots/`：页面上的应用截图，浅色和深色各一套（`*-light.webp` / `*-dark.webp`，无损 WebP，2× 像素），`*-crop-*` 是手机宽度用的裁切版。这些是真实界面，取自宣传视频工程（本地 `video/`）的舞台画面：去掉字幕层、相机复位、2× 渲染后导出。界面改版后要重新导出一套，文件名不变就不用改页面。
- `og.png`：分享到社交平台时的预览图（1200×630），用浅色首屏截图拼的。
- 「更新」一节是手写的版本列表，发新版时顺手在最上面加一行（版本、日期、一句话），保持和 `CHANGELOG.md` 一致。
- 下载按钮指向 `releases/latest/download/Shadowing-macos-arm64.dmg`，发布流程每次都会上传这个固定名字的 .dmg 安装包，所以发版后不用改页面。
- 部署：Vercel 导入本仓库，Root Directory 填 `site`，Framework Preset 选 Other，不需要 Build Command。合并到 `main` 就自动上线。
- 访问统计：Vercel Web Analytics（项目的 Analytics 页里已开启）。`index.html` 的 `<head>` 末尾加载 `/_vercel/insights/script.js`，这个地址只在 Vercel 部署上有，本地预览时 404 是正常的。
- 页面上显示的版本号（`data-app-version`）在发版时由 `scripts/bump-version.sh` 一起改，`scripts/check-version.sh` 会检查它和应用版本一致。

本地预览：`npx serve site`。跟读按钮要用麦克风，只能在 `localhost` 或 https 下用，直接双击打开 `index.html` 不行。
