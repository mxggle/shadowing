import type { Entry } from "../../lib/i18n";
import { isWindows } from "../../lib/platform";

/** The app shell, settings and things shared across screens. */
export const app: Record<string, Entry> = {
  设置: "Settings",
  "设置 ({key})": "Settings ({key})",
  "关闭 (Esc)": "Close (Esc)",
  界面语言: "Language",
  跟随系统: () => (isWindows ? "Same as Windows" : "Same as Mac"),

  // Words that differ between the Mac and Windows (src/lib/wording.ts).
  "这台 Mac": "this Mac",
  这台电脑: "this PC",
  "macOS 钥匙串": "macOS Keychain",
  "Windows 凭据管理器": "Windows Credential Manager",
};
