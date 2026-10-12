# 落地页

`site/` 是 Shadowing 的落地页：一个静态页面，不需要构建。

- `index.html`：页面本身（样式和脚本都内联）。首屏的示例播放器用 `gongitsune.mp3`，它是 `src-tauri/samples/ja/ごんぎつね.mp3` 的副本（公有领域，出处见 `src-tauri/samples/README.md`）。
- 下载按钮指向 `releases/latest/download/Shadowing-macos-arm64.dmg`，发布流程每次都会上传这个固定名字的 .dmg 安装包，所以发版后不用改页面。
- 部署：Vercel 导入本仓库，Root Directory 填 `site`，Framework Preset 选 Other，不需要 Build Command。合并到 `main` 就自动上线。
- 访问统计：Vercel Web Analytics（项目的 Analytics 页里已开启）。`index.html` 的 `<head>` 末尾加载 `/_vercel/insights/script.js`，这个地址只在 Vercel 部署上有，本地预览时 404 是正常的。

本地预览：`npx serve site`，或直接用浏览器打开 `site/index.html`。
- 页面上显示的版本号（`data-app-version`）在发版时由 `scripts/bump-version.sh` 一起改，`scripts/check-version.sh` 会检查它和应用版本一致。
