// Words that differ between the Mac and Windows, taken as slots: t("音频不会离开{device}", { device: device() }).
// Chinese sets Latin words off with spaces (这台 Mac 上, macOS 钥匙串里) and 电脑 takes none, so a sentence that
// has "这台 Mac" in the middle gets a Windows sentence of its own (isWindows ? t("…这台电脑上…") : t("…这台 Mac 上…")),
// and the slots are for the places where a space can't go wrong: the end of a sentence, a space already there,
// or the English text. (Key names are in platform.ts.)
import { t } from "./i18n";
import { isWindows } from "./platform";

/** Where the app runs: "这台 Mac" or "这台电脑" ("this Mac" or "this PC"). */
export const device = (windows = isWindows) => (windows ? t("这台电脑") : t("这台 Mac"));

/** Where API keys and sign-ins are kept: "macOS 钥匙串" or "Windows 凭据管理器". */
export const vault = (windows = isWindows) => (windows ? t("Windows 凭据管理器") : t("macOS 钥匙串"));

/** Beside a saved key: "已保存在钥匙串" or "已保存在凭据管理器". */
export const savedInVault = (windows = isWindows) => (windows ? t("已保存在凭据管理器") : t("已保存在钥匙串"));
