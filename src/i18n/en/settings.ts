import { plural, type Entry } from "../../lib/i18n";

const one = (n: string | number) => Number(n) === 1;

/** Settings (AI services, local models, recordings, plugins, version), transcribing and AI proofreading. */
export const settings: Record<string, Entry> = {
  // Settings
  入门: "Getting started",
  示例练习: "Sample practice",
  "用一段约 30 秒的示例音频，练一遍播放、放慢、循环和跟读。": "Try playing, slowing down, looping and shadowing on a sample of about 30 seconds.",
  开始: "Start",
  "AI 设置向导": "AI setup assistant",
  "一步步设置转写和句子解释，最后用示例音频试一次。": "Set up transcription and explanations step by step, then try them on sample audio.",
  打开: "Open",
  "AI 功能（可选）": "AI features (optional)",
  "不设置也能正常播放、循环和使用字幕。API Key 保存在 macOS 钥匙串里，只在这台 Mac 上使用。":
    "Playback, loops and subtitles all work without these. API keys are kept in the macOS Keychain and only used on this Mac.",
  "不设置也能正常播放、循环和使用字幕。API Key 保存在 Windows 凭据管理器里，只在这台电脑上使用。":
    "Playback, loops and subtitles all work without these. API keys are kept in the Windows Credential Manager and only used on this PC.",
  转写: "Transcription",
  "把没有字幕的音频变成带时间的句子，就能点句循环。": "Turns audio without subtitles into timed sentences, so you can click a sentence to loop it.",
  句子解释: "Explanations",
  "用于解释句子（翻译、生词、语法）和 AI 校对字幕（找出可能听错的字）。":
    "Explains sentences (translation, new words, grammar) and proofreads subtitles with AI (finds words that may be misheard).",
  录音: "Recordings",
  版本: "Version",
  "正在检查…": "Checking…",
  已是最新版本: "You're up to date",
  "新版本 {version} 可以更新": "Version {version} is available",
  "打开应用时会自动检查。": "Checked automatically when the app opens.",
  新功能: "What's New",
  更新并重新打开: "Update and reopen",
  检查更新: "Check for updates",

  // AI service
  服务: "Service",
  不使用: "None",
  本机: "Local",
  预览: "Preview",
  "正在运行，有 {n} 个模型": ({ n }) => `Running with ${plural(Number(n), "model")}`,
  请先选择一个模型: "Choose a model first",
  "连接成功，但没有找到模型“{model}”，请确认名称": "Connected, but no model named “{model}” was found. Check the name.",
  "连接成功，{model} 用了 {seconds} 秒回答": "Connected. {model} answered in {seconds} s",
  "连接成功，可以使用 {model}": "Connected. {model} is ready to use",
  "转写时音频会上传到 {name}": "Audio is uploaded to {name} for transcription",
  "转写时音频会上传到你填写的地址": "Audio is uploaded to the address you enter for transcription",
  "要解释的句子会发送到 {name}": "Sentences to explain are sent to {name}",
  要解释的句子会发送到你填写的地址: "Sentences to explain are sent to the address you enter",
  "在这台 Mac 上运行，内容不会离开本机": "Runs on this Mac; nothing leaves it",
  "在这台电脑上运行，内容不会离开本机": "Runs on this PC; nothing leaves it",
  地址: "Address",
  账号: "Account",
  模型: "Model",
  重新获取模型列表: "Reload model list",
  测试连接: "Test connection",
  "示例：{sample}": "Example: {sample}",
  请选择模型: "Choose a model",
  "手动输入…": "Enter manually…",
  模型名称: "Model name",

  // API key
  已保存在钥匙串: "Saved in Keychain",
  已保存在凭据管理器: "Saved in Credential Manager",
  更换: "Change",
  确认删除: "Confirm delete",
  删除: "Delete",
  没有可以不填: "Leave empty if you don't have one",
  "粘贴 {name} 的 API Key": "Paste your {name} API key",
  保存: "Save",
  取消: "Cancel",
  "去 {name} 创建 API Key": "Create an API key at {name}",

  // Signing in
  已登录: "Signed in",
  退出登录: "Sign out",
  "请在浏览器里登录并授权…": "Sign in and authorize in your browser…",
  "用 ChatGPT 登录": "Sign in with ChatGPT",
  "需要 ChatGPT Plus 或 Pro。解释会占用你的套餐额度（Plus 在所有应用间每 5 小时共享一个上限）。":
    "Requires ChatGPT Plus or Pro. Explanations use your plan's allowance (Plus shares one limit across all apps every 5 hours).",
  "请在浏览器里完成授权…": "Finish authorizing in your browser…",
  "用 OpenRouter 账号登录": "Sign in with OpenRouter",
  "在浏览器里授权，自动生成 Key": "Authorize in your browser to create a key automatically",
  "或者粘贴已有的 API Key：": "Or paste an API key you already have:",

  // Local models
  内存偏紧: "Tight on memory",
  内存不够: "Not enough memory",
  "在这台 Mac 上用 Whisper 转写：免费、可离线，音频不会离开本机。":
    "Transcribe on this Mac with Whisper: free, works offline, and your audio never leaves this Mac.",
  "这台 Mac：{chip} · {ram} GB 内存 · 可用空间 {free}。推荐的原因：{reason}":
    "This Mac: {chip} · {ram} GB memory · {free} free. Why this pick: {reason}",
  "这台 Mac：{chip} · {ram} GB 内存。推荐的原因：{reason}": "This Mac: {chip} · {ram} GB memory. Why this pick: {reason}",
  "选中的模型还没有下载，下载完成后就能转写。下载时可以关闭设置继续使用。":
    "The selected model isn't downloaded yet; you can transcribe once it is. You can close Settings and keep using the app while it downloads.",
  推荐: "Recommended",
  已下载: "Downloaded",
  另一个模型正在下载: "Another model is downloading",
  "继续下载（{percent}%）": "Resume download ({percent}%)",
  下载: "Download",

  // Recordings
  "不到 1 MB": "Under 1 MB",
  录音占用: "Recordings use",
  还没有录音: "No recordings yet",
  "其中 {n} 个音频已经找不到了（移走或删掉了），它们的录音占 {size}。外接硬盘没接上时不算找不到。": ({ n, size }) =>
    `${plural(Number(n), "track")} can't be found anymore (moved or deleted), with ${size} of recordings. An unplugged external drive doesn't count as missing.`,
  "跟读录音和整段录音存在这台 Mac 的应用数据里，不会写到音频旁边。":
    "Shadow recordings and section readings are kept in the app's data on this Mac, never next to your audio.",
  "跟读录音和整段录音存在这台电脑的应用数据里，不会写到音频旁边。":
    "Shadow recordings and section readings are kept in the app's data on this PC, never next to your audio.",
  确定删除: "Confirm delete",
  删除这些录音: "Delete these recordings",

  // Plugins
  插件: "Plugins",
  "插件给应用加上额外的功能，例如粘贴 YouTube 链接导入音频。插件是运行在这台 Mac 上的程序，只安装你信任的插件。":
    "Plugins add extra features to the app, such as importing audio by pasting a YouTube link. A plugin is a program that runs on this Mac; only install plugins you trust.",
  "插件给应用加上额外的功能，例如粘贴 YouTube 链接导入音频。插件是运行在这台电脑上的程序，只安装你信任的插件。":
    "Plugins add extra features to the app, such as importing audio by pasting a YouTube link. A plugin is a program that runs on this PC; only install plugins you trust.",
  "从文件夹安装…": "Install from folder…",
  安装插件: "Install plugin",
  "安装插件「{name}」？": "Install plugin “{name}”?",
  "作者：{author}": "Author: {author}",
  "它会：{runs}": "It will: {runs}",
  "联网：{hosts}": "Connects to: {hosts}",
  "、": ", ",
  "会替换已安装的 {name}。": "Replaces the installed {name}.",
  "插件是运行在这台 Mac 上的程序，可以读写你的文件。只安装你信任的插件。":
    "A plugin is a program that runs on this Mac and can read and write your files. Only install plugins you trust.",
  "插件是运行在这台电脑上的程序，可以读写你的文件。只安装你信任的插件。":
    "A plugin is a program that runs on this PC and can read and write your files. Only install plugins you trust.",
  安装: "Install",
  "可以导入：{kinds}": "Imports: {kinds}",
  占用: "Uses",

  // Transcribing
  自动识别: "Auto-detect",
  日语: "Japanese",
  英语: "English",
  中文: "Chinese",
  韩语: "Korean",
  法语: "French",
  德语: "German",
  西班牙语: "Spanish",
  字幕: "Subtitles",
  "另一个音频正在转写，完成后才能开始新的。": "Another track is being transcribed. You can start a new one when it's done.",
  "有了字幕，每一句都能点着听、单独循环。可以用 AI 转写，或导入现成的 SRT / VTT 文件。":
    "With subtitles, you can click any sentence to hear it and loop it on its own. Transcribe with AI, or import an existing SRT / VTT file.",
  "AI 转写": "Transcribe with AI",
  导入字幕文件: "Import subtitle file…",
  你填写的地址: "the address you entered",
  语言: "Language",
  指定语言通常更准确: "Picking the language is usually more accurate",
  "本机 · {model}": "Local · {model}",
  免费: "Free",
  "不到 $0.01": "Under $0.01",
  "约 ${cost}": "About ${cost}",
  更改: "Change",
  "音频会上传到 {destination}。转写时可以继续听，完成后字幕会自动出现。":
    "Audio is uploaded to {destination}. You can keep listening while it transcribes; subtitles appear when it's done.",
  "在这台 Mac 上处理。转写时可以继续听，完成后字幕会自动出现。":
    "Processed on this Mac. You can keep listening while it transcribes; subtitles appear when it's done.",
  开始转写: "Start transcribing",
  "正在区分说话人…": "Telling speakers apart…",
  "正在转写…": "Transcribing…",
  "可以继续听，完成后字幕会自动出现。": "Keep listening; subtitles appear when it's done.",
  "正在跳过…": "Skipping…",
  跳过: "Skip",
  "正在取消…": "Canceling…",
  转写没有完成: "Transcription didn't finish",
  重试: "Try again",
  检查设置: "Check settings",
  关闭: "Close",

  // AI proofreading. {count} is drawn by the component; the entry gets the same number as n.
  "AI 校对：找出可能听错的字": "AI proofreading: find words that may be misheard",
  "AI 校对用「句子解释」的服务，还没有设置好。": "AI proofreading uses the Explanations service, which isn't set up yet.",
  去设置: "Open Settings",
  "把这 {count} 句文字交给本机的 {label}，找出可能听错的字。只给建议，改不改由你决定。": ({ n }) =>
    `Send {count} ${one(n) ? "sentence" : "sentences"} to {label} on {device} to find words that may be misheard. It only suggests; you decide what to change.`,
  "把这 {count} 句文字发给 {label}，找出可能听错的字。只给建议，改不改由你决定。": ({ n }) =>
    `Send {count} ${one(n) ? "sentence" : "sentences"} to {label} to find words that may be misheard. It only suggests; you decide what to change.`,
  开始校对: "Start proofreading",
  "正在校对…": "Proofreading…",
  "AI 没有发现明显听错的字。": "AI found nothing that seems misheard.",
  播放下一处: "Play the next one",
  "AI 找到 {count} 处可能听错，写在句子下面": ({ n }) =>
    one(n)
      ? "AI found {count} word that may be misheard, noted under its sentence"
      : "AI found {count} words that may be misheard, noted under the sentences",
  全部改正: "Fix all",
  全部忽略: "Ignore all",
  "AI 建议": "AI suggestion",
  改正: "Fix",
  忽略: "Ignore",
};
