import { Settings as Gear, X } from "lucide-react";
import { useEffect } from "react";
import type { Feature } from "../../lib/api";
import { useApp } from "../../store";
import { IconButton } from "../ui";
import { ProviderSetup } from "./ProviderSetup";

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
    <IconButton title="设置 (⌘,)" active={open} onClick={() => setOpen(true)}>
      <Gear size={16} />
    </IconButton>
  );
}

const FEATURES: { feature: Feature; title: string; description: string }[] = [
  { feature: "transcribe", title: "转写", description: "把没有字幕的音频变成带时间的句子，就能点句循环。" },
  { feature: "chat", title: "句子解释", description: "翻译句子、讲解语法、查词。功能在下一版本启用，可以先设置好。" },
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
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/30 px-6 dark:bg-black/50 pt-[7vh] pb-6"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex max-h-full w-full max-w-[620px] animate-pop-in flex-col self-start overflow-hidden rounded-2xl border border-line bg-elevated shadow-2xl shadow-black/25"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2.5 pl-5">
          <h2 id="settings-title" className="text-[14px] font-semibold">
            设置
          </h2>
          <IconButton title="关闭 (Esc)" onClick={() => setOpen(false)}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="overflow-y-auto px-5 pt-4 pb-5">
          <h3 className="text-[13px] font-semibold">
            AI 功能 <span className="ml-1 font-normal text-faint">可选</span>
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            不设置也能正常播放、循环和使用字幕。API Key 保存在 macOS 钥匙串里，只在这台 Mac 上使用。
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {FEATURES.map((f) => (
              <section key={f.feature} className="rounded-xl border border-line bg-panel p-4">
                <h4 className="text-[13px] font-semibold">{f.title}</h4>
                <p className="mt-0.5 text-[12px] text-muted">{f.description}</p>
                <ProviderSetup feature={f.feature} />
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
