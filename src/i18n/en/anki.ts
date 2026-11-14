import type { Entry } from "../../lib/i18n";

/** 加入 Anki: a sentence as an Anki card, through AnkiConnect. */
export const anki: Record<string, Entry> = {
  "加入 Anki": "Add to Anki",
  "做成 Anki 卡片：这一句的录音、原文和保存过的解释": "Make an Anki card: this sentence's audio, its text and the saved explanation",
  "正在加入 Anki…": "Adding to Anki…",
  "已加入 Anki 的「{deck}」牌组": "Added to Anki: deck “{deck}”",
  "这句已经在 Anki 里了": "This sentence is already in Anki",
  "连接 Anki": "Connect to Anki",
  "这一句会直接加进电脑上的 Anki。要先做好两件事：": "The sentence goes straight into Anki on this computer. Two things first:",
  "打开 Anki 电脑版，让它开着。": "Open Anki for desktop and leave it open.",
  "第一次用：在 Anki 里选「工具 → 插件 → 获取插件…」，填入 AnkiConnect 的代码，装好后重启 Anki。":
    "The first time: in Anki, choose Tools → Add-ons → Get Add-ons…, enter AnkiConnect's code, then restart Anki once it's installed.",
  复制代码: "Copy code",
  已复制: "Copied",
  "卡片放在「Shadowing」牌组：正面是这一句和它的录音，背面是译文和保存过的解释。":
    "Cards go in the “Shadowing” deck: the sentence and its audio on the front, the translation and saved explanation on the back.",
  "还是连不上 Anki：确认 Anki 开着；刚装好 AnkiConnect 的话，要重启一次 Anki。":
    "Still can't reach Anki. Make sure it's open; if you just installed AnkiConnect, restart Anki once.",
  取消: "Cancel",
  "连接中…": "Connecting…",
  再试一次: "Try again",
  "关闭 (Esc)": "Close (Esc)",
};
