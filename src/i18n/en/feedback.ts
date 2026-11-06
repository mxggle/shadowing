import type { Entry } from "../../lib/i18n";

/** 意见反馈: the window, its row in settings. */
export const feedback: Record<string, Entry> = {
  意见反馈: "Feedback",
  "遇到问题、想要什么功能，直接写给开发者。": "Ran into a problem or want a feature? Write to the developer.",
  写反馈: "Write",
  "遇到的问题、想要的功能、哪里用着不顺手，都可以写在这里。只有开发者会看到，不会公开。":
    "Problems you ran into, features you'd like, anything that feels awkward: write it here. Only the developer reads it; it's never made public.",
  反馈内容: "Your feedback",
  "比如：边听边说时录不到自己的声音；希望能导出到 Anki……":
    "For example: my voice isn't recorded when I speak along; I'd like to export to Anki…",
  "联系方式（选填）": "Contact (optional)",
  "邮箱、微信或小红书，方便回复你": "Email or another way to reach you",
  附上诊断信息: "Attach diagnostics",
  会附上什么: "What's attached",
  "版本号、系统和界面语言总会附上。勾上时再加上下面这些，方便找到问题；不含 API Key、文件和录音。":
    "The version, system and interface language always go along. Ticked, these lines go too, to help find the problem; never API keys, files or recordings.",
  复制内容: "Copy text",
  "发送 ({key})": "Send ({key})",
  "正在发送…": "Sending…",
  发送: "Send",
  "收到了，谢谢！": "Got it, thank you!",
  "每一条都会认真看。留了联系方式的话，会尽量回复你。": "Every message gets read. If you left a way to reach you, you'll hear back when possible.",
  好: "OK",
};
