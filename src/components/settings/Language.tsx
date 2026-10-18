import type { LanguageChoice } from "../../lib/i18n";
import { t } from "../../lib/i18n";
import { useApp } from "../../store";
import { fieldClass } from "../ui";

/** Interface language: follow the Mac, or pick one. Each option names itself in its own language. */
export function LanguageRow() {
  const choice = useApp((s) => s.settings.language);
  const system = useApp((s) => s.systemLanguage);
  const follow = t("跟随系统", "Same as the Mac");
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <h4 className="text-[13px] font-medium">{t("界面语言", "Language")}</h4>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
          {t("菜单、按钮和提示的语言；句子解释也用这个语言回答。", "For menus, buttons and messages. Sentence explanations are written in it too.")}
        </p>
      </div>
      <select
        className={`${fieldClass} !w-auto shrink-0`}
        value={choice}
        onChange={(e) => void useApp.getState().setLanguage(e.target.value as LanguageChoice)}
      >
        <option value="">
          {follow} ({system === "en" ? "English" : "简体中文"})
        </option>
        <option value="zh">简体中文</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}
