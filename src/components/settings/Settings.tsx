import { Settings as Gear, X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import type { Feature } from "../../lib/api";
import { t, tk, type LangSetting } from "../../lib/i18n";
import { isCmd, isWindows, shortcut } from "../../lib/platform";
import { useApp } from "../../store";
import { Button, IconButton, TextLink } from "../ui";
import { PluginsSection } from "./Plugins";
import { ProviderSetup } from "./ProviderSetup";
import { RecordingsRow } from "./Recordings";

/** Gear in the top bar; ⌘, (Ctrl+, on Windows) also opens settings, as in every Mac app. */
export function SettingsButton() {
  const open = useApp((s) => s.settingsOpen);
  const setOpen = useApp((s) => s.setSettingsOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCmd(e) && e.key === ",") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
  return (
    <IconButton title={t("设置 ({key})", { key: shortcut("⌘,") })} active={open} onClick={() => setOpen(true)}>
      <Gear />
    </IconButton>
  );
}

const FEATURES: { feature: Feature; title: string; description: string }[] = [
  { feature: "transcribe", title: tk("转写"), description: tk("把没有字幕的音频变成带时间的句子，就能点句循环。") },
  { feature: "chat", title: tk("句子解释"), description: tk("用于解释句子（翻译、生词、语法）和 AI 校对字幕（找出可能听错的字）。") },
];

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const ready = useApp((s) => !!s.ai);
  const setOpen = useApp((s) => s.setSettingsOpen);

  useEffect(() => {
    if (!open) return;
    // Capture phase: Esc closes the sheet instead of also clearing the loop.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open || !ready) return null;
  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/25 px-6 pt-[7vh] pb-6 dark:bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex max-h-full w-full max-w-[640px] animate-pop-in flex-col self-start overflow-hidden rounded-[16px] bg-raised shadow-lift"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2.5 pl-6">
          <h2 id="settings-title" className="text-[14px] font-semibold">
            {t("设置")}
          </h2>
          <IconButton title={t("关闭 (Esc)")} onClick={() => setOpen(false)}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-5 pb-6">
          <LanguageRow />
          <h3 className="mt-3 border-t border-line pt-5 text-[12px] font-medium text-faint">{t("入门")}</h3>
          <div className="mt-1 flex flex-col divide-y divide-line">
            <GuideRow
              title={t("示例练习")}
              description={t("用一段约 30 秒的示例音频，练一遍播放、放慢、循环和跟读。")}
              action={t("开始")}
              onClick={() => void useApp.getState().startPractice()}
            />
            <GuideRow
              title={t("AI 设置向导")}
              description={t("一步步设置转写和句子解释，最后用示例音频试一次。")}
              action={t("打开")}
              onClick={() => useApp.getState().setWizardOpen(true)}
            />
          </div>
          <div className="mt-5 border-t border-line pt-6">
            <h3 className="text-[12px] font-medium text-faint">{t("AI 功能（可选）")}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              {isWindows
                ? t("不设置也能正常播放、循环和使用字幕。API Key 保存在 Windows 凭据管理器里，只在这台电脑上使用。")
                : t("不设置也能正常播放、循环和使用字幕。API Key 保存在 macOS 钥匙串里，只在这台 Mac 上使用。")}
            </p>
          </div>
          <div className="mt-2 flex flex-col">
            {FEATURES.map((f) => (
              <section key={f.feature} className="border-t border-line pt-5 pb-6 first:border-t-0">
                <h4 className="text-[14px] font-semibold">{t(f.title)}</h4>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t(f.description)}</p>
                <ProviderSetup feature={f.feature} />
              </section>
            ))}
          </div>
          <div className="border-t border-line pt-5">
            <h3 className="text-[12px] font-medium text-faint">{t("录音")}</h3>
            <RecordingsRow />
          </div>
          <PluginsSection />
          <div className="mt-2 border-t border-line pt-5">
            <h3 className="text-[12px] font-medium text-faint">{t("版本")}</h3>
            <UpdateRow />
          </div>
        </div>
      </div>
    </div>
  );
}

/** This version, and 检查更新 (also in the app menu); the answer shows here and in the floating notice. */
function UpdateRow() {
  const update = useApp((s) => s.update);
  const [version, setVersion] = useState("");
  useEffect(() => void getVersion().then(setVersion), []);
  const status =
    update.state === "checking"
      ? t("正在检查…")
      : update.state === "latest"
        ? t("已是最新版本")
        : update.state === "available" || update.state === "installing"
          ? t("新版本 {version} 可以更新", { version: update.version })
          : update.state === "failed"
            ? update.message
            : t("打开应用时会自动检查。");
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <h4 className="flex items-baseline gap-3 text-[13px] font-medium">
          <span>
            Shadowing <span className="font-mono tabular">{version}</span>
          </span>
          <TextLink className="text-[12px] font-normal" onClick={() => useApp.getState().setNewsOpen(true)}>
            {t("新功能")}
          </TextLink>
        </h4>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{status}</p>
      </div>
      {update.state === "available" ? (
        <Button primary onClick={() => void useApp.getState().installUpdate()}>
          {t("更新并重新打开")}
        </Button>
      ) : (
        <Button disabled={update.state === "checking" || update.state === "installing"} onClick={() => void useApp.getState().checkUpdate(true)}>
          {t("检查更新")}
        </Button>
      )}
    </div>
  );
}

const LANGUAGES: { value: LangSetting; label: string }[] = [
  { value: "", label: tk("跟随系统") },
  { value: "zh", label: "简体中文" }, // i18n: keep
  { value: "en", label: "English" },
];

/** 界面语言: follows the Mac's language unless one is picked here. */
function LanguageRow() {
  const setting = useApp((s) => s.settings.uiLanguage);
  return (
    <div className="flex items-center gap-4 pb-3">
      <h4 className="min-w-0 flex-1 text-[13px] font-medium">{t("界面语言")}</h4>
      <div className="tint flex h-7 rounded-[8px] p-0.5" role="radiogroup" aria-label={t("界面语言")}>
        {LANGUAGES.map((l) => (
          <button
            key={l.value}
            role="radio"
            aria-checked={setting === l.value}
            onClick={() => void useApp.getState().setUiLanguage(l.value)}
            className={`rounded-[6px] px-2.5 text-[12px] font-medium transition-[background-color,color] duration-150 ${
              setting === l.value ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
            }`}
          >
            {t(l.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

function GuideRow({ title, description, action, onClick }: { title: string; description: string; action: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <h4 className="text-[13px] font-medium">{title}</h4>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</p>
      </div>
      <Button onClick={onClick}>{action}</Button>
    </div>
  );
}
