import { Settings as Gear, X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import type { Feature } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useApp } from "../../store";
import { Button, IconButton, TextLink } from "../ui";
import { LanguageRow } from "./Language";
import { PluginsSection } from "./Plugins";
import { ProviderSetup } from "./ProviderSetup";
import { RecordingsRow } from "./Recordings";

/** Gear in the top bar; ⌘, also opens settings, as in every Mac app. */
export function SettingsButton() {
  const open = useApp((s) => s.settingsOpen);
  const setOpen = useApp((s) => s.setSettingsOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
  return (
    <IconButton title={t("设置 (⌘,)", "Settings (⌘,)")} active={open} onClick={() => setOpen(true)}>
      <Gear />
    </IconButton>
  );
}

/** A function, not a constant: the wording follows the language (see lib/i18n.ts). */
const features = (): { feature: Feature; title: string; description: string }[] => [
  {
    feature: "transcribe",
    title: t("转写", "Transcription"),
    description: t("把没有字幕的音频变成带时间的句子，就能点句循环。", "Turns audio without subtitles into timed sentences, so you can click a sentence to loop it."),
  },
  {
    feature: "chat",
    title: t("句子解释", "Sentence explanations"),
    description: t(
      "用于解释句子（翻译、生词、语法）和 AI 校对字幕（找出可能听错的字）。",
      "Explains sentences (translation, words, grammar) and proofreads subtitles with AI (finds words that were probably misheard).",
    ),
  },
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
            {t("设置", "Settings")}
          </h2>
          <IconButton title={t("关闭 (Esc)", "Close (Esc)")} onClick={() => setOpen(false)}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-5 pb-6">
          <h3 className="text-[12px] font-medium text-faint">{t("入门", "Getting started")}</h3>
          <div className="mt-1 flex flex-col divide-y divide-line">
            <GuideRow
              title={t("示例练习", "Sample practice")}
              description={t(
                "用一段约 30 秒的示例音频，练一遍播放、放慢、循环和跟读。",
                "A 30-second sample to try playing, slowing down, looping and shadowing.",
              )}
              action={t("开始", "Start")}
              onClick={() => void useApp.getState().startPractice()}
            />
            <GuideRow
              title={t("AI 设置向导", "AI setup assistant")}
              description={t(
                "一步步设置转写和句子解释，最后用示例音频试一次。",
                "Sets up transcription and sentence explanations step by step, then tries them on the sample.",
              )}
              action={t("打开", "Open")}
              onClick={() => useApp.getState().setWizardOpen(true)}
            />
            <LanguageRow />
          </div>
          <div className="mt-5 border-t border-line pt-6">
            <h3 className="text-[12px] font-medium text-faint">{t("AI 功能（可选）", "AI features (optional)")}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              {t(
                "不设置也能正常播放、循环和使用字幕。API Key 保存在 macOS 钥匙串里，只在这台 Mac 上使用。",
                "Playing, looping and subtitles all work without them. API keys are kept in the macOS Keychain and only used on this Mac.",
              )}
            </p>
          </div>
          <div className="mt-2 flex flex-col">
            {features().map((f) => (
              <section key={f.feature} className="border-t border-line pt-5 pb-6 first:border-t-0">
                <h4 className="text-[14px] font-semibold">{f.title}</h4>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{f.description}</p>
                <ProviderSetup feature={f.feature} />
              </section>
            ))}
          </div>
          <div className="border-t border-line pt-5">
            <h3 className="text-[12px] font-medium text-faint">{t("录音", "Recordings")}</h3>
            <RecordingsRow />
          </div>
          <PluginsSection />
          <div className="mt-2 border-t border-line pt-5">
            <h3 className="text-[12px] font-medium text-faint">{t("版本", "Version")}</h3>
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
      ? t("正在检查…", "Checking…")
      : update.state === "latest"
        ? t("已是最新版本", "You’re up to date")
        : update.state === "available" || update.state === "installing"
          ? t(`新版本 ${update.version} 可以更新`, `Version ${update.version} is available`)
          : update.state === "failed"
            ? update.message
            : t("打开应用时会自动检查。", "Checked automatically when the app opens.");
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <h4 className="flex items-baseline gap-3 text-[13px] font-medium">
          <span>
            Shadowing <span className="font-mono tabular">{version}</span>
          </span>
          <TextLink className="text-[12px] font-normal" onClick={() => useApp.getState().setNewsOpen(true)}>
            {t("新功能", "What’s New")}
          </TextLink>
        </h4>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{status}</p>
      </div>
      {update.state === "available" ? (
        <Button primary onClick={() => void useApp.getState().installUpdate()}>
          {t("更新并重新打开", "Update and Relaunch")}
        </Button>
      ) : (
        <Button disabled={update.state === "checking" || update.state === "installing"} onClick={() => void useApp.getState().checkUpdate(true)}>
          {t("检查更新", "Check for Updates")}
        </Button>
      )}
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
